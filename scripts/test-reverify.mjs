#!/usr/bin/env node
/**
 * Kiểm việc đọc lại một kênh (cổng Freshness, migration 010).
 *
 *   npm run reverify:test
 *
 * Hai phần:
 *  1. Phần thuần: so giá trị theo từng loại kênh, ba câu trả lời, và cách xử lý
 *     khi trang đổi câu chữ hoặc không mở được.
 *  2. Phần SQL: chạy trên Postgres thật (PGlite, đủ 10 migration) — hàng đợi chọn
 *     đúng kênh tới hạn, và mỗi kết quả áp đúng hệ quả của nó.
 *
 * Điều quan trọng nhất được kiểm ở đây: **`unreachable` không được hạ kênh**.
 * Một lần mạng lỗi mà xoá dữ liệu của khách hàng là dùng sự cố của mình để nói
 * dối về dữ liệu của họ.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleTs } from "./lib/ts-module.mjs";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const workDir = path.join(root, ".reverify-test");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function bootDatabase() {
  const db = new PGlite();
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
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);

  const migrationsDir = path.join(root, "supabase/migrations");
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    let sql = readFileSync(path.join(migrationsDir, name), "utf8");
    for (const extension of ["pgcrypto", "pg_cron", "pg_net"]) {
      const pattern = new RegExp(`create extension if not exists "?${extension}"?;`, "i");
      if (pattern.test(sql)) sql = sql.replace(pattern, `-- ${extension} skipped in the local harness`);
    }
    try {
      await db.exec(sql);
    } catch (error) {
      console.error(`✗ failed ${name}: ${error.message}`);
      process.exit(1);
    }
  }
  return { db, migrationCount: files.length };
}

async function main() {
  await mkdir(workDir, { recursive: true });
  const entryPath = path.join(workDir, "entry.ts");
  const bundlePath = path.join(workDir, "bundle.mjs");
  await writeFile(
    entryPath,
    `import { reverifyChannel, reverifyChannels, valueAppears, evidenceLineFor, sameValue, summarizeReverification, toReverificationRecord } from "@/lib/connector/reverify";
export const api = { reverifyChannel, reverifyChannels, valueAppears, evidenceLineFor, sameValue, summarizeReverification, toReverificationRecord };
`,
    "utf8",
  );
  await bundleTs(entryPath, bundlePath);
  const { api } = await import(pathToFileURL(bundlePath).href);

  // ---------------------------------------------------- 1. phần thuần --------
  section("so giá trị theo từng loại kênh");
  check("số điện thoại: khác dấu phân cách vẫn là cùng số", api.valueAppears("Call 707 452 2800 today", "phone", "707-452-2800"));
  check("số điện thoại: số khác thì không khớp", !api.valueAppears("Call 707 452 2811 today", "phone", "707-452-2800"));
  check("email: so đúng chuỗi", api.valueAppears("Contact ssousa@mariani.com", "email", "ssousa@mariani.com"));
  check("email: tên miền khác thì không khớp", !api.valueAppears("Contact ssousa@other.com", "email", "ssousa@mariani.com"));
  check("LinkedIn: bỏ dấu / cuối", api.valueAppears("see linkedin.com/company/mariani/", "linkedin", "linkedin.com/company/mariani"));
  check("sameValue bỏ dấu phân cách và dấu / cuối", api.sameValue("+1 707-452-2800", "+17074522800") && api.sameValue("https://x.com/a/", "https://x.com/a"));
  check("trích được dòng chứa giá trị", api.evidenceLineFor(["Nothing here", "Phone: 707-452-2800"], "phone", "707-452-2800") === "Phone: 707-452-2800");

  section("ba câu trả lời");
  // Mock phải giống Response thật ở đúng những gì fetch.ts dùng: `ok`, `status`,
  // `url`, `headers.get(...)` và `text()`. Thiếu `headers.get` là fetch.ts coi
  // như trang lỗi — và đó chính là lỗi mình vừa gặp khi viết test này.
  const page = (body, status = 200, contentType = "text/html; charset=utf-8") =>
    async (url) => ({
      ok: status >= 200 && status < 300,
      status,
      url: String(url),
      headers: { get: () => contentType },
      text: async () => (status >= 200 && status < 300 ? body : ""),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    });

  const noGuard = async () => {};

  const stillThere = await api.reverifyChannel(
    { channelId: "c1", channelType: "phone", value: "707-452-2800", sourceUrl: "https://acme.example/contact", expectedEvidence: "Phone: 707-452-2800" },
    { fetchImpl: page("<p>Phone: 707-452-2800</p>"), guard: noGuard, delayMs: 0, log: () => {} },
  );
  check("còn thấy → still_present, kèm câu chữ", stillThere.outcome === "still_present" && stillThere.evidenceSnippet?.includes("707"), JSON.stringify(stillThere));

  const noLonger = await api.reverifyChannel(
    { channelId: "c2", channelType: "email", value: "ssousa@mariani.com", sourceUrl: "https://acme.example/contact" },
    { fetchImpl: page("<p>Email: sales@acme.example</p>"), guard: noGuard, delayMs: 0, log: () => {} },
  );
  check("trang mở được nhưng không còn giá trị → gone", noLonger.outcome === "gone");
  check("gone thì không bịa câu chữ", noLonger.evidenceSnippet === undefined);

  const broken = await api.reverifyChannel(
    { channelId: "c3", channelType: "email", value: "ssousa@mariani.com", sourceUrl: "https://acme.example/contact" },
    { fetchImpl: page("", 500), guard: noGuard, delayMs: 0, log: () => {} },
  );
  check("trang lỗi → unreachable, không phải gone", broken.outcome === "unreachable" && broken.outcome !== "gone", JSON.stringify(broken));
  check("unreachable có lý do đọc được", Boolean(broken.reason));

  const loginWall = await api.reverifyChannel(
    { channelId: "c4", channelType: "email", value: "x@y.example", sourceUrl: "https://acme.example/login" },
    { fetchImpl: page("<html>Please sign in</html>"), guard: noGuard, delayMs: 0, log: () => {} },
  );
  check("trang đăng nhập vẫn là unreachable, không vượt cổng", loginWall.outcome === "unreachable");

  const wordingChanged = await api.reverifyChannel(
    { channelId: "c5", channelType: "phone", value: "707-452-2800", sourceUrl: "https://acme.example/contact", expectedEvidence: "Phone: 707-452-2800" },
    { fetchImpl: page("<p>Switchboard +1 (707) 452 2800 — ext 12</p>"), guard: noGuard, delayMs: 0, log: () => {} },
  );
  check("câu chữ quanh giá trị đổi vẫn là còn thấy (sự thật là sự thật)", wordingChanged.outcome === "still_present" && wordingChanged.reason?.includes("khác"), JSON.stringify(wordingChanged));

  section("một lượt chạy");
  const run = await api.reverifyChannels(
    [
      { channelId: "a", channelType: "phone", value: "707-452-2800", sourceUrl: "https://acme.example/contact" },
      { channelId: "b", channelType: "email", value: "x@acme.example", sourceUrl: "https://acme.example/contact" },
    ],
    { fetchImpl: page("<p>Phone: 707-452-2800</p>"), guard: noGuard, delayMs: 0, log: () => {} },
  );
  const summary = api.summarizeReverification(run);
  check("tổng kết đếm đúng từng loại", summary.checked === 2 && summary.stillPresent === 1 && summary.gone === 1 && summary.unreachable === 0, JSON.stringify(summary));
  check("chuyển thành tham số ghi DB", api.toReverificationRecord(run[0]).p_channel_id === "a" && api.toReverificationRecord(run[0]).p_outcome === "still_present");

  // ---------------------------------------------------- 2. phần SQL ----------
  section("SQL: hàng đợi và hệ quả (PGlite, đủ 10 migration)");
  const { db, migrationCount } = await bootDatabase();
  check(`áp dụng đủ migration (${migrationCount})`, migrationCount === 12, String(migrationCount));

  await db.query(
    `insert into auth.users (id, email) values ($1, 'owner@example.com')`,
    ["aaaaaaaa-0000-0000-0000-000000000001"],
  );
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", ["aaaaaaaa-0000-0000-0000-000000000001"]);
  const orgId = (await db.query("select public.bootstrap_workspace('Acme Research') as id")).rows[0].id;
  const sourceId = (await db.query("select id from public.market_sources where key = 'company_website'")).rows[0].id;

  const buyerId = (
    await db.query(
      `insert into public.buyer_profiles (organization_id, legal_name, display_name, country, domain, website)
       values ($1, 'Acme Foods', 'Acme Foods', 'United States', 'acme.example', 'https://acme.example') returning id`,
      [orgId],
    )
  ).rows[0].id;

  // Kênh mới thấy hôm nay: chưa tới hạn đọc lại.
  const freshId = (
    await db.query(
      `insert into public.contact_channels
         (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, discovered_by, identity_match, source_url, evidence_snippet)
       values ($1, $2, $3, 'email', 'fresh@acme.example', 'company_site', 'web_research_agent', 'department', 'https://acme.example/contact', 'Email: fresh@acme.example') returning id`,
      [orgId, buyerId, sourceId],
    )
  ).rows[0].id;

  // Kênh thấy 120 ngày trước: tới hạn.
  const staleId = (
    await db.query(
      `insert into public.contact_channels
         (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, discovered_by, identity_match, source_url, evidence_snippet, last_seen_at, expires_at)
       values ($1, $2, $3, 'phone', '707-452-2800', 'company_site', 'web_research_agent', 'company_general', 'https://acme.example/contact', 'Phone: 707-452-2800',
               now() - interval '120 days', now() + interval '30 days') returning id`,
      [orgId, buyerId, sourceId],
    )
  ).rows[0].id;

  // Kênh từ nguồn mua: không tự đọc lại bằng cách mở trang web.
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, discovered_by, source_url, evidence_snippet, last_seen_at, expires_at)
     values ($1, $2, (select id from public.market_sources where key = 'volza'), 'phone', '+1 216 555 0143', 'licensed_contact_db', 'licensed_db', 'https://volza.com/x', 'Licensed record', now() - interval '200 days', now() + interval '30 days')`,
    [orgId, buyerId],
  );

  // Kênh đã đánh dấu là chết: không đọc lại làm gì.
  await db.query(
    `insert into public.contact_channels
       (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, discovered_by, source_url, evidence_snippet, deliverability, last_seen_at, expires_at)
     values ($1, $2, $3, 'email', 'dead@acme.example', 'company_site', 'web_research_agent', 'https://acme.example/contact', 'Email: dead@acme.example', 'invalid', now() - interval '150 days', now() + interval '30 days')`,
    [orgId, buyerId, sourceId],
  );

  const queue = (await db.query("select channel_id, days_since_seen from public.contact_reverify_queue order by days_since_seen desc")).rows;
  check(
    "hàng đợi chỉ gồm kênh website còn hạn (không có kênh mua dữ liệu, không có kênh đã chết)",
    queue.length === 2 && queue.every((row) => [freshId, staleId].includes(row.channel_id)),
    JSON.stringify(queue),
  );
  check("kênh mới thấy hôm nay ở mức 0 ngày", queue.find((row) => row.channel_id === freshId)?.days_since_seen === 0);
  check("kênh cũ ghi rõ đã 120 ngày", queue.find((row) => row.channel_id === staleId)?.days_since_seen >= 119);
  const dueNow = (await db.query("select count(*)::int as n from public.contact_reverify_queue where days_since_seen >= 90")).rows[0].n;
  check("lọc theo ngưỡng 90 ngày còn đúng một kênh", dueNow === 1, String(dueNow));

  const beforeStill = (await db.query("select last_seen_at, expires_at from public.contact_channels where id = $1", [staleId])).rows[0];

  const stillRecord = (await db.query("select * from public.record_contact_reverification($1, 'still_present', $2, $3)", [staleId, "https://acme.example/contact", "Phone: 707-452-2800"])).rows[0];
  check("ghi được kết quả still_present", stillRecord?.outcome === "still_present");
  const afterStill = (await db.query("select last_seen_at, expires_at, verified_at, is_verified from public.contact_channels where id = $1", [staleId])).rows[0];
  check(
    "still_present làm mới last_seen_at và hạn",
    new Date(afterStill.last_seen_at).getTime() > new Date(beforeStill.last_seen_at).getTime() &&
      new Date(afterStill.expires_at).getTime() > new Date(beforeStill.expires_at).getTime(),
    JSON.stringify({ before: beforeStill, after: afterStill }),
  );
  check("still_present đẩy verified_at tiến lên", afterStill.verified_at !== null);
  check("kênh vẫn chưa bị hạ", (await db.query("select count(*)::int as n from public.contact_channels where id = $1 and expires_at > now()", [staleId])).rows[0].n === 1);

  // unreachable: không được thay đổi gì cả.
  const beforeUnreachable = (await db.query("select last_seen_at, expires_at, is_verified from public.contact_channels where id = $1", [staleId])).rows[0];
  await db.query("select public.record_contact_reverification($1, 'unreachable', $2, null, null, 'HTTP 503')", [staleId, "https://acme.example/contact"]);
  const afterUnreachable = (await db.query("select last_seen_at, expires_at, is_verified from public.contact_channels where id = $1", [staleId])).rows[0];
  check(
    "unreachable KHÔNG thay đổi hạn hay lần thấy cuối",
    new Date(afterUnreachable.expires_at).getTime() === new Date(beforeUnreachable.expires_at).getTime() &&
      new Date(afterUnreachable.last_seen_at).getTime() === new Date(beforeUnreachable.last_seen_at).getTime(),
    JSON.stringify({ before: beforeUnreachable, after: afterUnreachable }),
  );

  // gone: kênh rơi khỏi danh sách xuất.
  check("trước đó kênh còn xuất được", (await db.query("select count(*)::int as n from public.contact_export_policy where id = $1 and exportable", [freshId])).rows[0].n === 1);
  await db.query("select public.record_contact_reverification($1, 'gone', $2, null, null, 'không còn thấy trên trang')", [freshId, "https://acme.example/contact"]);
  const afterGone = (await db.query("select expires_at, is_verified, verification_note from public.contact_channels where id = $1", [freshId])).rows[0];
  check("gone hạ hạn để rơi khỏi danh sách xuất", new Date(afterGone.expires_at) < new Date());
  check("gone mất cờ xác minh và ghi lại lý do", afterGone.is_verified === false && String(afterGone.verification_note).includes("không còn thấy"));
  check("kênh đã hết hạn không còn exportable", (await db.query("select count(*)::int as n from public.contact_export_policy where id = $1 and exportable", [freshId])).rows[0].n === 0);
  check("dòng dữ liệu vẫn ở lại (lịch sử là sự thật)", (await db.query("select count(*)::int as n from public.contact_channels where id = $1", [freshId])).rows[0].n === 1);

  // changed: kênh cũ hết hiệu lực, và lần đọc lại phải nói giá trị mới là gì.
  let changedWithoutValue = "";
  try {
    await db.query("select public.record_contact_reverification($1, 'changed', $2)", [staleId, "https://acme.example/contact"]);
  } catch (error) {
    changedWithoutValue = error.message;
  }
  check("changed mà không nói giá trị mới thì bị từ chối", changedWithoutValue.includes("contact_reverifications"), changedWithoutValue);

  // still_present mà không có câu chữ: cũng bị từ chối.
  let stillWithoutQuote = "";
  try {
    await db.query("select public.record_contact_reverification($1, 'still_present', $2)", [freshId, "https://acme.example/contact"]);
  } catch (error) {
    stillWithoutQuote = error.message;
  }
  check("still_present mà không có câu chữ thì bị từ chối", stillWithoutQuote.includes("contact_reverifications"), stillWithoutQuote);

  check("sổ đọc lại giữ đủ lịch sử", (await db.query("select count(*)::int as n from public.contact_reverifications")).rows[0].n >= 3);

  // Cách ly tenant.
  await db.query(`insert into auth.users (id, email) values ($1, 'other@example.com')`, ["bbbbbbbb-0000-0000-0000-000000000002"]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", ["bbbbbbbb-0000-0000-0000-000000000002"]);
  await db.query("select public.bootstrap_workspace('Other Research')");
  await db.query("set role authenticated");
  check("workspace khác không thấy kênh", (await db.query("select count(*)::int as n from public.contact_channels")).rows[0].n === 0);
  check("workspace khác không thấy hàng đợi đọc lại", (await db.query("select count(*)::int as n from public.contact_reverify_queue")).rows[0].n === 0);
  check("workspace khác không thấy sổ đọc lại", (await db.query("select count(*)::int as n from public.contact_reverifications")).rows[0].n === 0);
  await db.query("reset role");

  await db.close();
  await rm(workDir, { recursive: true, force: true });
  console.log(`\n${passed} check pass, ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
