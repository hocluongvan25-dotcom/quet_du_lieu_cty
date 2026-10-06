#!/usr/bin/env node
/**
 * SQL verification harness for the Seekora migrations.
 *
 *   npm run db:verify
 *
 * Runs every file in `supabase/migrations` against an in-process Postgres
 * (PGlite, WebAssembly) with a minimal Supabase shim — `auth.users`,
 * `auth.uid()`, the `anon`/`authenticated`/`service_role` roles and Supabase's
 * default table grants — then exercises the credit and RLS rules that protect
 * money and tenant isolation:
 *
 *   - onboarding creates a workspace once and records the starter grant,
 *   - a research job reserves credits, stores report + evidence and settles,
 *   - insufficient credits, unknown members and anonymous callers are rejected
 *     without writing anything,
 *   - one workspace cannot read another's reports, ledger or evidence.
 *
 * No network access and no credentials required.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

let failures = 0;

function check(label, condition, extra = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

function section(title) {
  console.log(`\n${title}`);
}

const db = new PGlite();

// ---------------------------------------------------------------- Supabase shim
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
`);

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

for (const name of migrationFiles) {
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");

  // PGlite ships without pgcrypto; Supabase has it. gen_random_uuid() is core
  // since Postgres 13, so the extension line is the only thing to skip.
  // PGlite ships a small extension set; Supabase provides these. The lines are
  // dropped from the harness run only.
  for (const extension of ["pgcrypto", "pg_cron", "pg_net"]) {
    const pattern = new RegExp(`create extension if not exists "?${extension}"?;`, "i");
    if (pattern.test(sql)) {
      sql = sql.replace(pattern, `-- ${extension} skipped in the local harness`);
    }
  }

  try {
    await db.exec(sql);
    console.log(`✓ applied ${name}`);
  } catch (error) {
    console.log(`✗ failed ${name}: ${error.message}`);
    process.exit(1);
  }
}

// Mirror Supabase's default privileges so RLS is the only gate left.
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
`);

const asUser = (userId) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);

const userA = (
  await db.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('owner@example.com', '{"full_name":"Owner One"}') returning id`,
  )
).rows[0].id;
const userB = (await db.query("insert into auth.users (email) values ('other@example.com') returning id")).rows[0].id;

section("profiles trigger");
check("profile row created for each new user", (await db.query("select count(*)::int as n from public.profiles")).rows[0].n === 2);

section("bootstrap_workspace");
await asUser(userA);
const orgId = (await db.query("select public.bootstrap_workspace('Acme Research') as id")).rows[0].id;
const org = (await db.query("select name, plan, credits_balance from public.organizations where id = $1", [orgId])).rows[0];
check("workspace created with the supplied name", org?.name === "Acme Research");
check("starter grant applied", org?.credits_balance === 50, `balance=${org?.credits_balance}`);
check("caller becomes owner", (await db.query("select role from public.organization_members where organization_id = $1 and user_id = $2", [orgId, userA])).rows[0]?.role === "owner");
check("grant recorded in the ledger", (await db.query("select count(*)::int as n from public.credit_ledger where organization_id = $1 and type = 'credit'", [orgId])).rows[0].n === 1);
check("second call is idempotent", (await db.query("select public.bootstrap_workspace('Second call') as id")).rows[0].id === orgId);

await asUser(userB);
const orgB = (await db.query("select public.bootstrap_workspace(null) as id")).rows[0].id;
const orgBRow = (await db.query("select name, slug from public.organizations where id = $1", [orgB])).rows[0];
check("a null name falls back to the email local part", orgBRow?.name === "other", orgBRow?.name);
check("slug stays url-safe and unique", /^[a-z0-9-]+$/.test(orgBRow?.slug ?? ""), orgBRow?.slug);
await asUser(userA);

section("complete_research_job");
const reportPayload = {
  company_name: "Nova Distribution Ltd.",
  country: "Singapore",
  industry: "Distribution",
  description: "Provider output.",
  official_website: "https://novadistribution.example",
  public_business_email: "sales@novadistribution.example",
  confidence: 94,
  report_data: { signals: ["Website verified"] },
  provider_trace: { provider: "demo" },
};
const evidence = [
  { kind: "website", source_label: "Official website", source_url: "https://novadistribution.example/about", field_name: "official_website", is_verified: true },
  { kind: "website", source_label: "Contact page", source_url: "https://novadistribution.example/contact", field_name: "public_business_email", is_verified: true },
  { kind: "not-a-kind", source_label: "Invalid enum", source_url: "https://example.com/x", is_verified: "yes" },
  { kind: "social", source_label: "Missing url" },
];

const reportId = (
  await db.query("select public.complete_research_job($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) as id", [
    orgId,
    "Nova Distribution",
    "https://novadistribution.example",
    "Singapore",
    JSON.stringify(reportPayload),
    JSON.stringify(evidence),
    5,
    30,
  ])
).rows[0].id;

const report = (await db.query("select * from public.company_reports where id = $1", [reportId])).rows[0];
const job = (
  await db.query(
    "select status, credits_reserved, credits_charged from public.research_jobs where id = (select research_job_id from public.company_reports where id = $1)",
    [reportId],
  )
).rows[0];

check("report stored with provider values", report?.company_name === "Nova Distribution Ltd." && report?.confidence === 94);
check("expiry follows the retention window", Math.round((new Date(report.expires_at) - new Date(report.captured_at)) / 86_400_000) === 30);
check("credits debited", (await db.query("select credits_balance from public.organizations where id = $1", [orgId])).rows[0].credits_balance === 45);
check("job settled as ready", job.status === "ready" && job.credits_reserved === 0 && job.credits_charged === 5, JSON.stringify(job));
check("unknown enum falls back and booleans coerce", (await db.query("select count(*)::int as n from public.source_evidence where company_report_id = $1", [reportId])).rows[0].n === 3);
check("evidence without a url is skipped", (await db.query("select count(*)::int as n from public.source_evidence where source_label = 'Missing url'")).rows[0].n === 0);
check("evidence inherits the report expiry", (await db.query("select bool_and(expires_at = $2::timestamptz) as ok from public.source_evidence where company_report_id = $1", [reportId, report.expires_at])).rows[0].ok === true);
check("out-of-range confidence is clamped", (
  await db.query("select confidence from public.company_reports where id = $1", [
    (await db.query("select public.complete_research_job($1, $2, null, null, $3::jsonb, '[]'::jsonb, 0, 30) as id", [orgId, "Clamp Test", JSON.stringify({ company_name: "Clamp Test", confidence: 250 })])).rows[0].id,
  ])
).rows[0].confidence === 100);

section("rejections (nothing may be written)");
const before = (await db.query("select count(*)::int as n from public.research_jobs")).rows[0].n;
await db.query("update public.organizations set credits_balance = 3 where id = $1", [orgId]);

async function expectFailure(sql, params, expected) {
  try {
    await db.query(sql, params);
  } catch (error) {
    return { message: error.message, ok: error.message.includes(expected) };
  }
  return { message: "no error raised", ok: false };
}

const insufficient = await expectFailure(
  "select public.complete_research_job($1, 'Too expensive', null, null, $2::jsonb, '[]'::jsonb, 5, 30)",
  [orgId, JSON.stringify({ company_name: "Too expensive" })],
  "insufficient credits",
);
check("insufficient credits rejected", insufficient.ok, insufficient.message);
check("rolled back without a partial job", (await db.query("select count(*)::int as n from public.research_jobs")).rows[0].n === before);
await db.query("update public.organizations set credits_balance = 45 where id = $1", [orgId]);

const noName = await expectFailure(
  "select public.complete_research_job($1, null, 'https://x.example', null, '{}'::jsonb, '[]'::jsonb, 5, 30)",
  [orgId],
  "company name is required",
);
check("missing company name rejected", noName.ok, noName.message);

await asUser(userB);
const foreignWorkspace = await expectFailure(
  "select public.complete_research_job($1, 'Intruder', null, null, $2::jsonb, '[]'::jsonb, 5, 30)",
  [orgId, JSON.stringify({ company_name: "Intruder" })],
  "not a member",
);
check("non-member cannot write into another workspace", foreignWorkspace.ok, foreignWorkspace.message);

await db.query("select set_config('request.jwt.claim.sub', '', false)");
const anonymous = await expectFailure("select public.bootstrap_workspace('Anon')", [], "authentication required");
check("anonymous caller rejected", anonymous.ok, anonymous.message);


section("change monitoring");
await db.query("update public.organizations set credits_balance = 50 where id = $1", [orgId]);
await asUser(userA);
const secondReportId = (
  await db.query("select public.complete_research_job($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) as id", [
    orgId,
    "Nova Distribution Ltd.",
    "https://novadistribution.example",
    "Singapore",
    JSON.stringify({
      company_name: "Nova Distribution Ltd.",
      country: "Singapore",
      industry: "Distribution",
      official_website: "https://novadistribution.com",
      public_business_phone: "+65 6123 4820",
      confidence: 88,
    }),
    JSON.stringify([
      { kind: "website", source_label: "Official website", source_url: "https://novadistribution.com", field_name: "official_website", is_verified: true },
    ]),
    5,
    30,
  ])
).rows[0].id;

const changeRows = (
  await db.query(
    "select field_name, change_kind, previous_value, new_value from public.report_changes where company_report_id = $1 order by field_name",
    [secondReportId],
  )
).rows;
const changeByField = new Map(changeRows.map((row) => [row.field_name, row]));

check("website change detected", changeByField.get("official_website")?.change_kind === "changed", JSON.stringify(changeByField.get("official_website")));
check("previous website kept", changeByField.get("official_website")?.previous_value === "https://novadistribution.example");
check("new website kept", changeByField.get("official_website")?.new_value === "https://novadistribution.com");
check("dropped email marked removed", changeByField.get("public_business_email")?.change_kind === "removed" && changeByField.get("public_business_email")?.new_value === null, JSON.stringify(changeByField.get("public_business_email")));
check("new phone marked added", changeByField.get("public_business_phone")?.change_kind === "added", JSON.stringify(changeByField.get("public_business_phone")));
check("confidence move detected", changeByField.get("confidence")?.previous_value === "94" && changeByField.get("confidence")?.new_value === "88");
check("unchanged fields are not recorded", !changeByField.has("country") && !changeByField.has("industry"), [...changeByField.keys()].join(","));
check("one row per changed field", changeRows.length === 4, `${changeRows.length} rows`);
check("previous snapshot is linked", (
  await db.query("select previous_report_id from public.report_changes where company_report_id = $1 limit 1", [secondReportId])
).rows[0].previous_report_id === reportId);
check("a first snapshot records nothing", (await db.query("select count(*)::int as n from public.report_changes where company_report_id = $1", [reportId])).rows[0].n === 0);

section("team members");
const userC = (await db.query("insert into auth.users (email) values ('third@example.com') returning id")).rows[0].id;
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [orgId, userC]);

const membersA = (await db.query("select * from public.workspace_members()")).rows;
check("workspace lists every member", membersA.length === 2, `${membersA.length} members`);
check("owner sorted first", membersA[0].role === "owner" && membersA[0].email === "owner@example.com");
check("roles included", membersA.some((member) => member.role === "member"));
check("research counts per member", membersA.find((member) => member.email === "owner@example.com")?.reports_created === 3, String(membersA.find((member) => member.email === "owner@example.com")?.reports_created));
check("emails only for own workspace", membersA.every((member) => member.email !== "other@example.com"));

await asUser(userB);
const membersB = (await db.query("select * from public.workspace_members()")).rows;
check("another workspace sees only its own members", membersB.length === 1 && membersB[0].email === "other@example.com", JSON.stringify(membersB.map((m) => m.email)));

section("retention cleanup");
await asUser(userA);
const artifactPath = `artifacts/novadistribution/${secondReportId}.html`;
await db.query("update public.source_evidence set artifact_storage_path = $2 where company_report_id = $1", [secondReportId, artifactPath]);
await db.query("update public.source_evidence set expires_at = now() - interval '1 day' where company_report_id = $1", [secondReportId]);
await db.query("update public.company_reports set expires_at = now() - interval '1 day' where id = $1", [secondReportId]);

const paths = (await db.query("select storage_path from public.retention_artifact_paths(100) where storage_path = $1", [artifactPath])).rows;
check("expired artifact path listed for deletion", paths.length === 1, JSON.stringify(paths));

const withoutObjects = (await db.query("select * from public.purge_expired_retention('{}'::text[])")).rows[0];
check("rows kept while the object still exists", withoutObjects.deleted_evidence === 0 && withoutObjects.deleted_reports === 0, JSON.stringify(withoutObjects));
check("report survives an unfinished object deletion", (await db.query("select count(*)::int as n from public.company_reports where id = $1", [secondReportId])).rows[0].n === 1);

const withObjects = (await db.query("select * from public.purge_expired_retention($1::text[])", [[artifactPath]])).rows[0];
check("expired evidence removed once the object is gone", withObjects.deleted_evidence === 1, JSON.stringify(withObjects));
check("expired starter snapshot removed with it", withObjects.deleted_reports === 1, JSON.stringify(withObjects));
const survivingChanges = (await db.query("select company_report_id, previous_report_id from public.report_changes where company_name = 'Nova Distribution Ltd.'")).rows;
check(
  "change history survives the deleted snapshot",
  survivingChanges.length === 4 &&
    survivingChanges.every((row) => row.company_report_id === null) &&
    survivingChanges.every((row) => row.previous_report_id === reportId),
  JSON.stringify(survivingChanges[0]),
);
check("other snapshots untouched", (await db.query("select count(*)::int as n from public.company_reports where id = $1", [reportId])).rows[0].n === 1);

section("retention schedule");
let cronGuard = null;
try {
  await db.query("select public.schedule_retention_cron('https://app.example/api/maintenance/retention', 'secret')");
} catch (error) {
  cronGuard = error.message;
}
check("schedule helper refuses to run without pg_cron", Boolean(cronGuard && cronGuard.includes("pg_cron is not enabled")), cronGuard ?? "no error");

let cronValidation = null;
try {
  await db.query("select public.schedule_retention_cron('', '')");
} catch (error) {
  cronValidation = error.message;
}
check("schedule helper validates its arguments", Boolean(cronValidation && cronValidation.includes("p_url and p_secret are required")), cronValidation ?? "no error");

section("grants");
await db.query("set role authenticated");
await asUser(userA);
let retentionDenied = false;
try {
  await db.query("select * from public.retention_artifact_paths(10)");
} catch (error) {
  retentionDenied = /permission denied/i.test(error.message);
}
check("authenticated users cannot run the retention sweep", retentionDenied);

let scheduleDenied = false;
try {
  await db.query("select public.schedule_retention_cron('https://x.example', 'secret')");
} catch (error) {
  scheduleDenied = /permission denied/i.test(error.message);
}
check("authenticated users cannot install the cron schedule", scheduleDenied);
await db.query("reset role");

section("RLS isolation");
await db.query("set role authenticated");
await asUser(userA);
check("member sees own reports", (await db.query("select count(*)::int as n from public.company_reports")).rows[0].n === 2);
await asUser(userB);
check("other tenant sees no reports", (await db.query("select count(*)::int as n from public.company_reports")).rows[0].n === 0);
check("other tenant cannot read the workspace", (await db.query("select count(*)::int as n from public.organizations where id = $1", [orgId])).rows[0].n === 0);
check("other tenant cannot read the credit ledger", (await db.query("select count(*)::int as n from public.credit_ledger where organization_id = $1", [orgId])).rows[0].n === 0);
check("other tenant cannot read the evidence", (await db.query("select count(*)::int as n from public.source_evidence where organization_id = $1", [orgId])).rows[0].n === 0);
check("profiles stay private", (await db.query("select count(*)::int as n from public.profiles")).rows[0].n === 1);
check("other tenant sees no change history", (await db.query("select count(*)::int as n from public.report_changes")).rows[0].n === 0);
await db.query("reset role");

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed across ${migrationFiles.length} migration(s).`);
  process.exit(1);
}
console.log(`All checks passed across ${migrationFiles.length} migration(s).`);
