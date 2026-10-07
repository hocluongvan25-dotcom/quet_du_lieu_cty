#!/usr/bin/env node
/**
 * Kiểm tầng ghi connector → database.
 *
 *   npm run persist:test
 *
 * Hai phần, không cần mạng và không cần Supabase:
 *
 *  1. Dựng dữ liệu (hàm thuần): thiếu gì thì từ chối, thừa gì thì bỏ, và
 *     không bao giờ sinh email theo pattern.
 *  2. Ghi thật vào Postgres trong tiến trình (PGlite) với đúng 10 migration,
 *     rồi đọc lại qua chính các view mà ứng dụng dùng
 *     (`contact_export_policy`, `buyer_outreach_summary`, `outreach_ready_contacts`).
 *
 * Phần 2 là chỗ trả lời câu hỏi "ghi xong thì người dùng thấy gì": mỗi dòng
 * phải có nguồn, `is_verified` phải là false, `contact_candidates` phải trống,
 * và chạy lại lần hai không được nhân đôi dữ liệu.
 */

import { readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const workDir = path.join(root, ".persist-test");

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

// ------------------------------------------------------- dữ liệu connector mẫu

/** Một kết quả connector điển hình: có người, có kênh bộ phận, có trang mua hàng. */
function sampleResult(overrides = {}) {
  const email = {
    type: "email",
    value: "procurement@acme.example",
    label: "Email bộ phận",
    identityMatch: "department",
    certainty: "confirmed",
    policy: "needs_mailbox_check",
    sourceUrl: "https://acme.example/procurement",
    evidenceSnippet: "Supplier enquiries: procurement@acme.example",
  };
  const switchboard = {
    type: "phone",
    value: "707-452-2800",
    e164: "+17074522800",
    label: "Điện thoại công bố",
    identityMatch: "company_general",
    certainty: "confirmed",
    policy: "outreach_ready",
    sourceUrl: "https://acme.example/contact",
    evidenceSnippet: "Phone: 707-452-2800",
  };
  const personal = {
    type: "email",
    value: "dana.whitfield@acme.example",
    label: "Email công bố — Dana Whitfield",
    identityMatch: "person",
    certainty: "confirmed",
    policy: "needs_mailbox_check",
    sourceUrl: "https://acme.example/procurement",
    evidenceSnippet: "Dana Whitfield, Procurement Manager — dana.whitfield@acme.example",
    personName: "Dana Whitfield",
    personTitle: "Procurement Manager",
  };

  return {
    seedUrl: "https://acme.example",
    domain: "acme.example",
    pages: [
      { url: "https://acme.example/procurement", status: 200, channels: 3 },
      { url: "https://acme.example/become-a-supplier", status: 200, channels: 0 },
      { url: "https://acme.example/cart", status: 404, channels: 0 },
      { url: "https://acme.example/robots.txt", status: "blocked", channels: 0 },
    ],
    channels: [email, personal, switchboard],
    people: [
      {
        id: "person-dana-whitfield",
        name: "Dana Whitfield",
        title: "Procurement Manager",
        sourceUrl: "https://acme.example/procurement",
        evidenceSnippet: "Dana Whitfield, Procurement Manager — dana.whitfield@acme.example",
        channelValues: ["dana.whitfield@acme.example"],
      },
    ],
    requirements: [],
    notes: [],
    pagesFetched: 2,
    ...overrides,
  };
}

// ------------------------------------------------------------------ shim SQL --

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

/**
 * `BuyerStore` chạy thẳng SQL. Trong production là PostgREST qua service role;
 * ở đây là Postgres thật, nên ràng buộc và check của migration được kiểm thật.
 */
function pgliteStore(db) {
  return {
    async findMarketSourceId(key) {
      const { rows } = await db.query("select id from public.market_sources where key = $1", [key]);
      return rows[0]?.id ?? null;
    },

    async upsertBuyerProfile(row) {
      const { rows } = await db.query(
        `insert into public.buyer_profiles (organization_id, legal_name, display_name, country, domain, website)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (organization_id, domain) do update
           set display_name = excluded.display_name,
               legal_name = excluded.legal_name,
               country = excluded.country,
               website = excluded.website,
               updated_at = now()
         returning id`,
        [row.organizationId, row.legal_name, row.display_name, row.country, row.domain, row.website],
      );
      return rows[0].id;
    },

    async listPeople(buyerProfileId) {
      const { rows } = await db.query("select id, full_name from public.decision_makers where buyer_profile_id = $1", [buyerProfileId]);
      return rows;
    },

    async insertPeople(rows) {
      const out = [];
      for (const row of rows) {
        const result = await db.query(
          `insert into public.decision_makers
             (organization_id, buyer_profile_id, market_source_id, full_name, job_title, role_kind, department, grade, source_url, corroboration_count)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           returning id, full_name`,
          [row.organization_id, row.buyer_profile_id, row.market_source_id, row.full_name, row.job_title, row.role_kind ?? "unknown", row.department, row.grade, row.source_url, row.corroboration_count],
        );
        out.push(result.rows[0]);
      }
      return out;
    },

    async touchPeople(ids) {
      if (ids.length === 0) return;
      await db.query("update public.decision_makers set last_seen_at = now() + interval '1 second' where id = any($1::uuid[])", [ids]);
    },

    async listChannels(buyerProfileId) {
      const { rows } = await db.query("select id, channel_type, value from public.contact_channels where buyer_profile_id = $1", [buyerProfileId]);
      return rows;
    },

    async insertChannels(rows) {
      for (const row of rows) {
        await db.query(
          `insert into public.contact_channels
             (organization_id, buyer_profile_id, market_source_id, decision_maker_id, channel_type, value, provenance,
              certainty, discovered_by, identity_match, email_kind, source_url, evidence_snippet, phone_e164, is_verified, is_public)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            row.organization_id,
            row.buyer_profile_id,
            row.market_source_id,
            row.decision_maker_id,
            row.channel_type,
            row.value,
            row.provenance,
            row.certainty,
            row.discovered_by,
            row.identity_match,
            row.email_kind ?? "unknown",
            row.source_url,
            row.evidence_snippet,
            row.phone_e164 ?? null,
            row.is_verified,
            row.is_public,
          ],
        );
      }
    },

    async touchChannels(ids) {
      if (ids.length === 0) return;
      await db.query("update public.contact_channels set last_seen_at = now() + interval '1 second' where id = any($1::uuid[])", [ids]);
    },

    async listRoutes(buyerProfileId) {
      const { rows } = await db.query("select id, route_kind, url, value from public.buyer_routes where buyer_profile_id = $1", [buyerProfileId]);
      return rows;
    },

    async insertRoutes(rows) {
      for (const row of rows) {
        await db.query(
          `insert into public.buyer_routes
             (organization_id, buyer_profile_id, market_source_id, route_kind, department, url, value, source_url, evidence_snippet, is_verified, discovered_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            row.organization_id,
            row.buyer_profile_id,
            row.market_source_id,
            row.route_kind,
            row.department,
            row.url,
            row.value,
            row.source_url,
            row.evidence_snippet,
            row.is_verified,
            row.discovered_by,
          ],
        );
      }
    },
  };
}

// ---------------------------------------------------------------------- chạy --

async function main() {
  // Gom module TypeScript bằng esbuild rồi import, giống các bộ test khác.
  await mkdir(workDir, { recursive: true });
  const entryPath = path.join(workDir, "entry.ts");
  const bundlePath = path.join(workDir, "bundle.mjs");
  await writeFile(
    entryPath,
    `import { buildBuyerWriteBatch, saveBuyerDiscovery, COMPANY_SITE_SOURCE_KEY } from "@/lib/connector/persist";
export const api = { buildBuyerWriteBatch, saveBuyerDiscovery, COMPANY_SITE_SOURCE_KEY };
`,
    "utf8",
  );
  const build = spawnSync(
    "npx",
    ["--no-install", "esbuild", entryPath, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundlePath}`, "--log-level=warning"],
    { cwd: root, encoding: "utf8" },
  );
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }
  const { api } = await import(pathToFileURL(bundlePath).href);

  // ------------------------------------------------------- 1. dựng dữ liệu --
  section("dựng dữ liệu ghi database");
  const orgId = "11111111-1111-1111-1111-111111111111";

  const noCountry = api.buildBuyerWriteBatch(sampleResult(), { organizationId: orgId, domain: "acme.example" });
  check("thiếu country → từ chối, kèm lý do đọc được", noCountry.ok === false && noCountry.reason.includes("country"), noCountry.reason);
  check("thiếu organization → từ chối", api.buildBuyerWriteBatch(sampleResult(), { organizationId: "", domain: "acme.example", country: "US" }).ok === false);
  const noDomain = api.buildBuyerWriteBatch(sampleResult({ domain: "" }), { organizationId: orgId, country: "US" });
  check("thiếu tên miền → từ chối", noDomain.ok === false && noDomain.reason.includes("tên miền"), noDomain.reason);

  const built = api.buildBuyerWriteBatch(sampleResult(), {
    organizationId: orgId,
    domain: "www.acme.example",
    companyName: "Acme Foods Inc.",
    country: "United States",
  });
  check("dựng được batch", built.ok === true, built.reason);
  const batch = built.batch;
  check("tên miền được chuẩn hoá (bỏ www, viết thường)", batch.buyerProfile.domain === "acme.example" && batch.buyerProfile.website === "https://acme.example");
  check("nguồn dữ liệu là website công ty", batch.marketSourceKey === api.COMPANY_SITE_SOURCE_KEY && batch.marketSourceKey === "company_website");
  check("kênh bộ phận giữ nhãn department", batch.channels.find((channel) => channel.value === "procurement@acme.example")?.identity_match === "department");
  check("kênh cạnh tên người trỏ đúng người trong batch", batch.channels.find((channel) => channel.value === "dana.whitfield@acme.example")?.personIndex === 0);
  check("không có trường nào mang tính khuyên bảo", !JSON.stringify(batch).match(/nên |gợi ý|khuyến nghị/i));

  // Kênh nhãn "person" nhưng không có người tương ứng: hạ về công ty chung.
  const orphanPerson = api.buildBuyerWriteBatch(
    sampleResult({ people: [], channels: [{ ...sampleResult().channels[1], personName: undefined }] }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check("nhãn person không có người thì hạ về company_general", orphanPerson.batch.channels[0].identity_match === "company_general", orphanPerson.batch.channels[0].identity_match);

  // Kênh thiếu bằng chứng hoặc thiếu nguồn: không ghi.
  const thinEvidence = api.buildBuyerWriteBatch(
    sampleResult({ channels: [{ ...sampleResult().channels[0], evidenceSnippet: "" }] }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check("kênh không có câu chữ bằng chứng → không ghi", thinEvidence.batch.channels.length === 0 && thinEvidence.batch.skipped.length === 1);
  const noSource = api.buildBuyerWriteBatch(
    sampleResult({ channels: [{ ...sampleResult().channels[0], sourceUrl: "" }] }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check("kênh không có trang nguồn → không ghi", noSource.batch.channels.length === 0 && noSource.batch.skipped[0].reason.includes("nguồn"));

  // Kênh suy luận theo pattern: tuyệt đối không ghi.
  const inferred = api.buildBuyerWriteBatch(
    sampleResult({ channels: [{ ...sampleResult().channels[0], value: "d.whitfield@acme.example", certainty: "inferred" }] }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check("kênh certainty=inferred → bỏ, ghi lý do", inferred.batch.channels.length === 0 && inferred.batch.skipped[0].reason.includes("pattern"));

  // Hồ sơ LinkedIn cá nhân: chặn lần hai ở tầng ghi.
  const profile = api.buildBuyerWriteBatch(
    sampleResult({
      channels: [
        {
          type: "linkedin",
          value: "linkedin.com/in/stacy-nygard-1517b2b",
          label: "Trang LinkedIn",
          identityMatch: "company_general",
          certainty: "confirmed",
          policy: "manual_contact_only",
          sourceUrl: "https://acme.example/procurement",
          evidenceSnippet: "Liên kết trên acme.example",
        },
      ],
    }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check("hồ sơ LinkedIn cá nhân không vào database", profile.batch.channels.length === 0 && profile.batch.skipped[0].reason.includes("cá nhân"));

  // Kênh trùng nhau ở hai trang: một dòng.
  const duplicate = api.buildBuyerWriteBatch(
    sampleResult({ channels: [sampleResult().channels[0], { ...sampleResult().channels[0], sourceUrl: "https://acme.example/contact" }] }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check("cùng một giá trị ở hai trang → một dòng", duplicate.batch.channels.length === 1);

  // Đường vào: chỉ từ trang đã đọc thật.
  const routeKinds = batch.routes.map((route) => route.route_kind);
  check("trang /procurement thành procurement_page", routeKinds.includes("procurement_page"));
  check("trang /become-a-supplier thành vendor_registration", routeKinds.includes("vendor_registration"));
  check("trang 404 không thành đường vào", batch.routes.every((route) => !route.url?.includes("/cart")));
  check("email bộ phận thành department_email", routeKinds.includes("department_email"));
  check("mỗi đường vào đều có nguồn", batch.routes.every((route) => route.source_url.startsWith("http")));

  // ------------------------------------------------- 2. ghi vào Postgres thật --
  section("ghi vào Postgres thật (PGlite, đủ 10 migration)");
  const { db, migrationCount } = await bootDatabase();
  check(`áp dụng đủ migration (${migrationCount})`, migrationCount === 10, String(migrationCount));

  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, 'owner@example.com', '{"full_name":"Owner One"}')`,
    ["aaaaaaaa-0000-0000-0000-000000000001"],
  );
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", ["aaaaaaaa-0000-0000-0000-000000000001"]);
  const realOrgId = (await db.query("select public.bootstrap_workspace('Acme Research') as id")).rows[0].id;

  const store = pgliteStore(db);
  const first = await api.saveBuyerDiscovery(store, { ...batch, organizationId: realOrgId });
  check("ghi lần đầu thành công", first.ok === true, first.ok ? "" : first.reason);
  check("không ghi contact_candidates", first.candidatesInserted === 0);

  const buyerRow = (await db.query("select id, display_name, country, domain, website from public.buyer_profiles where organization_id = $1", [realOrgId])).rows[0];
  check("buyer_profiles có dòng với tên miền làm khoá", buyerRow?.domain === "acme.example" && buyerRow?.country === "United States");
  const channelCount = (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [buyerRow.id])).rows[0].n;
  check("contact_channels có đủ 3 kênh", channelCount === 3, String(channelCount));
  check(
    "mọi kênh đều có source_url + câu chữ bằng chứng",
    (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1 and (source_url is null or btrim(coalesce(evidence_snippet, '')) = '')", [buyerRow.id])).rows[0].n === 0,
  );
  check(
    "mọi dòng đọc được trang nguồn qua cột bằng chứng (007)",
    (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1 and evidence_url is null", [buyerRow.id])).rows[0].n === 0,
  );
  check(
    "không kênh nào bị đánh dấu verified",
    (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1 and is_verified", [buyerRow.id])).rows[0].n === 0,
  );
  check("không kênh nào là is_guessed", (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1 and is_guessed", [buyerRow.id])).rows[0].n === 0);
  check("contact_candidates trống", (await db.query("select count(*)::int as n from public.contact_candidates")).rows[0].n === 0);
  check("kênh của người được nối vào decision_makers", (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1 and decision_maker_id is not null", [buyerRow.id])).rows[0].n === 1);
  check("người được ghi ở hạng b (có tên, một nguồn)", (await db.query("select grade from public.decision_makers where buyer_profile_id = $1", [buyerRow.id])).rows[0]?.grade === "b");
  const routeCount = (await db.query("select count(*)::int as n from public.buyer_routes where buyer_profile_id = $1", [buyerRow.id])).rows[0].n;
  check("buyer_routes có đường vào procurement + đăng ký nhà cung cấp + email bộ phận", routeCount === 3, String(routeCount));

  // Chính sách xuất: view quyết định, không phải UI.
  const policy = (
    await db.query("select channel_type, value, blocked_reason, exportable, outreach_eligible, requires_override from public.contact_export_policy where buyer_profile_id = $1 order by channel_type, value", [buyerRow.id])
  ).rows;
  const emailPolicy = policy.find((row) => row.value === "procurement@acme.example");
  check("email công bố chưa kiểm mailbox → xuất được nhưng chưa outreach", emailPolicy?.blocked_reason === "deliverability_unchecked" && emailPolicy.exportable === true && emailPolicy.outreach_eligible === false);
  const personPolicy = policy.find((row) => row.value === "dana.whitfield@acme.example");
  check("email của người cũng chưa được coi là outreach-ready", personPolicy?.outreach_eligible === false);
  const supplierRoute = (await db.query("select route_kind, url from public.buyer_routes where buyer_profile_id = $1 and route_kind = 'vendor_registration'", [buyerRow.id])).rows[0];
  check("đường đăng ký nhà cung cấp giữ đúng URL đã đọc", supplierRoute?.url === "https://acme.example/become-a-supplier");

  // Danh sách buyer: dòng vừa ghi phải đọc được qua view của UI.
  const summary = (await db.query("select display_name, country, reachable_channels, named_people, last_contact_seen_at from public.buyer_outreach_summary where buyer_profile_id = $1", [buyerRow.id])).rows[0];
  check("buyer_outreach_summary hiện công ty vừa ghi", summary?.reachable_channels === 3 && summary?.named_people === 1, JSON.stringify(summary));
  const contacts = (await db.query("select count(*)::int as n from public.outreach_ready_contacts where buyer_profile_id = $1", [buyerRow.id])).rows[0].n;
  check("outreach_ready_contacts liệt kê 3 dòng (CSV)", contacts === 3, String(contacts));
  const withSource = (await db.query("select count(*)::int as n from public.outreach_ready_contacts where buyer_profile_id = $1 and source_url is not null", [buyerRow.id])).rows[0].n;
  check("mọi dòng trong CSV đều có nguồn", withSource === 3);

  // Chạy lại: không nhân đôi.
  const second = await api.saveBuyerDiscovery(store, { ...batch, organizationId: realOrgId });
  check("chạy lần hai vẫn ok", second.ok === true);
  check("lần hai chỉ làm mới, không thêm kênh", second.channels.inserted === 0 && second.channels.refreshed === 3, JSON.stringify(second.channels));
  check("lần hai không thêm người", second.people.inserted === 0 && second.people.refreshed === 1);
  check("lần hai không thêm đường vào", second.routes.inserted === 0 && second.routes.refreshed === 3);
  check("tổng số kênh vẫn là 3", (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 3);
  check("last_seen_at được làm mới", (await db.query("select bool_and(last_seen_at > created_at) as ok from public.contact_channels where buyer_profile_id = $1", [buyerRow.id])).rows[0].ok === true);

  // Ranh giới tenant: người của workspace khác không thấy gì.
  await db.query(
    `insert into auth.users (id, email) values ($1, 'other@example.com')`,
    ["bbbbbbbb-0000-0000-0000-000000000002"],
  );
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", ["bbbbbbbb-0000-0000-0000-000000000002"]);
  await db.query("select public.bootstrap_workspace('Other Research')");
  await db.query("set role authenticated");
  check("workspace khác không thấy buyer này", (await db.query("select count(*)::int as n from public.buyer_outreach_summary where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 0);
  check("workspace khác không thấy kênh", (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 0);
  await db.query("reset role");

  // ------------------------------------- 2b. E.164 + WhatsApp (008) ----------
  section("E.164 và WhatsApp");
  const phoneRow = (
    await db.query("select value, phone_e164, has_whatsapp from public.contact_channels where buyer_profile_id = $1 and channel_type = 'phone'", [buyerRow.id])
  ).rows[0];
  check("số đã chuẩn hoá E.164 được lưu đúng", phoneRow?.phone_e164 === "+17074522800", JSON.stringify(phoneRow));
  check("giá trị hiển thị vẫn là số như đã công bố", phoneRow?.value === "707-452-2800", phoneRow?.value);
  check("chưa kiểm WhatsApp thì has_whatsapp là NULL, không phải false", phoneRow?.has_whatsapp === null);
  check("xác nhận trong batch có đếm số điện thoại đã chuẩn hoá", typeof second.channels.phonesNormalized === "number" && second.channels.phonesNormalized === 1, JSON.stringify(second.channels));

  check("view WhatsApp trống khi chưa ai kiểm", (await db.query("select count(*)::int as n from public.contact_whatsapp_links where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 0);

  // Mô phỏng kết quả của dịch vụ kiểm WhatsApp (việc sẽ cắm ở phase sau).
  const whatsappChecked = await db.query(
    "update public.contact_channels set has_whatsapp = true, whatsapp_checked_at = now(), whatsapp_checked_by = 'whatsapp-check-api' where buyer_profile_id = $1 and channel_type = 'phone' returning id",
    [buyerRow.id],
  );
  const link = (
    await db.query("select phone_e164, whatsapp_url, whatsapp_checked_by from public.contact_whatsapp_links where channel_id = $1", [whatsappChecked.rows[0].id])
  ).rows[0];
  check("kiểm xong thì view trả link wa.me dựng từ E.164", link?.whatsapp_url === "https://wa.me/17074522800", JSON.stringify(link));
  check("view ghi rõ dịch vụ nào đã kiểm", link?.whatsapp_checked_by === "whatsapp-check-api");

  let whatsappNoProvider = "";
  try {
    await db.query(
      "update public.contact_channels set has_whatsapp = true, whatsapp_checked_by = null where buyer_profile_id = $1 and channel_type = 'phone'",
      [buyerRow.id],
    );
  } catch (error) {
    whatsappNoProvider = error.message;
  }
  check("không thể nói 'có WhatsApp' mà không nêu dịch vụ kiểm", whatsappNoProvider.includes("contact_channels_whatsapp_needs_provider"), whatsappNoProvider);

  let e164OnEmail = "";
  try {
    await db.query(
      "update public.contact_channels set phone_e164 = '+84912345678' where buyer_profile_id = $1 and channel_type = 'email'",
      [buyerRow.id],
    );
  } catch (error) {
    e164OnEmail = error.message;
  }
  check("cột E.164 chỉ dành cho số điện thoại", e164OnEmail.includes("contact_channels_e164_is_phone"), e164OnEmail);

  // Trả lại trạng thái "chưa kiểm" để các phép đếm phía sau đo đúng.
  await db.query("update public.contact_channels set has_whatsapp = null, whatsapp_checked_at = null, whatsapp_checked_by = null where buyer_profile_id = $1", [buyerRow.id]);

  // ------------------------------------------- 3. lần kiểm tra thứ hai (007) --
  section("xác minh kênh (007)");
  const quotedChannelId = (
    await db.query("select id from public.contact_channels where buyer_profile_id = $1 and value = 'procurement@acme.example'", [buyerRow.id])
  ).rows[0].id;

  const beforeVerify = (
    await db.query("select blocked_reason, outreach_eligible from public.contact_export_policy where id = $1", [quotedChannelId])
  ).rows[0];
  check("trước khi kiểm: chưa dùng để gửi tự động", beforeVerify.outreach_eligible === false && beforeVerify.blocked_reason === "deliverability_unchecked", JSON.stringify(beforeVerify));

  const verifyOk = (await db.query("select public.verify_contact_channel($1) as ok", [quotedChannelId])).rows[0].ok;
  const afterVerify = (
    await db.query("select is_verified, verified_at, exportable, blocked_reason, outreach_eligible from public.contact_export_policy where id = $1", [quotedChannelId])
  ).rows[0];
  check("kiểm tra thứ hai bật is_verified và ghi lại thời điểm", verifyOk === true && afterVerify.is_verified === true && Boolean(afterVerify.verified_at), JSON.stringify(afterVerify));
  // Chủ sở hữu đã rõ vẫn chưa đủ để gửi tự động: hộp thư chưa được kiểm thì vẫn
  // có thể trả về bounce. Hai câu hỏi khác nhau, và policy tách đúng hai câu.
  check(
    "xác minh chủ sở hữu xong vẫn chưa outreach-ready khi hộp thư chưa kiểm",
    afterVerify.exportable === true && afterVerify.outreach_eligible === false && afterVerify.blocked_reason === "deliverability_unchecked",
    JSON.stringify(afterVerify),
  );

  // Bước kiểm mailbox là bước riêng, có nhà cung cấp riêng — mô phỏng kết quả.
  await db.query("update public.contact_channels set deliverability = 'valid', deliverability_checked_at = now() where id = $1", [quotedChannelId]);
  const afterMailbox = (
    await db.query("select blocked_reason, outreach_eligible from public.contact_export_policy where id = $1", [quotedChannelId])
  ).rows[0];
  check("kiểm mailbox xong thì hết lý do chặn và được phép dùng", afterMailbox.blocked_reason === null && afterMailbox.outreach_eligible === true, JSON.stringify(afterMailbox));

  // Database từ chối thẳng một dòng confirmed mà không có câu trích dẫn (007).
  const websiteSourceId = (await db.query("select id from public.market_sources where key = 'company_website'")).rows[0].id;
  let quoteRefused = "";
  try {
    await db.query(
      `insert into public.contact_channels
         (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, discovered_by, source_url)
       values ($1, $2, $3, 'email', 'unquoted@acme.example', 'company_site', 'manual', 'https://acme.example/contact')`,
      [realOrgId, buyerRow.id, websiteSourceId],
    );
  } catch (error) {
    quoteRefused = error.message;
  }
  check("database từ chối dòng confirmed thiếu câu trích dẫn", quoteRefused.includes("contact_channels_confirmed_needs_quote"), quoteRefused);

  // Hồ sơ LinkedIn cá nhân cũng bị database chặn, không chỉ code.
  let profileRefused = "";
  try {
    await db.query(
      `insert into public.contact_channels
         (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, discovered_by, source_url, evidence_snippet)
       values ($1, $2, $3, 'linkedin_url', 'linkedin.com/in/someone-else', 'company_site', 'manual', 'https://acme.example/team', 'Liên kết trên acme.example')`,
      [realOrgId, buyerRow.id, websiteSourceId],
    );
  } catch (error) {
    profileRefused = error.message;
  }
  check("database từ chối hồ sơ cá nhân đứng một mình", profileRefused.includes("contact_channels_personal_profile_needs_person"), profileRefused);

  // ------------------------------------------- 4. cổng Role + Email (009) ----
  section("cổng Role và cổng Email");
  const roleRow = (
    await db.query("select role_kind, job_title from public.decision_makers where buyer_profile_id = $1", [buyerRow.id])
  ).rows[0];
  check("chức danh được phân loại lúc ghi", roleRow?.role_kind === "procurement", JSON.stringify(roleRow));

  const emailKinds = (
    await db.query("select value, email_kind, identity_match from public.contact_channels where buyer_profile_id = $1 and channel_type = 'email' order by value", [buyerRow.id])
  ).rows;
  check(
    "email cạnh tên người → published_named; email bộ phận → published_role_mailbox",
    emailKinds.find((row) => row.value === "dana.whitfield@acme.example")?.email_kind === "published_named" &&
      emailKinds.find((row) => row.value === "procurement@acme.example")?.email_kind === "published_role_mailbox",
    JSON.stringify(emailKinds),
  );
  check("kênh không phải email thì email_kind là unknown", (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1 and channel_type <> 'email' and email_kind <> 'unknown'", [buyerRow.id])).rows[0].n === 0);

  const roleGate = (
    await db.query("select passes_role_gate from public.contact_role_gate where channel_id = $1", [quotedChannelId])
  ).rows[0];
  check("email bộ phận qua cổng Role (đường bộ phận, không cần tên người)", roleGate?.passes_role_gate === true, JSON.stringify(roleGate));

  const emailGateRows = (
    await db.query("select value, passes_email_gate, blocked_reason from public.contact_email_gate where buyer_profile_id = $1 order by value", [buyerRow.id])
  ).rows;
  check(
    "mọi email công bố đều qua cổng Email",
    emailGateRows.filter((row) => row.value.includes("@")).every((row) => row.passes_email_gate === true),
    JSON.stringify(emailGateRows),
  );
  check("không có email nào bị loại vì inferred_unverified", emailGateRows.every((row) => row.blocked_reason !== "inferred_unverified"));

  // Một email tự đoán: cổng Email phải chặn, và cột email_kind phải khớp identity.
  const guessedChannelId = (
    await db.query(
      `insert into public.contact_channels
         (organization_id, buyer_profile_id, market_source_id, channel_type, value, provenance, certainty, discovered_by,
          inference_basis, identity_match, email_kind, expires_at)
       values ($1, $2, $3, 'email', 'guessed@acme.example', 'company_site', 'inferred', 'inferred_pattern',
               'first.last@domain', 'unknown', 'inferred_unverified', now() + interval '20 days')
       returning id`,
      [realOrgId, buyerRow.id, websiteSourceId],
    )
  ).rows[0].id;
  const guessedGate = (
    await db.query("select passes_email_gate, blocked_reason from public.contact_email_gate where channel_id = $1", [guessedChannelId])
  ).rows[0];
  check("email tự đoán bị cổng Email chặn", guessedGate?.passes_email_gate === false && guessedGate?.blocked_reason === "inferred_unverified", JSON.stringify(guessedGate));

  let inconsistentKind = "";
  try {
    await db.query("update public.contact_channels set email_kind = 'published_named' where id = $1", [guessedChannelId]);
  } catch (error) {
    inconsistentKind = error.message;
  }
  check("không thể gán nhãn sai cho một email đã đoán", inconsistentKind.includes("contact_channels_email_kind_consistent"), inconsistentKind);
  await db.query("delete from public.contact_channels where id = $1", [guessedChannelId]);

  check(
    "xác minh và kiểm mailbox không tạo thêm dòng nào",
    (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 3,
  );

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
