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
 *  2. Ghi thật vào Postgres trong tiến trình (PGlite) với đủ 12 migration,
 *     rồi đọc lại qua chính các view mà ứng dụng dùng
 *     (`contact_export_policy`, `buyer_outreach_summary`, `outreach_ready_contacts`).
 *
 * Phần 2 là chỗ trả lời câu hỏi "ghi xong thì người dùng thấy gì": mỗi dòng
 * phải có nguồn, `is_verified` phải là false, `contact_candidates` phải trống,
 * và chạy lại lần hai không được nhân đôi dữ liệu.
 */

import { readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleTs } from "./lib/ts-module.mjs";
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
    registry: {
      registry: "companies_house",
      registryLabel: "UK Companies House",
      sourceUrl: "https://find-and-update.company-information.service.gov.uk/company/99999999/officers",
      registeredName: "ACME FOODS LTD",
      companyNumber: "99999999",
      status: "active",
      incorporatedOn: "2011-05-04",
      industry: "SIC 46370",
      formerNames: ["ACME TRADING LIMITED"],
      officers: [
        { name: "SMITH, Jane", role: "director", appointedOn: "2011-05-04" },
        { name: "OSEI, Raymond", role: "director", appointedOn: "2019-07-02" },
      ],
    },
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
 * `CustomsStore` chạy thẳng SQL trên PGlite. Trong production là bốn hàm RPC
 * của 012 qua service role; ở đây gọi đúng bốn hàm đó — nên luật nằm trong DB
 * (bên gửi hàng không thành khách hàng, thiếu nguồn thì không ghi) được kiểm
 * thật chứ không chỉ được mô tả lại bằng JavaScript.
 */
function pgliteCustomsStore(db) {
  return {
    async recordRecord(input) {
      const parties = input.parties.map((party) => ({
        role: party.role,
        name: party.name,
        name_normalized: party.nameNormalized,
        country: party.country ?? null,
        country_iso: party.countryIso2 ?? null,
        address: party.address ?? null,
        website: party.website ?? null,
        column: party.column ?? null,
      }));
      const { rows } = await db.query(
        `select * from public.record_customs_record($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
        [
          input.organizationId,
          input.sourceKey,
          input.recordReference,
          input.shipmentDate ?? null,
          input.hsCode ?? null,
          input.productDescription ?? null,
          input.quantity ?? null,
          input.quantityUnit ?? null,
          input.weightKg ?? null,
          input.containers ?? null,
          input.valueUsd ?? null,
          input.originCountry ?? null,
          input.destinationPort ?? null,
          JSON.stringify(parties),
        ],
      );
      return rows[0];
    },

    async link(input) {
      const { rows } = await db.query(
        `select * from public.link_customs_party($1, $2, $3::public.customs_match_method, $4, $5::text[], $6)`,
        [input.partyId, input.buyerProfileId, input.method, input.confidence, input.reasons ?? [], input.decidedBy ?? "resolver"],
      );
      return rows[0];
    },

    async mark(input) {
      const { rows } = await db.query(
        `select * from public.mark_customs_party($1, $2::public.customs_match_status, $3::public.customs_match_method, $4, $5::text[], $6)`,
        [input.partyId, input.status, input.method ?? null, input.confidence ?? null, input.reasons ?? [], input.decidedBy ?? "resolver"],
      );
      return rows[0];
    },

    async createBuyer(input) {
      const { rows } = await db.query(`select * from public.create_buyer_from_customs_party($1, $2)`, [input.partyId, input.decidedBy ?? "resolver"]);
      return rows[0];
    },
  };
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

    async recordRegistryMatch(row) {
      // Gọi đúng hàm của migration 011 — chống trùng và kiểm dữ liệu nằm ở đó.
      const { rows } = await db.query(
        `select public.record_registry_match($1, $2::public.registry_source, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12::jsonb) as id`,
        [
          row.buyerProfileId,
          row.registry,
          row.registry_label,
          row.source_url,
          row.queried_name,
          row.registered_name,
          row.company_number,
          row.status,
          row.incorporated_on,
          row.industry,
          row.former_names,
          JSON.stringify(row.officers),
        ],
      );
      return { id: rows[0].id.id ?? rows[0].id };
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
import { importCustomsCsv } from "@/lib/customs/import";
import { toBuyerCustomsByBuyer, toCustomsQueueItem } from "@/lib/customs/view";
export const api = { buildBuyerWriteBatch, saveBuyerDiscovery, COMPANY_SITE_SOURCE_KEY, importCustomsCsv, toBuyerCustomsByBuyer, toCustomsQueueItem };
`,
    "utf8",
  );
  await bundleTs(entryPath, bundlePath, { alias: false });
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

  // ------------------------------------------------------ đối chiếu pháp nhân --
  section("đối chiếu pháp nhân (batch)");
  check(
    "batch mang theo kết quả sổ đăng ký",
    batch.registry?.registry === "companies_house" && batch.registry?.company_number === "99999999",
    JSON.stringify(batch.registry),
  );
  check("tên đã dùng để tra được ghi lại", batch.registry?.queried_name === "Acme Foods Inc.", batch.registry?.queried_name);
  check("chỉ người còn đương nhiệm vào batch", batch.registry?.officers.length === 2);
  check("sổ đăng ký KHÔNG sinh ra kênh liên hệ nào", !JSON.stringify(batch.registry).includes("@"));
  check("nguồn của sổ ghi kèm nhãn cơ quan", batch.registry?.registry_label === "UK Companies House" && batch.registry.source_url.startsWith("https://"));
  const noRegistry = api.buildBuyerWriteBatch(sampleResult({ registry: undefined }), { organizationId: orgId, domain: "acme.example", country: "US" });
  check("không tra được sổ thì batch không có phần đó, không lỗi", noRegistry.ok === true && noRegistry.batch.registry === null);
  const registryNoSource = api.buildBuyerWriteBatch(
    sampleResult({ registry: { ...sampleResult().registry, sourceUrl: "" } }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check("đối chiếu thiếu trang nguồn → bỏ, ghi lý do", registryNoSource.batch.registry === null && registryNoSource.batch.skipped.some((item) => item.reason.includes("trang nguồn")));
  const registryNoIdentity = api.buildBuyerWriteBatch(
    sampleResult({ registry: { ...sampleResult().registry, registeredName: null, companyNumber: null } }),
    { organizationId: orgId, domain: "acme.example", country: "US" },
  );
  check(
    "đối chiếu không nêu được tên pháp nhân lẫn số đăng ký → bỏ",
    registryNoIdentity.batch.registry === null && registryNoIdentity.batch.skipped.some((item) => item.reason.includes("tên pháp nhân")),
  );

  // ------------------------------------------------- 2. ghi vào Postgres thật --
  section("ghi vào Postgres thật (PGlite, đủ 12 migration)");
  const { db, migrationCount } = await bootDatabase();
  check(`áp dụng đủ migration (${migrationCount})`, migrationCount === 12, String(migrationCount));

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

  // ------------------------------------- 2a. đối chiếu pháp nhân (011) --------
  section("đối chiếu pháp nhân ghi vào database (011)");
  const matchRows = (await db.query("select id, organization_id, buyer_profile_id, registry, registry_label, registered_name, company_number, status, incorporated_on, industry, former_names, checked_at from public.buyer_registry_matches where buyer_profile_id = $1", [buyerRow.id])).rows;
  check("ghi đúng một lần đối chiếu", matchRows.length === 1, String(matchRows.length));
  const match = matchRows[0];
  const firstCheckedAt = match.checked_at;
  check("sổ được ghi kèm nhãn cơ quan", match?.registry === "companies_house" && match?.registry_label === "UK Companies House");
  check("pháp nhân giữ nguyên như sổ công bố", match?.registered_name === "ACME FOODS LTD" && match?.company_number === "99999999");
  check("tình trạng, ngày thành lập, ngành được ghi", match?.status === "active" && match?.incorporated_on === "2011-05-04" && match?.industry === "SIC 46370");
  check("tên cũ được ghi", JSON.stringify(match?.former_names) === JSON.stringify(["ACME TRADING LIMITED"]));
  check("organization_id suy từ buyer_profiles, không nhận từ tham số", match?.organization_id === realOrgId);
  const officerRows = (await db.query("select full_name, role_title, appointed_on from public.buyer_registry_officers where registry_match_id = $1 order by full_name", [match.id])).rows;
  check("hai người đương nhiệm được ghi", officerRows.length === 2, JSON.stringify(officerRows));
  check("chức danh giữ nguyên như sổ ghi", officerRows.some((row) => row.full_name === "SMITH, Jane" && row.role_title === "director"));
  check(
    "bảng người đương nhiệm không có cột email/điện thoại",
    (await db.query("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'buyer_registry_officers' and column_name in ('email', 'phone', 'value')")).rows[0].n === 0,
  );
  check("nguồn dữ liệu là dòng market_sources của sổ", (await db.query("select count(*)::int as n from public.market_sources where key = 'companies_house'")).rows[0].n === 1);
  check(
    "view buyer_registry_latest đọc ra đúng dòng mới nhất",
    (await db.query("select registered_name, officer_count from public.buyer_registry_latest where buyer_profile_id = $1", [buyerRow.id])).rows[0]?.officer_count === 2,
  );
  check(
    "đối chiếu pháp nhân không thêm kênh liên hệ nào",
    (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 3,
  );

  // Chạy lại cùng kết quả: không thêm dòng, chỉ làm mới ngày.
  const replay = await api.saveBuyerDiscovery(store, { ...batch, organizationId: realOrgId });
  check("lần hai không thêm lần đối chiếu", replay.registryRecorded === 1 && (await db.query("select count(*)::int as n from public.buyer_registry_matches where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 1);
  check(
    "lần hai làm mới checked_at, không thêm dòng",
    new Date((await db.query("select checked_at from public.buyer_registry_matches where id = $1", [match.id])).rows[0].checked_at).getTime() >= new Date(firstCheckedAt).getTime(),
  );
  check("và không nhân đôi người đương nhiệm", (await db.query("select count(*)::int as n from public.buyer_registry_officers where registry_match_id = $1", [match.id])).rows[0].n === 2);

  // Sổ trả về kết quả khác (đổi tình trạng, thêm người): dòng mới, giữ lịch sử.
  const changed = await api.saveBuyerDiscovery(store, {
    ...batch,
    organizationId: realOrgId,
    registry: {
      ...batch.registry,
      status: "liquidation",
      officers: [...batch.registry.officers, { name: "LINQVIST, Mia", role: "company secretary", appointedOn: "2021-01-15" }],
    },
  });
  check("kết quả khác → thêm dòng mới", changed.ok === true && (await db.query("select count(*)::int as n from public.buyer_registry_matches where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 2);
  check(
    "view latest trỏ về lần đối chiếu mới nhất",
    (await db.query("select status, officer_count from public.buyer_registry_latest where buyer_profile_id = $1", [buyerRow.id])).rows[0]?.status === "liquidation",
  );
  check("lịch sử vẫn đọc được", (await db.query("select count(*)::int as n from public.buyer_registry_matches where buyer_profile_id = $1 and status = 'active'", [buyerRow.id])).rows[0].n === 1);

  // Hàm từ chối dữ liệu không phải một lần đối chiếu.
  const rejects = async (sql, params) => db.query(sql, params).then(() => false).catch((error) => error.message);
  const noSourceMessage = await rejects(
    "select public.record_registry_match($1, 'companies_house', 'UK Companies House', '  ', 'Acme', 'ACME FOODS LTD', null)",
    [buyerRow.id],
  );
  check("hàm từ chối đối chiếu thiếu trang nguồn", /trang nguồn/.test(noSourceMessage), noSourceMessage);
  const noIdentityMessage = await rejects(
    "select public.record_registry_match($1, 'companies_house', 'UK Companies House', 'https://example.test/x', 'Acme', null, null)",
    [buyerRow.id],
  );
  check("hàm từ chối đối chiếu không có tên pháp nhân lẫn số đăng ký", /tên pháp nhân/.test(noIdentityMessage), noIdentityMessage);
  const noLabelMessage = await rejects(
    "select public.record_registry_match($1, 'companies_house', '   ', 'https://example.test/x', 'Acme', 'ACME FOODS LTD', null)",
    [buyerRow.id],
  );
  check("hàm từ chối đối chiếu thiếu nhãn sổ", /nhãn sổ/.test(noLabelMessage), noLabelMessage);
  const unknownBuyerMessage = await rejects(
    "select public.record_registry_match('33333333-3333-3333-3333-333333333333', 'companies_house', 'UK Companies House', 'https://example.test/x', 'Acme', 'ACME FOODS LTD', null)",
    [],
  );
  check("hàm từ chối buyer không tồn tại", /buyer_profile/.test(unknownBuyerMessage), unknownBuyerMessage);
  const secMessage = await rejects(
    "select public.record_registry_match($1, 'sec_edgar', 'US SEC EDGAR', 'https://www.sec.gov/x', 'Acme', 'ACME FOODS INC', null)",
    [buyerRow.id],
  );
  check("sổ đã có trong market_sources thì ghi được", !/market_sources/.test(secMessage), secMessage);

  // Người thiếu tên bị bỏ qua, phần còn lại vẫn ghi.
  const partial = await api.saveBuyerDiscovery(store, {
    ...batch,
    organizationId: realOrgId,
    registry: {
      ...batch.registry,
      status: "changed-status-again",
      officers: [
        { name: "  ", role: "director", appointedOn: null },
        { name: "OSEI, Raymond", role: "director", appointedOn: "2019-07-02" },
      ],
    },
  });
  const partialMatch = (await db.query("select id from public.buyer_registry_matches where buyer_profile_id = $1 order by checked_at desc limit 1", [buyerRow.id])).rows[0];
  check("người thiếu tên bị bỏ, không làm hỏng lần ghi", partial.ok === true && (await db.query("select count(*)::int as n from public.buyer_registry_officers where registry_match_id = $1", [partialMatch.id])).rows[0].n === 1);
  check("và tên rỗng không vào database", (await db.query("select count(*)::int as n from public.buyer_registry_officers where btrim(full_name) = ''")).rows[0].n === 0);

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
  check("workspace khác không thấy đối chiếu pháp nhân", (await db.query("select count(*)::int as n from public.buyer_registry_matches where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 0);
  check("workspace khác không thấy người đương nhiệm", (await db.query("select count(*)::int as n from public.buyer_registry_officers")).rows[0].n === 0);
  check("workspace khác không thấy view đối chiếu", (await db.query("select count(*)::int as n from public.buyer_registry_latest where buyer_profile_id = $1", [buyerRow.id])).rows[0].n === 0);
  let registryWriteDenied = false;
  try {
    await db.query("insert into public.buyer_registry_matches (organization_id, buyer_profile_id, market_source_id, registry, registry_label, source_url, queried_name, registered_name) values ($1, $2, (select id from public.market_sources where key = 'companies_house'), 'companies_house', 'UK Companies House', 'https://example.test/x', 'Acme', 'ACME FOODS LTD')", [realOrgId, buyerRow.id]);
  } catch (error) {
    registryWriteDenied = /permission denied/i.test(error.message);
  }
  check("người dùng thường không ghi thẳng được bảng đối chiếu", registryWriteDenied);
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

  // ------------------------------------------- 2c. dữ liệu hải quan (012) ------
  section("tờ khai hải quan ghi vào database (012)");

  // Nguồn phải có dòng trong `market_sources` trước (luật của 005 do 012 giữ).
  await db.query(
    `insert into public.market_sources (key, display_name, kind, licence_type, notes)
     values ('customs_bol_test', 'Hải quan — vận đơn công bố (test)', 'trade_data', 'public_record', 'nguồn cho bộ test')
     on conflict (key) do nothing`,
  );

  const customsStore = pgliteCustomsStore(db);
  const CUSTOMS_CSV = [
    "Bill of Lading Number,Shipment Date,Shipper Name,Shipper Country,Consignee Name,Consignee Country,Consignee Address,HS Code,Product Description,Quantity,Quantity Unit,Weight (kg),Value USD,Port of Discharge",
    'BL-77001,2026-03-04,"AGRICARE JSC, LTD.",Viet Nam,"ACME FOODS INC.","United States",,0801.32.00,"Cashew nuts, shelled",1200,CARTONS,18240.5,54000,Oakland',
    'BL-77002,2026-06-18,MEKONG FOODSTUFFS CO LTD,Viet Nam,NORTHWIND IMPORTS LTD,United Kingdom,,2106.90.99,"Food preparations nes",640,CARTONS,9100,22800,Felixstowe',
  ].join("\n");

  const customsReport = await api.importCustomsCsv(customsStore, {
    organizationId: realOrgId,
    sourceKey: "customs_bol_test",
    text: CUSTOMS_CSV,
  });
  check("nhập được hai tờ khai qua tầng ghi thật", customsReport.imported === 2 && customsReport.failures.length === 0, JSON.stringify(customsReport.failures));

  const recordRows = (await db.query("select id, record_reference, shipment_date, hs_code, containers from public.customs_records order by record_reference")).rows;
  check("tờ khai nằm trong bảng với khoá riêng", recordRows.length === 2 && recordRows[0].record_reference === "BL-77001");
  check("mã HS giữ nguyên bản in (không tự chuẩn hoá trong bảng)", recordRows[0].hs_code === "0801.32.00");

  const partyRows = (
    await db.query("select id, role, side, name_as_printed, name_normalized, country_as_printed from public.customs_record_parties order by name_as_printed, role")
  ).rows;
  check("bốn bên được ghi cho hai tờ khai", partyRows.length === 4, String(partyRows.length));
  check(
    "bên được suy sang bên giao dịch ngay trong DB",
    partyRows.find((row) => row.name_as_printed === "AGRICARE JSC, LTD.")?.side === "exporter_side" &&
      partyRows.find((row) => row.name_as_printed === "ACME FOODS INC.")?.side === "importer_side",
  );
  check("tên chuẩn hoá được ghi kèm bản in", partyRows.find((row) => row.name_as_printed === "ACME FOODS INC.")?.name_normalized === "acme foods");
  check(
    "vận đơn không mang theo kênh liên hệ nào",
    (await db.query("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name in ('customs_records','customs_record_parties','customs_entity_matches') and column_name in ('email','phone','phone_e164','value','contact')")).rows[0].n === 0,
  );

  const acmePartyId = partyRows.find((row) => row.name_as_printed === "ACME FOODS INC.")?.id;
  const shipperPartyId = partyRows.find((row) => row.name_as_printed === "AGRICARE JSC, LTD.")?.id;

  check("bên gửi hàng không được nối thành khách hàng", await (async () => {
    try {
      await customsStore.link({ partyId: shipperPartyId, buyerProfileId: buyerRow.id, method: "manual", confidence: 50 });
      return false;
    } catch (error) {
      return error.message.includes("chỉ bên nhận hàng");
    }
  })());

  const linked = await customsStore.link({
    partyId: acmePartyId,
    buyerProfileId: buyerRow.id,
    method: "exact_name",
    confidence: 80,
    reasons: ["tên trên tờ khai khớp hồ sơ Acme Foods"],
  });
  check("nối được bên nhận hàng với hồ sơ khách hàng", linked.status === "linked" && linked.buyer_profile_id === buyerRow.id, JSON.stringify(linked));

  const signalRows = (await db.query("select supplier_name, supplier_country, shipment_date, hs_code, record_reference from public.trade_signals where buyer_profile_id = $1 and record_reference = 'BL-77001'", [buyerRow.id])).rows;
  check("nối xong thì lô hàng tự vào trade_signals", signalRows.length === 1, String(signalRows.length));
  check("nhà cung cấp của lô hàng là bên gửi hàng", signalRows[0]?.supplier_name === "AGRICARE JSC, LTD." && signalRows[0]?.supplier_country === "Viet Nam", JSON.stringify(signalRows[0]));
  const partyCountry = (await db.query("select country_as_printed, country_iso2 from public.customs_record_parties where id = $1", [shipperPartyId])).rows[0];
  check("quốc gia giữ bản in, mã ISO nằm ở cột riêng", partyCountry?.country_as_printed === "Viet Nam" && partyCountry?.country_iso2 === "VN", JSON.stringify(partyCountry));

  const buyerAfter = (await db.query("select first_signal_at, last_signal_at from public.buyer_profiles where id = $1", [buyerRow.id])).rows[0];
  check(
    "ngày tín hiệu của khách hàng được cập nhật theo tờ khai",
    new Date(buyerAfter?.first_signal_at).toISOString().startsWith("2026-03-04"),
    JSON.stringify(buyerAfter),
  );

  // Đọc lại qua đúng hai view mà giao diện dùng.
  const customsSummary = (await db.query("select * from public.buyer_customs_summary where buyer_profile_id = $1", [buyerRow.id])).rows[0];
  const customsRoles = (await db.query("select buyer_profile_id, role, side, records_count from public.buyer_customs_roles where buyer_profile_id = $1", [buyerRow.id])).rows;
  const displayRow = api.toBuyerCustomsByBuyer([customsSummary], customsRoles).get(buyerRow.id);
  check(
    "view tóm tắt trả về đúng số lô và khoảng thời gian",
    displayRow?.recordsCount === 1 && new Date(displayRow.firstShipment).toISOString().startsWith("2026-03-04"),
    JSON.stringify({ count: displayRow?.recordsCount, first: displayRow?.firstShipment }),
  );
  check("mã HS trong tóm tắt gom về 6 chữ số của bảng mã quốc tế", JSON.stringify(displayRow?.hsCodes) === JSON.stringify(["080132"]), JSON.stringify(displayRow?.hsCodes));
  check("khối hiển thị có vai nhập khẩu kèm số lô", displayRow?.roles.some((role) => role.side === "importer_side" && role.records_count === 1));
  check("khách hàng chưa nối tờ khai nào không có khối hải quan", api.toBuyerCustomsByBuyer([customsSummary], []).get("khong-co") === undefined);

  const queueRows = (await db.query("select * from public.customs_resolution_queue order by record_reference")).rows;
  check("hàng đợi chỉ còn bên nhận hàng chưa nối", queueRows.length === 1 && queueRows[0].name_as_printed === "NORTHWIND IMPORTS LTD", JSON.stringify(queueRows.map((row) => row.name_as_printed)));
  check("hàng đợi kèm bên đối tác để có bối cảnh", queueRows[0]?.counterparty_name === "MEKONG FOODSTUFFS CO LTD");
  const queueItem = api.toCustomsQueueItem(queueRows[0]);
  check("dòng hàng đợi giữ tên cột nguồn", queueItem.sourceColumn === "Consignee Name", String(queueItem.sourceColumn));

  // Tạo hồ sơ khách hàng từ tờ khai: chỉ khi có quốc gia, và không tạo hai lần.
  const created = await customsStore.createBuyer({ partyId: queueRows[0].customs_party_id });
  check("tạo được hồ sơ khách hàng từ tờ khai có quốc gia", created.status === "created" && created.method === "created_from_customs", JSON.stringify(created));
  const createdBuyer = (await db.query("select legal_name, country, organization_id from public.buyer_profiles where id = $1", [created.buyer_profile_id])).rows[0];
  check("hồ sơ mới giữ đúng tên và quốc gia trên tờ khai", createdBuyer?.legal_name === "NORTHWIND IMPORTS LTD" && createdBuyer?.country === "United Kingdom", JSON.stringify(createdBuyer));
  check("hồ sơ mới thuộc workspace đang nhập", createdBuyer?.organization_id === realOrgId);
  check("tạo hồ sơ không tự sinh kênh liên hệ nào", (await db.query("select count(*)::int as n from public.contact_channels where buyer_profile_id = $1", [created.buyer_profile_id])).rows[0].n === 0);
  check("hàng đợi rỗng sau khi đã quyết cả hai bên", (await db.query("select count(*)::int as n from public.customs_resolution_queue")).rows[0].n === 0);

  // Nhập lại đúng file cũ: không thêm tờ khai, không nhân đôi lô hàng.
  const replayCustoms = await api.importCustomsCsv(customsStore, { organizationId: realOrgId, sourceKey: "customs_bol_test", text: CUSTOMS_CSV });
  check("nhập lại file cũ: hai tờ khai đều là nhập lại", replayCustoms.replayed === 2 && replayCustoms.imported === 0, JSON.stringify({ replayed: replayCustoms.replayed }));
  check("nhập lại không nhân đôi tờ khai", (await db.query("select count(*)::int as n from public.customs_records")).rows[0].n === 2);
  check("nhập lại không nhân đôi bên", (await db.query("select count(*)::int as n from public.customs_record_parties")).rows[0].n === 4);
  check("nhập lại không nhân đôi lô hàng trong trade_signals", (await db.query("select count(*)::int as n from public.trade_signals where record_reference = 'BL-77001'")).rows[0].n === 1);
  check(
    "bên đã nối vẫn giữ nguyên quyết định sau khi nhập lại",
    (await db.query("select status, method from public.customs_entity_matches where customs_party_id = $1", [acmePartyId])).rows[0]?.status === "linked",
  );
  check("nhập lại vẫn giữ mã ISO đã suy ra", (await db.query("select country_iso2 from public.customs_record_parties where id = $1", [shipperPartyId])).rows[0]?.country_iso2 === "VN");

  // Nguồn chưa có trong market_sources: không ghi được, và nói rõ vì sao.
  const unregistered = await api.importCustomsCsv(customsStore, { organizationId: realOrgId, sourceKey: "customs_nguon_la", text: CUSTOMS_CSV });
  check("nguồn chưa đăng ký thì bị từ chối kèm lý do đọc được", unregistered.failures.length === 2 && unregistered.failures[0].message.includes("market_sources"), unregistered.failures[0]?.message);
  check("bị từ chối thì không có tờ khai nào được ghi thêm", (await db.query("select count(*)::int as n from public.customs_records")).rows[0].n === 2);

  // Ghi chú "chờ xem"/"chưa có ứng viên" — hai trạng thái khác nhau.
  await db.query(
    `insert into public.market_sources (key, display_name, kind) values ('customs_bol_test_2', 'Hải quan — bộ kiểm thứ hai', 'trade_data') on conflict (key) do nothing`,
  );
  await api.importCustomsCsv(customsStore, {
    organizationId: realOrgId,
    sourceKey: "customs_bol_test_2",
    text: [
      "BOL,Consignee Name,Consignee Country,Shipper Name,Shipper Country",
      "BL-88001,AMBER TRADING CO LTD,Canada,VIET LONG EXPORT JSC,Viet Nam",
    ].join("\n"),
  });
  const amberParty = (await db.query("select id from public.customs_record_parties where name_as_printed = 'AMBER TRADING CO LTD'")).rows[0].id;
  const marked = await customsStore.mark({ partyId: amberParty, status: "review", method: "fuzzy_name", confidence: 45, reasons: ["hai hồ sơ gần giống"] });
  check("ghi được trạng thái chờ xem kèm lý do", marked.status === "review" && marked.buyer_profile_id === null, JSON.stringify(marked));
  check("bên chờ xem vẫn nằm trong hàng đợi", (await db.query("select count(*)::int as n from public.customs_resolution_queue where customs_party_id = $1", [amberParty])).rows[0].n === 1);
  let markLinkedRefused = "";
  try {
    await customsStore.mark({ partyId: amberParty, status: "linked" });
  } catch (error) {
    markLinkedRefused = error.message;
  }
  check("không dùng hàm đánh dấu để nối tắt", markLinkedRefused.includes("review"), markLinkedRefused);

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
