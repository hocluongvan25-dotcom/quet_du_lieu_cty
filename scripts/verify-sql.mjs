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
  grant usage on schema public to anon, authenticated, service_role;

  -- Supabase grants table privileges to anon/authenticated when a table is
  -- created. Setting default privileges (instead of granting after the
  -- migrations) keeps the revokes written inside the migrations meaningful.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
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

// Nothing to grant here: the default privileges above already covered every
// table the migrations created, so RLS and the explicit revokes are the only
// gates left.

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
    const wanted = Array.isArray(expected) ? expected : [expected];
    return { message: error.message, ok: wanted.some((text) => error.message.includes(text)) };
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

section("buyer discovery (005)");
const sourceCount = (await db.query("select count(*)::int as n from public.market_sources")).rows[0].n;
check("source catalogue seeded", sourceCount >= 8, `${sourceCount} sources`);

const importyetiSource = (await db.query("select licence_type, allows_resale from public.market_sources where key = 'importyeti'")).rows[0];
check("ImportYeti recorded as public record without resale rights", importyetiSource.licence_type === "public-record" && importyetiSource.allows_resale === false, JSON.stringify(importyetiSource));
check("Companies House marked reusable", (await db.query("select allows_resale from public.market_sources where key = 'companies_house'")).rows[0].allows_resale === true);

const tradeSourceId = (await db.query("select id from public.market_sources where key = 'importyeti'")).rows[0].id;
const registrySourceId = (await db.query("select id from public.market_sources where key = 'companies_house'")).rows[0].id;
const websiteSourceId = (await db.query("select id from public.market_sources where key = 'company_website'")).rows[0].id;
const licensedSourceId = (await db.query("select id from public.market_sources where key = 'volza'")).rows[0].id;

const buyerId = (
  await db.query(
    `insert into public.buyer_profiles
       (organization_id, legal_name, display_name, country, region, city, website, domain, industry, target_department, hs_codes, fit_score, first_signal_at, last_signal_at)
     values ($1, 'GREAT LAKES PACKAGING LLC', 'Great Lakes Packaging', 'United States', 'Ohio', 'Cleveland',
             'https://greatlakespackaging.example', 'greatlakespackaging.example', 'Packaging', 'procurement',
             '{4819.10,4819.20}', 86, now() - interval '2 years', now() - interval '12 days')
     returning id`,
    [orgId],
  )
).rows[0].id;
check("buyer stored with fit score and HS codes", (await db.query("select fit_score from public.buyer_profiles where id = $1", [buyerId])).rows[0].fit_score === 86);

const duplicateBuyer = await expectFailure(
  "insert into public.buyer_profiles (organization_id, legal_name, display_name, country, domain) values ($1, 'Dup', 'Dup', 'United States', 'greatlakespackaging.example')",
  [orgId],
  "duplicate key",
);
check("the same buyer domain cannot be added twice", duplicateBuyer.ok, duplicateBuyer.message);

await db.query(
  `insert into public.trade_signals
     (organization_id, buyer_profile_id, market_source_id, shipment_date, supplier_name, supplier_country, hs_code, product_description, weight_kg, containers, record_reference)
   values ($1, $2, $3, '2026-09-24', 'Zhongshan Carton Co', 'China', '4819.10', 'Corrugated cartons', 18240.5, 2, 'BOL123456')`,
  [orgId, buyerId, tradeSourceId],
);
check("shipment record stored", (await db.query("select count(*)::int as n from public.trade_signals where buyer_profile_id = $1", [buyerId])).rows[0].n === 1);

const duplicateSignal = await expectFailure(
  "insert into public.trade_signals (organization_id, buyer_profile_id, market_source_id, shipment_date, record_reference) values ($1, $2, $3, '2026-09-24', 'BOL123456')",
  [orgId, buyerId, tradeSourceId],
  "duplicate key",
);
check("the same bill of lading cannot be stored twice", duplicateSignal.ok, duplicateSignal.message);

const personId = (
  await db.query(
    `insert into public.decision_makers
       (organization_id, buyer_profile_id, market_source_id, full_name, job_title, department, grade, source_url, corroboration_count, expires_at)
     values ($1, $2, $3, 'Dana Whitfield', 'Director', 'Executive', 'a',
             'https://find-and-update.company-information.service.gov.uk/company/01234567/officers', 2, now() + interval '90 days')
     returning id`,
    [orgId, buyerId, registrySourceId],
  )
).rows[0].id;

const gradeAWithoutName = await expectFailure(
  "insert into public.decision_makers (organization_id, buyer_profile_id, grade, source_url) values ($1, $2, 'a', 'https://x.example')",
  [orgId, buyerId],
  "violates check constraint",
);
check("grade A without a name is rejected", gradeAWithoutName.ok, gradeAWithoutName.message);

const gradeCWithName = await expectFailure(
  "insert into public.decision_makers (organization_id, buyer_profile_id, grade, full_name, department, source_url) values ($1, $2, 'c', 'Someone', 'Procurement', 'https://x.example')",
  [orgId, buyerId],
  "violates check constraint",
);
check("grade C carrying a name is rejected", gradeCWithName.ok, gradeCWithName.message);

const roleSignalId = (
  await db.query(
    `insert into public.decision_makers
       (organization_id, buyer_profile_id, grade, full_name, job_title, department, source_url, expires_at)
     values ($1, $2, 'c', null, 'Procurement Manager', 'Procurement', 'https://greatlakespackaging.example/careers', now() - interval '1 day')
     returning id`,
    [orgId, buyerId],
  )
).rows[0].id;
check("role signal without a name is accepted", Boolean(roleSignalId));

await db.query(
  `insert into public.contact_channels
     (organization_id, buyer_profile_id, decision_maker_id, market_source_id, channel_type, value, provenance, source_url, evidence_snippet, is_verified, verified_at, expires_at)
   values ($1, $2, $3, $4, 'email', 'procurement@greatlakespackaging.example', 'company_site',
           'https://greatlakespackaging.example/contact', 'Supplier enquiries: procurement@greatlakespackaging.example', true, now(), now() + interval '90 days')`,
  [orgId, buyerId, personId, websiteSourceId],
);
check("public company channel accepted", (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [buyerId])).rows[0].n === 1);

// 007: một giá trị confirmed phải chỉ ra được câu chữ đã thấy nó.
const confirmedWithoutQuote = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, source_url)
   values ($1, $2, 'email', 'quotecheck@greatlakespackaging.example', 'company_site', 'https://greatlakespackaging.example/contact')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("a confirmed channel without a quote is rejected", confirmedWithoutQuote.ok, confirmedWithoutQuote.message);

const evidenceMirror = (await db.query("select source_url, evidence_url from public.contact_channels where value = 'procurement@greatlakespackaging.example'")).rows[0];
check("evidence_url is the page it was read from", evidenceMirror.evidence_url === evidenceMirror.source_url, JSON.stringify(evidenceMirror));

// Guessing is allowed, but it must be labelled, short-lived and never claimed as ours.
const guessSetByCaller = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, source_url, is_guessed)
   values ($1, $2, 'email', 'dana.whitfield@greatlakespackaging.example', 'company_site', 'https://greatlakespackaging.example/contact', true)`,
  [orgId, buyerId],
  "non-DEFAULT value",
);
check("is_guessed is derived, callers cannot set it", guessSetByCaller.ok, guessSetByCaller.message);

const inferredNoBasis = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, certainty, expires_at)
   values ($1, $2, 'email', 'd.whitfield@greatlakespackaging.example', 'company_site', 'inferred', now() + interval '20 days')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("an inferred value must state what it was inferred from", inferredNoBasis.ok, inferredNoBasis.message);

const inferredDefaultLife = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, certainty, inference_basis)
   values ($1, $2, 'email', 'd.whitfield@greatlakespackaging.example', 'company_site', 'inferred', 'pattern: first initial + last')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("an inferred value cannot get the default 90-day life", inferredDefaultLife.ok, inferredDefaultLife.message);

const inferredClaimedVerified = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, certainty, inference_basis, is_verified, source_url, expires_at)
   values ($1, $2, 'email', 'd.whitfield@greatlakespackaging.example', 'company_site', 'inferred', 'pattern: first initial + last', true, 'https://x.example', now() + interval '20 days')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("an inferred value can never be marked verified", inferredClaimedVerified.ok, inferredClaimedVerified.message);

const inferredProfileUrl = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, certainty, inference_basis, expires_at)
   values ($1, $2, 'linkedin_url', 'https://www.linkedin.com/in/guess', 'company_site', 'inferred', 'pattern: name', now() + interval '20 days')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("a profile URL can never be inferred, only found", inferredProfileUrl.ok, inferredProfileUrl.message);

const deadButVerified = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, source_url, is_verified, deliverability)
   values ($1, $2, 'email', 'dead@greatlakespackaging.example', 'company_site', 'https://greatlakespackaging.example/contact', true, 'invalid')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("an address known to be dead cannot be marked verified", deadButVerified.ok, deadButVerified.message);

// The legitimate version of a guess: labelled, 20-day life, not claimed as ours.
const inferredChannelId = (
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, decision_maker_id, market_source_id, channel_type, value, provenance,
        certainty, discovered_by, inference_basis, expires_at)
     values ($1, $2, $3, $4, 'email', 'd.whitfield@greatlakespackaging.example', 'company_site',
             'inferred', 'inferred_pattern', 'pattern: first initial + last, company domain (mailbox check pending)', now() + interval '20 days')
     returning id`,
    [orgId, buyerId, personId, websiteSourceId],
  )
).rows[0].id;

const inferredRow = (await db.query("select is_guessed, certainty, deliverability, is_verified from public.contact_channels where id = $1", [inferredChannelId])).rows[0];
check("an inferred value is stored but flagged as a guess", inferredRow.is_guessed === true && inferredRow.certainty === "inferred" && inferredRow.is_verified === false, JSON.stringify(inferredRow));

// A profile URL that was actually found out in the open is fine.
const foundProfile = await db.query(
  `insert into public.contact_channels
     (organization_id, buyer_profile_id, decision_maker_id, channel_type, value, provenance, certainty, discovered_by, source_url, evidence_snippet)
   values ($1, $2, $3, 'linkedin_url', 'https://www.linkedin.com/in/dana-whitfield', 'company_site', 'confirmed', 'web_research_agent', 'https://greatlakespackaging.example/team',
           'Dana Whitfield, Procurement Manager — linkedin.com/in/dana-whitfield')
   returning id`,
  [orgId, buyerId, personId],
);
check("a found profile URL is accepted when the page is cited", Boolean(foundProfile.rows[0].id));

const orphanProfile = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, source_url, evidence_snippet)
   values ($1, $2, 'linkedin_url', 'https://www.linkedin.com/in/someone-else', 'company_site', 'https://greatlakespackaging.example/team',
           'Liên kết trên greatlakespackaging.example')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("a personal profile is never a company channel", orphanProfile.ok, orphanProfile.message);

// --- 007: lần kiểm tra thứ hai là đường duy nhất bật is_verified ---------------
const quotable = (
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, channel_type, value, provenance, source_url, evidence_snippet, identity_match)
     values ($1, $2, 'email', 'quoted@greatlakespackaging.example', 'company_site', 'https://greatlakespackaging.example/contact',
             'Purchasing: quoted@greatlakespackaging.example', 'department')
     returning id`,
    [orgId, buyerId],
  )
).rows[0].id;
const verifyOk = (await db.query("select public.verify_contact_channel($1) as ok", [quotable])).rows[0].ok;
const verifiedRow = (await db.query("select is_verified, verified_at, verified_by from public.contact_channels where id = $1", [quotable])).rows[0];
check(
  "a quoted channel can be verified, and the moment is recorded",
  verifyOk === true && verifiedRow.is_verified === true && Boolean(verifiedRow.verified_at) && verifiedRow.verified_by === "verifier",
  JSON.stringify(verifiedRow),
);
check("a guess can never be verified", (await db.query("select public.verify_contact_channel($1) as ok", [inferredChannelId])).rows[0].ok === false);

const deadButQuoted = (
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, channel_type, value, provenance, source_url, evidence_snippet, deliverability)
     values ($1, $2, 'email', 'bounced@greatlakespackaging.example', 'company_site', 'https://greatlakespackaging.example/contact',
             'Sales: bounced@greatlakespackaging.example', 'invalid')
     returning id`,
    [orgId, buyerId],
  )
).rows[0].id;
check("a mailbox known to be dead cannot be verified either", (await db.query("select public.verify_contact_channel($1) as ok", [deadButQuoted])).rows[0].ok === false);

// Hai dòng vừa tạo chỉ để thử hàm xác minh: dọn đi để các phép đếm phía sau
// vẫn đo đúng thứ chúng định đo.
await db.query("delete from public.contact_channels where id = any($1::uuid[])", [[quotable, deadButQuoted]]);

const privateChannel = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, is_public)
   values ($1, $2, 'phone', '+1 216 555 0143', 'company_site', false)`,
  [orgId, buyerId],
  "violates check constraint",
);
check("a non-public channel is rejected", privateChannel.ok, privateChannel.message);

const emailWithoutSource = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance)
   values ($1, $2, 'email', 'sales@greatlakespackaging.example', 'company_site')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("an email without a source url is rejected", emailWithoutSource.ok, emailWithoutSource.message);

const licensedWithoutSource = await expectFailure(
  `insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, source_url)
   values ($1, $2, 'phone', '+1 216 555 0143', 'licensed_contact_db', 'https://volza.com/x')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("licensed contact data must name its source row", licensedWithoutSource.ok, licensedWithoutSource.message);

const licensedChannelId = (
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, source_url, evidence_snippet, expires_at)
     values ($1, $2, $3, 'phone', '+1 216 555 0143', 'licensed_contact_db', 'https://volza.com/company/great-lakes-packaging',
             'Purchasing line: +1 216 555 0143', now() - interval '1 day')
     returning id`,
    [orgId, buyerId, licensedSourceId],
  )
).rows[0].id;
check("licensed channel accepted when the source is named", Boolean(licensedChannelId));

const orphanBuyerId = (
  await db.query(
    `insert into public.buyer_profiles (organization_id, legal_name, display_name, country, domain, created_at, last_signal_at)
     values ($1, 'FORGOTTEN BUYER LTD', 'Forgotten Buyer', 'United States', 'forgotten-buyer.example', now() - interval '60 days', null)
     returning id`,
    [orgId],
  )
).rows[0].id;

await db.query("set role authenticated");
await asUser(userA);
const visibleBuyers = (await db.query("select count(*)::int as n from public.buyer_profiles")).rows[0].n;
check("member reads own buyers", visibleBuyers === 2, `saw ${visibleBuyers}`);
check("member reads own people and channels", (await db.query("select count(*)::int as n from public.decision_makers")).rows[0].n === 2 && (await db.query("select count(*)::int as n from public.contact_channels")).rows[0].n === 4);
check("member reads the source catalogue", (await db.query("select count(*)::int as n from public.market_sources")).rows[0].n === sourceCount);

const clientWrite = await expectFailure(
  "insert into public.buyer_profiles (organization_id, legal_name, display_name, country) values ($1, 'Client', 'Client', 'United States')",
  [orgId],
  "permission denied",
);
check("members cannot create buyers from the client", clientWrite.ok, clientWrite.message);

const clientChannelWrite = await expectFailure(
  "insert into public.contact_channels (organization_id, buyer_profile_id, channel_type, value, provenance, source_url) values ($1, $2, 'email', 'x@y.example', 'company_site', 'https://y.example')",
  [orgId, buyerId],
  "permission denied",
);
check("members cannot add contact channels from the client", clientChannelWrite.ok, clientChannelWrite.message);

const verifyFromClient = await expectFailure("select public.verify_contact_channel(gen_random_uuid())", [], "permission denied");
check("members cannot mark a channel verified from the client", verifyFromClient.ok, verifyFromClient.message);
await db.query("reset role");

// --- 009: cổng Role và cổng Email -------------------------------------------
section("cổng Role và cổng Email (009)");
check(
  "ba nhãn của Email Gate suy đúng từ hai trục",
  (await db.query("select public.email_kind_for('person', 'confirmed') as a, public.email_kind_for('department', 'confirmed') as b, public.email_kind_for('company_general', 'confirmed') as c, public.email_kind_for('unknown', 'inferred') as d")).rows[0].a === "published_named" &&
    (await db.query("select public.email_kind_for('department', 'confirmed') as b")).rows[0].b === "published_role_mailbox" &&
    (await db.query("select public.email_kind_for('company_general', 'confirmed') as c")).rows[0].c === "published_role_mailbox" &&
    (await db.query("select public.email_kind_for('unknown', 'inferred') as d")).rows[0].d === "inferred_unverified",
);

const mismatchedKind = await expectFailure(
  `update public.contact_channels set email_kind = 'published_named' where value = 'd.whitfield@greatlakespackaging.example' and certainty = 'inferred'`,
  [],
  "contact_channels_email_kind_consistent",
);
check("không thể gán nhãn email ngược với cách địa chỉ được công bố", mismatchedKind.ok, mismatchedKind.message);

// Cổng Role: kênh của người có chức danh bán hàng không qua được; đổi sang thu
// mua thì qua. Kênh của bộ phận (không gắn người) luôn qua.
await db.query("update public.decision_makers set role_kind = 'sales' where id = $1", [personId]);
const salesGate = (await db.query("select passes_role_gate from public.contact_role_gate where channel_id = $1", [foundProfile.rows[0].id])).rows[0];
check("kênh của người bán hàng không qua cổng Role", salesGate.passes_role_gate === false, JSON.stringify(salesGate));

await db.query("update public.decision_makers set role_kind = 'procurement' where id = $1", [personId]);
const buyingGate = (await db.query("select passes_role_gate from public.contact_role_gate where channel_id = $1", [foundProfile.rows[0].id])).rows[0];
check("cùng kênh đó, người thu mua thì qua", buyingGate.passes_role_gate === true);

const noPersonGate = (await db.query("select passes_role_gate from public.contact_role_gate where channel_id = $1", [inferredChannelId])).rows[0];
check("kênh không gắn với người nào vẫn qua (đường bộ phận)", noPersonGate.passes_role_gate === true);

check(
  "email đã phân loại thì không bao giờ bị cổng Email chặn",
  (await db.query("select count(*)::int as n from public.contact_email_gate where channel_type = 'email' and email_kind <> 'unknown' and passes_email_gate = false")).rows[0].n === 0,
);
check(
  "email chưa phân loại được thì bị giữ lại kèm lý do, không lọt ra",
  (await db.query("select count(*)::int as n from public.contact_email_gate where channel_type = 'email' and email_kind = 'unknown' and blocked_reason = 'email_kind_unknown' and passes_email_gate = false")).rows[0].n >= 1,
);

await db.query("set role authenticated");
await asUser(userA);
check("thành viên đọc được cổng của workspace mình", (await db.query("select count(*)::int as n from public.contact_role_gate")).rows[0].n > 0);
await asUser(userB);
check("workspace khác không thấy cổng Role", (await db.query("select count(*)::int as n from public.contact_role_gate")).rows[0].n === 0);
check("workspace khác không thấy cổng Email", (await db.query("select count(*)::int as n from public.contact_email_gate")).rows[0].n === 0);
await asUser(userA);
// Trả lại đúng trạng thái mà phần sau đang chờ: vai authenticated, và danh tính
// là chủ workspace — quên bước này thì các phép kiểm phía dưới chạy nhầm người.

section("đối chiếu pháp nhân (011)");

// Hàm ghi của 011 chỉ cấp cho service_role — đúng như production, nơi tầng ghi
// dữ liệu chạy bằng service role. Ở đây bỏ vai `authenticated` để gọi nó, rồi
// trả lại vai đó ở cuối phần này cho các phép kiểm phía sau.
await db.query("reset role");

// Ghi một lần đối chiếu bằng chính hàm của migration — đây là đường mà tầng ứng
// dụng đi, nên kiểm ở đây là kiểm đúng thứ chạy thật.
const registryMatch = (
  await db.query(
    `select * from public.record_registry_match(
       $1, 'companies_house', 'UK Companies House',
       'https://find-and-update.company-information.service.gov.uk/company/99999999/officers',
       'Great Lakes Packaging LLC', 'GREAT LAKES PACKAGING LTD', '99999999',
       'active', '2014-08-19', 'SIC 46370', '{GREAT LAKES PACKAGING LIMITED}',
       '[{"name":"SMITH, Jane","role":"director","appointed_on":"2014-08-19"},
         {"name":"WHITFIELD, Dana","role":"director","appointed_on":"2019-07-02"},
         {"name":"  ","role":"director"}]'::jsonb
     )`,
    [buyerId],
  )
).rows[0];
check("ghi được một lần đối chiếu", registryMatch?.registered_name === "GREAT LAKES PACKAGING LTD", JSON.stringify(registryMatch));
check("organization_id suy từ buyer_profiles", registryMatch?.organization_id === orgId);
check("nối đúng dòng market_sources của sổ", (await db.query("select key from public.market_sources where id = $1", [registryMatch.market_source_id])).rows[0].key === "companies_house");
check(
  "người đương nhiệm thiếu tên bị bỏ, hai người còn lại được ghi",
  (await db.query("select count(*)::int as n from public.buyer_registry_officers where registry_match_id = $1", [registryMatch.id])).rows[0].n === 2,
);
check(
  "chức danh giữ nguyên như sổ ghi",
  (await db.query("select count(*)::int as n from public.buyer_registry_officers where registry_match_id = $1 and full_name = 'SMITH, Jane' and role_title = 'director' and appointed_on = '2014-08-19'", [registryMatch.id])).rows[0].n === 1,
);
check(
  "bảng người đương nhiệm không có cột liên hệ nào",
  (await db.query("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name in ('buyer_registry_matches','buyer_registry_officers') and column_name in ('email','phone','phone_e164','value')")).rows[0].n === 0,
);

// Chạy lại cùng kết quả: only the checked_at moves.
const registryBefore = (await db.query("select count(*)::int as n from public.buyer_registry_matches where buyer_profile_id = $1", [buyerId])).rows[0].n;
await db.query(
  `select public.record_registry_match($1, 'companies_house', 'UK Companies House',
     'https://find-and-update.company-information.service.gov.uk/company/99999999/officers',
     'Great Lakes Packaging LLC', 'GREAT LAKES PACKAGING LTD', '99999999',
     'active', '2014-08-19', 'SIC 46370', '{GREAT LAKES PACKAGING LIMITED}',
     '[{"name":"SMITH, Jane","role":"director","appointed_on":"2014-08-19"},
       {"name":"WHITFIELD, Dana","role":"director","appointed_on":"2019-07-02"}]'::jsonb)`,
  [buyerId],
);
check("chạy lại cùng kết quả → không thêm dòng", (await db.query("select count(*)::int as n from public.buyer_registry_matches where buyer_profile_id = $1", [buyerId])).rows[0].n === registryBefore);
check(
  "và không nhân đôi người đương nhiệm",
  (await db.query("select count(*)::int as n from public.buyer_registry_officers where registry_match_id = $1", [registryMatch.id])).rows[0].n === 2,
);

// Kết quả khác (đổi tình trạng): dòng mới, lịch sử còn nguyên.
await db.query(
  `select public.record_registry_match($1, 'companies_house', 'UK Companies House',
     'https://find-and-update.company-information.service.gov.uk/company/99999999/officers',
     'Great Lakes Packaging LLC', 'GREAT LAKES PACKAGING LTD', '99999999',
     'liquidation', '2014-08-19', 'SIC 46370', '{}',
     '[{"name":"SMITH, Jane","role":"director","appointed_on":"2014-08-19"}]'::jsonb)`,
  [buyerId],
);
check("tình trạng đổi → thêm dòng mới, giữ lịch sử", (await db.query("select count(*)::int as n from public.buyer_registry_matches where buyer_profile_id = $1", [buyerId])).rows[0].n === registryBefore + 1);
const latestRegistry = (await db.query("select status, registered_name, officer_count, registry_label, source_url from public.buyer_registry_latest where buyer_profile_id = $1", [buyerId])).rows[0];
check(
  "view đọc ra lần đối chiếu mới nhất kèm số người",
  latestRegistry?.status === "liquidation" && latestRegistry?.officer_count === 1,
  JSON.stringify(latestRegistry),
);
check("view ghi kèm nhãn cơ quan và trang nguồn", latestRegistry?.registry_label === "UK Companies House" && String(latestRegistry?.source_url).includes("company-information"));

// SEC EDGAR: cùng cơ chế, khác sổ.
await db.query(
  `select public.record_registry_match($1, 'sec_edgar', 'US SEC EDGAR',
     'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193',
     'Great Lakes Packaging LLC', 'GREAT LAKES PACKAGING INC', 'CIK 0000320193',
     'hồ sơ gần nhất 2025-10-31', null, 'Packaging', '{}', '[]'::jsonb)`,
  [buyerId],
);
check("hai sổ khác nhau cùng tồn tại cho một buyer", (await db.query("select count(distinct registry)::int as n from public.buyer_registry_matches where buyer_profile_id = $1", [buyerId])).rows[0].n === 2);
check("sổ không có người đương nhiệm vẫn ghi được", (await db.query("select count(*)::int as n from public.buyer_registry_latest where buyer_profile_id = $1", [buyerId])).rows[0].n === 1);

// Hàm từ chối những thứ không phải một lần đối chiếu.
await db.query("reset role");
const missingSource = await expectFailure(
  "select public.record_registry_match($1, 'companies_house', 'UK Companies House', '   ', 'Great Lakes Packaging LLC', 'GREAT LAKES PACKAGING LTD', null)",
  [buyerId],
  "Thiếu trang nguồn",
);
check("từ chối đối chiếu không có trang nguồn", missingSource.ok, missingSource.message);
const missingIdentity = await expectFailure(
  "select public.record_registry_match($1, 'companies_house', 'UK Companies House', 'https://example.test/x', 'Great Lakes Packaging LLC', null, null)",
  [buyerId],
  "Không có tên pháp nhân",
);
check("từ chối đối chiếu không nêu được pháp nhân", missingIdentity.ok, missingIdentity.message);
const missingLabel = await expectFailure(
  "select public.record_registry_match($1, 'companies_house', '  ', 'https://example.test/x', 'Great Lakes Packaging LLC', 'GREAT LAKES PACKAGING LTD', null)",
  [buyerId],
  "Thiếu nhãn sổ đăng ký",
);
check("từ chối đối chiếu thiếu nhãn cơ quan", missingLabel.ok, missingLabel.message);
const missingQuery = await expectFailure(
  "select public.record_registry_match($1, 'companies_house', 'UK Companies House', 'https://example.test/x', '   ', 'GREAT LAKES PACKAGING LTD', null)",
  [buyerId],
  "Thiếu tên đã dùng để tra",
);
check("từ chối đối chiếu không ghi lại tên đã tra", missingQuery.ok, missingQuery.message);
const unknownBuyer = await expectFailure(
  "select public.record_registry_match('44444444-4444-4444-4444-444444444444', 'companies_house', 'UK Companies House', 'https://example.test/x', 'X', 'X LTD', null)",
  [],
  "buyer_profile",
);
check("từ chối buyer không tồn tại", unknownBuyer.ok, unknownBuyer.message);
const badOfficers = await expectFailure(
  `select public.record_registry_match($1, 'companies_house', 'UK Companies House', 'https://example.test/x', 'X', 'X LTD', null, null, null, null, '{}', '{"name":"x"}'::jsonb)`,
  [buyerId],
  "mảng JSON",
);
check("từ chối danh sách người không phải mảng", badOfficers.ok, badOfficers.message);

// Người dùng thường: đọc được, không ghi được, không thấy workspace khác.
await db.query("set role authenticated");
await asUser(userA);
check("thành viên đọc được lần đối chiếu", (await db.query("select count(*)::int as n from public.buyer_registry_latest where buyer_profile_id = $1", [buyerId])).rows[0].n === 1);
check("thành viên đọc được người đương nhiệm", (await db.query("select count(*)::int as n from public.buyer_registry_officers")).rows[0].n > 0);
const directInsert = await expectFailure(
  "insert into public.buyer_registry_matches (organization_id, buyer_profile_id, market_source_id, registry, registry_label, source_url, queried_name, registered_name) values ($1, $2, $3, 'companies_house', 'UK Companies House', 'https://example.test/x', 'X', 'X LTD')",
  [orgId, buyerId, registrySourceId],
  "permission denied",
);
check("thành viên không ghi thẳng được vào bảng đối chiếu", directInsert.ok, directInsert.message);
await asUser(userB);
check("workspace khác không thấy đối chiếu pháp nhân", (await db.query("select count(*)::int as n from public.buyer_registry_matches")).rows[0].n === 0);
check("workspace khác không thấy người đương nhiệm", (await db.query("select count(*)::int as n from public.buyer_registry_officers")).rows[0].n === 0);
check("workspace khác không thấy view đối chiếu", (await db.query("select count(*)::int as n from public.buyer_registry_latest")).rows[0].n === 0);

// Trả lại đúng trạng thái phần sau đang chờ: vai authenticated, danh tính chủ workspace.
await asUser(userA);


// --- what may leave the building (export views) -------------------------------
const rawChannelCount = (await db.query("select count(*)::int as n from public.contact_channels")).rows[0].n;
const exportable = (await db.query("select value from public.outreach_ready_channels order by value")).rows.map((row) => row.value);
check("members can see the raw channel list", rawChannelCount === 4, `${rawChannelCount} rows`);
check("inferred email stays out of the export until it is checked", !exportable.includes("d.whitfield@greatlakespackaging.example"), exportable.join(", "));
check("expired licensed channel stays out of the export", !exportable.includes("+1 216 555 0143"), exportable.join(", "));
check(
  "citable channels are exportable",
  exportable.includes("procurement@greatlakespackaging.example") && exportable.includes("https://www.linkedin.com/in/dana-whitfield"),
  exportable.join(", "),
);

const contactsBefore = (await db.query("select outreach_grade, confidence_label, value from public.outreach_ready_contacts order by value")).rows;
check(
  "contacts export carries a grade and a confidence label",
  contactsBefore.length === 2 && contactsBefore.every((row) => ["a", "b", "c"].includes(row.outreach_grade) && row.confidence_label.length > 0),
  JSON.stringify(contactsBefore),
);
check(
  "a channel tied to a person grades A",
  contactsBefore.find((row) => row.value.startsWith("https://www.linkedin.com"))?.outreach_grade === "a",
  JSON.stringify(contactsBefore),
);

const summary = (await db.query("select display_name, reachable_channels, verified_channels, named_people, best_grade from public.buyer_outreach_summary")).rows;
check(
  "buyer summary lets the list screen rank buyers",
  summary.length === 2 &&
    summary.some((row) => row.display_name === "Great Lakes Packaging" && row.reachable_channels === 2 && row.verified_channels === 1 && row.named_people === 1 && row.best_grade === "a"),
  JSON.stringify(summary),
);

await asUser(userB);
check("another tenant sees no exportable channels", (await db.query("select count(*)::int as n from public.outreach_ready_channels")).rows[0].n === 0);
check("another tenant sees no exportable contacts", (await db.query("select count(*)::int as n from public.outreach_ready_contacts")).rows[0].n === 0);
check("another tenant sees no buyer summary", (await db.query("select count(*)::int as n from public.buyer_outreach_summary")).rows[0].n === 0);
await asUser(userA);

const viewWrite = await expectFailure(
  "insert into public.outreach_ready_contacts (buyer_name, channel_type, value) values ('X', 'email', 'x@y.example')",
  [],
  ["cannot insert into view", "permission denied", "not updatable"],
);
check("export views are read-only", viewWrite.ok, viewWrite.message);

await db.query("set role anon");
const anonView = await expectFailure("select count(*) from public.outreach_ready_channels", [], "permission denied");
check("signed-out visitors cannot read the export views", anonView.ok, anonView.message);

// After a verifier confirms the mailbox exists, the inferred row becomes exportable.
await db.query("reset role");
await db.query(
  "update public.contact_channels set deliverability = 'valid', deliverability_checked_at = now(), verified_by = 'millionverifier' where id = $1",
  [inferredChannelId],
);
await db.query("set role authenticated");
await asUser(userA);
const afterCheck = (await db.query("select value, confidence_label from public.outreach_ready_channels where id = $1", [inferredChannelId])).rows[0];
check("a deliverable inferred email becomes exportable, still labelled inferred", afterCheck?.confidence_label === "inferred", JSON.stringify(afterCheck));
const gradeRows = (await db.query("select value, outreach_grade from public.outreach_ready_contacts where channel_id = $1", [inferredChannelId])).rows;
check("that row exports with the right grade", gradeRows.length === 1 && gradeRows[0].outreach_grade === "a", JSON.stringify(gradeRows));

await db.query("reset role");
await db.query("update public.contact_channels set deliverability = 'invalid', deliverability_checked_at = now() where id = $1", [inferredChannelId]);
await db.query("set role authenticated");
await asUser(userA);
check("once a verifier says the mailbox is dead, it leaves the export", (await db.query("select count(*)::int as n from public.outreach_ready_channels where id = $1", [inferredChannelId])).rows[0].n === 0);


await asUser(userB);
check("other tenant sees no buyers", (await db.query("select count(*)::int as n from public.buyer_profiles")).rows[0].n === 0);
check("other tenant sees no people", (await db.query("select count(*)::int as n from public.decision_makers")).rows[0].n === 0);
check("other tenant sees no channels", (await db.query("select count(*)::int as n from public.contact_channels")).rows[0].n === 0);
await db.query("reset role");

section("personal data retention (005)");
const purged = (await db.query("select * from public.purge_expired_people(30)")).rows[0];
check("expired channels deleted", purged.deleted_channels === 1, JSON.stringify(purged));
check("expired people deleted", purged.deleted_decision_makers === 1, JSON.stringify(purged));
check("orphaned buyer profile deleted", purged.deleted_buyer_profiles === 1, JSON.stringify(purged));
check("current person kept", (await db.query("select count(*)::int as n from public.decision_makers where id = $1", [personId])).rows[0].n === 1);
check(
  "channels still in date are kept, the expired one is gone",
  (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [buyerId])).rows[0].n === 3 &&
    (await db.query("select count(*)::int as n from public.contact_channels where value = '+1 216 555 0143'")).rows[0].n === 0,
);
check("buyer with shipments kept", (await db.query("select count(*)::int as n from public.buyer_profiles where id = $1", [buyerId])).rows[0].n === 1);
check("trade signals untouched by retention", (await db.query("select count(*)::int as n from public.trade_signals")).rows[0].n === 1);
check("orphan profile is gone", (await db.query("select count(*)::int as n from public.buyer_profiles where id = $1", [orphanBuyerId])).rows[0].n === 0);
check("no candidates to sweep yet", purged.deleted_candidates === 0, JSON.stringify(purged));


section("contact candidates & verification (006)");

// --- A hypothesis, not a contact -------------------------------------------------
const candidateId = (
  await db.query(
    `insert into public.contact_candidates
       (organization_id, buyer_profile_id, decision_maker_id, market_source_id, channel_type, candidate_value,
        pattern_used, inference_basis, identity_match, expires_at)
     values ($1, $2, $3, $4, 'email', 'd.whitfield@greatlakespackaging.example',
             'first-initial.last@domain', 'Company publishes first-initial.last for staff, domain is catch-free', 'unknown', now() + interval '25 days')
     returning id`,
    [orgId, buyerId, personId, websiteSourceId],
  )
).rows[0].id;
check("candidate stored as a hypothesis", Boolean(candidateId));

const blankPattern = await expectFailure(
  `insert into public.contact_candidates (organization_id, buyer_profile_id, channel_type, candidate_value, pattern_used, inference_basis)
   values ($1, $2, 'email', 'x@y.example', '   ', 'nothing')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("a candidate must name the pattern it came from", blankPattern.ok, blankPattern.message);

const duplicateCandidate = await expectFailure(
  `insert into public.contact_candidates (organization_id, buyer_profile_id, channel_type, candidate_value, pattern_used, inference_basis)
   values ($1, $2, 'email', 'd.whitfield@greatlakespackaging.example', 'first.last@domain', 'again')`,
  [orgId, buyerId],
  "duplicate key",
);
check("the same candidate is not generated twice", duplicateCandidate.ok, duplicateCandidate.message);

// --- Verification is an event log, not a status column ---------------------------
await db.query(
  `insert into public.contact_verification_events (organization_id, candidate_id, provider, result, raw_response, cost_usd)
   values ($1, $2, 'millionverifier', 'valid', '{"result":"ok","role":false}'::jsonb, 0.0037)`,
  [orgId, candidateId],
);
check("verification event recorded", (await db.query("select count(*)::int as n from public.contact_verification_events where candidate_id = $1", [candidateId])).rows[0].n === 1);

const pendingResult = await expectFailure(
  `insert into public.contact_verification_events (organization_id, candidate_id, provider, result) values ($1, $2, 'millionverifier', 'not_checked')`,
  [orgId, candidateId],
  "violates check constraint",
);
check("an event cannot report 'not_checked'", pendingResult.ok, pendingResult.message);

const eventWithoutSubject = await expectFailure(
  `insert into public.contact_verification_events (organization_id, provider, result) values ($1, 'millionverifier', 'valid')`,
  [orgId],
  "violates check constraint",
);
check("an event must be about a candidate or a channel", eventWithoutSubject.ok, eventWithoutSubject.message);

const latest = (await db.query("select latest_result, latest_provider, is_expired from public.contact_candidate_status where id = $1", [candidateId])).rows[0];
check("candidate status exposes the newest check", latest.latest_result === "valid" && latest.latest_provider === "millionverifier" && latest.is_expired === false, JSON.stringify(latest));

// A history, not an overwrite.
await db.query(
  `insert into public.contact_verification_events (organization_id, candidate_id, provider, result, raw_response)
   values ($1, $2, 'neverbounce', 'catch_all', '{"result":"catch_all"}'::jsonb)`,
  [orgId, candidateId],
);
const newest = (await db.query("select latest_result from public.contact_candidate_status where id = $1", [candidateId])).rows[0].latest_result;
check("the newest check wins, the older one is still on file", newest === "catch_all" && (await db.query("select count(*)::int as n from public.contact_verification_events where candidate_id = $1", [candidateId])).rows[0].n === 2);

// A candidate on its own never reaches the export.
check("a candidate alone is not exportable", (await db.query("select count(*)::int as n from public.outreach_ready_channels where value = 'd.whitfield@greatlakespackaging.example'")).rows[0].n === 0);

// --- Promotion: candidate becomes a labelled channel ----------------------------
const promotedChannelId = (
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, decision_maker_id, market_source_id, channel_type, value, provenance,
        certainty, discovered_by, inference_basis, identity_match, deliverability, deliverability_checked_at, verified_by, expires_at)
     values ($1, $2, $3, $4, 'email', 'd.whitfield@greatlakespackaging.example', 'company_site',
             'inferred', 'inferred_pattern', 'first-initial.last@domain', 'unknown', 'valid', now(), 'millionverifier', now() + interval '25 days')
     returning id`,
    [orgId, buyerId, personId, websiteSourceId],
  )
).rows[0].id;

await db.query("update public.contact_candidates set status = 'promoted', promoted_channel_id = $1 where id = $2", [promotedChannelId, candidateId]);
const promoted = (await db.query("select status, promoted_channel_id from public.contact_candidates where id = $1", [candidateId])).rows[0];
check("promotion links the candidate to the channel it became", promoted.status === "promoted" && promoted.promoted_channel_id === promotedChannelId);

const promotionWithoutChannel = await expectFailure(
  "update public.contact_candidates set promoted_channel_id = null where id = $1",
  [candidateId],
  "violates check constraint",
);
check("a candidate cannot stay promoted without pointing at its channel", promotionWithoutChannel.ok, promotionWithoutChannel.message);

// --- The policy decides, and says why -------------------------------------------
const policy = (await db.query("select exportable, requires_override, outreach_eligible, blocked_reason, confidence_label, deliverability_checked from public.contact_export_policy where id = $1", [promotedChannelId])).rows[0];
check(
  "an inferred but deliverable email is exportable with an override, never outreach-ready",
  policy.exportable === true && policy.requires_override === true && policy.outreach_eligible === false && policy.blocked_reason === "identity_unconfirmed" && policy.confidence_label === "inferred",
  JSON.stringify(policy),
);

const confirmedEmailPolicy = (
  await db.query("select exportable, outreach_eligible, blocked_reason from public.contact_export_policy where value = 'procurement@greatlakespackaging.example'")
).rows[0];
check(
  "a published company address exports but needs a mailbox check before sending",
  confirmedEmailPolicy.exportable === true && confirmedEmailPolicy.outreach_eligible === false && confirmedEmailPolicy.blocked_reason === "deliverability_unchecked",
  JSON.stringify(confirmedEmailPolicy),
);

const profilePolicy = (
  await db.query("select exportable, outreach_eligible, blocked_reason from public.contact_export_policy where value = 'https://www.linkedin.com/in/dana-whitfield'")
).rows[0];
check(
  "a profile link is exportable but never auto-contacted",
  profilePolicy.exportable === true && profilePolicy.outreach_eligible === false && profilePolicy.blocked_reason === "manual_contact_only",
  JSON.stringify(profilePolicy),
);

// catch_all is not good enough: the domain accepts every address.
const catchAllChannelId = (
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, channel_type, value, provenance, certainty, discovered_by, inference_basis,
        identity_match, deliverability, deliverability_checked_at, verified_by, expires_at)
     values ($1, $2, 'email', 'purchasing@greatlakespackaging.example', 'company_site', 'inferred', 'inferred_pattern',
             'role mailbox guess', 'department', 'catch_all', now(), 'millionverifier', now() + interval '25 days')
     returning id`,
    [orgId, buyerId],
  )
).rows[0].id;
const catchAllPolicy = (await db.query("select exportable, requires_override, outreach_eligible, blocked_reason from public.contact_export_policy where id = $1", [catchAllChannelId])).rows[0];
check(
  "a catch-all result blocks export by default and asks for an override",
  catchAllPolicy.exportable === false && catchAllPolicy.requires_override === true && catchAllPolicy.outreach_eligible === false && catchAllPolicy.blocked_reason === "catch_all_needs_override",
  JSON.stringify(catchAllPolicy),
);
check("catch-all rows are absent from the export view", (await db.query("select count(*)::int as n from public.outreach_ready_channels where id = $1", [catchAllChannelId])).rows[0].n === 0);

// --- Department-first routes -----------------------------------------------------
const routeId = (
  await db.query(
    `insert into public.buyer_routes
       (organization_id, buyer_profile_id, market_source_id, route_kind, department, url, source_url, evidence_snippet, discovered_by)
     values ($1, $2, $3, 'vendor_registration', 'Procurement', 'https://greatlakespackaging.example/suppliers/register',
             'https://greatlakespackaging.example/suppliers', 'Become a supplier: complete our registration form.', 'web_research_agent')
     returning id`,
    [orgId, buyerId, websiteSourceId],
  )
).rows[0].id;
check("vendor registration route stored", Boolean(routeId));

const routeWithoutUrl = await expectFailure(
  `insert into public.buyer_routes (organization_id, buyer_profile_id, route_kind, source_url) values ($1, $2, 'supplier_portal', 'https://x.example')`,
  [orgId, buyerId],
  "violates check constraint",
);
check("a portal route must actually have a URL", routeWithoutUrl.ok, routeWithoutUrl.message);

const duplicateRoute = await expectFailure(
  `insert into public.buyer_routes (organization_id, buyer_profile_id, route_kind, url, source_url)
   values ($1, $2, 'vendor_registration', 'https://greatlakespackaging.example/suppliers/register', 'https://greatlakespackaging.example/suppliers')`,
  [orgId, buyerId],
  "duplicate key",
);
check("the same route is not stored twice", duplicateRoute.ok, duplicateRoute.message);

// --- Tenant isolation on the new tables ------------------------------------------
await db.query("set role authenticated");
await asUser(userA);
check("member reads own candidates, events and routes", (await db.query("select count(*)::int as n from public.contact_candidates")).rows[0].n === 1 && (await db.query("select count(*)::int as n from public.contact_verification_events")).rows[0].n === 2 && (await db.query("select count(*)::int as n from public.buyer_routes")).rows[0].n === 1);
check("member reads own policy rows", (await db.query("select count(*)::int as n from public.contact_export_policy")).rows[0].n > 0);

const clientCandidateWrite = await expectFailure(
  "insert into public.contact_candidates (organization_id, buyer_profile_id, channel_type, candidate_value, pattern_used, inference_basis) values ($1, $2, 'email', 'a@b.example', 'p', 'b')",
  [orgId, buyerId],
  "permission denied",
);
check("members cannot create candidates from the client", clientCandidateWrite.ok, clientCandidateWrite.message);

const clientEventWrite = await expectFailure(
  "insert into public.contact_verification_events (organization_id, candidate_id, provider, result) values ($1, $2, 'fake', 'valid')",
  [orgId, candidateId],
  "permission denied",
);
check("members cannot forge verification events", clientEventWrite.ok, clientEventWrite.message);

await asUser(userB);
check("other tenant sees no candidates", (await db.query("select count(*)::int as n from public.contact_candidates")).rows[0].n === 0);
check("other tenant sees no verification events", (await db.query("select count(*)::int as n from public.contact_verification_events")).rows[0].n === 0);
check("other tenant sees no routes", (await db.query("select count(*)::int as n from public.buyer_routes")).rows[0].n === 0);
check("other tenant sees no policy rows", (await db.query("select count(*)::int as n from public.contact_export_policy")).rows[0].n === 0);
await db.query("reset role");

await db.query("set role anon");
const anonPolicy = await expectFailure("select count(*) from public.contact_export_policy", [], "permission denied");
check("signed-out visitors cannot read the policy view", anonPolicy.ok, anonPolicy.message);
await db.query("reset role");

// --- Candidates expire too -------------------------------------------------------
const staleCandidateId = (
  await db.query(
    `insert into public.contact_candidates (organization_id, buyer_profile_id, channel_type, candidate_value, pattern_used, inference_basis, expires_at)
     values ($1, $2, 'email', 'stale@greatlakespackaging.example', 'first@domain', 'old guess', now() - interval '2 days')
     returning id`,
    [orgId, buyerId],
  )
).rows[0].id;

// A buyer we only have a route into: still a live target, must not be swept.
const routeOnlyBuyerId = (
  await db.query(
    `insert into public.buyer_profiles (organization_id, legal_name, display_name, country, domain, created_at, last_signal_at)
     values ($1, 'ROUTE ONLY LTD', 'Route Only', 'United Kingdom', 'route-only.example', now() - interval '90 days', null)
     returning id`,
    [orgId],
  )
).rows[0].id;
await db.query(
  `insert into public.buyer_routes (organization_id, buyer_profile_id, route_kind, department, url, source_url)
   values ($1, $2, 'supplier_portal', 'Procurement', 'https://route-only.example/suppliers', 'https://route-only.example/suppliers')`,
  [orgId, routeOnlyBuyerId],
);

const sweep = (await db.query("select * from public.purge_expired_people(30)")).rows[0];
check("expired candidates are swept", sweep.deleted_candidates === 1, JSON.stringify(sweep));
check("stale candidate is gone", (await db.query("select count(*)::int as n from public.contact_candidates where id = $1", [staleCandidateId])).rows[0].n === 0);
check("verified candidate survives the sweep", (await db.query("select count(*)::int as n from public.contact_candidates where id = $1", [candidateId])).rows[0].n === 1);
check("a buyer reachable only through a route is not treated as orphaned", (await db.query("select count(*)::int as n from public.buyer_profiles where id = $1", [routeOnlyBuyerId])).rows[0].n === 1);

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
