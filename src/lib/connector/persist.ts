/**
 * Ghi kết quả connector vào database — tầng nối "đọc được" với "mở lại còn
 * nguyên" (xem docs/contact-candidate-pipeline-audit.md, mục 5 việc cần làm #1).
 *
 * Bốn nguyên tắc, giống phần còn lại của connector:
 *  1. Chỉ ghi thứ đã thấy trên trang công khai: mỗi dòng mang `source_url` +
 *     câu chữ gốc (`evidence_snippet`). Thiếu câu chữ thì không ghi — người
 *     kiểm sau phải nhìn ra ngay vì sao dòng đó tồn tại.
 *  2. Không bao giờ ghi `contact_candidates`: bảng đó dành cho email tự đoán
 *     theo pattern, và connector thì không đoán. Sau mỗi lần ghi, bảng đó phải
 *     trống (được kiểm trong `npm run persist:test`).
 *  3. `is_verified` luôn `false`. Connector chứng minh được "giá trị này có
 *     trên trang công khai", không chứng minh được "hộp thư này là của đúng
 *     người". Hai chuyện đó khác nhau, và database phân biệt chúng.
 *  4. Ghi lặp không tạo bản sao: chạy lại cùng tên miền chỉ làm mới
 *     `last_seen_at`, không nhân đôi kênh / người / đường vào.
 *
 * Phần dựng dữ liệu (`buildBuyerWriteBatch`) là hàm thuần, không chạm mạng,
 * để `scripts/test-persist.mjs` chạy được cả trên PGlite thật.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConnectorResult, FoundChannel } from "./types";

// --------------------------------------------------------------- từ vựng DB --
// Chép đúng enum trong 005/006. Sai một chữ là insert hỏng, nên test đối chiếu
// danh sách này với chính file migration.
export type ChannelTypeDb = "email" | "phone" | "form" | "linkedin_url" | "whatsapp" | "portal";
export type IdentityMatchDb = "person" | "department" | "company_general" | "unknown";
export type RouteKindDb =
  | "vendor_registration"
  | "supplier_portal"
  | "rfq_form"
  | "procurement_page"
  | "department_email"
  | "department_phone"
  | "trade_show_contact";

/** Nguồn dữ liệu: tất cả những gì connector đọc đều nằm trên website công ty. */
export const COMPANY_SITE_SOURCE_KEY = "company_website";

const CHANNEL_TYPE_DB: Partial<Record<FoundChannel["type"], ChannelTypeDb>> = {
  email: "email",
  phone: "phone",
  form: "form",
  whatsapp: "whatsapp",
  linkedin: "linkedin_url",
  // `link` là một trang đáng đọc, không phải kênh liên hệ — không ghi thành kênh.
};

export type BatchChannel = {
  channel_type: ChannelTypeDb;
  value: string;
  identity_match: IdentityMatchDb;
  certainty: "confirmed" | "probable";
  source_url: string;
  evidence_snippet: string;
  /** Vị trí trong `people` khi kênh được công bố ngay cạnh tên một người. */
  personIndex: number | null;
};

export type BatchPerson = {
  full_name: string;
  job_title: string | null;
  source_url: string;
  evidence_snippet: string;
};

export type BatchRoute = {
  route_kind: RouteKindDb;
  department: string | null;
  url: string | null;
  value: string | null;
  source_url: string;
  evidence_snippet: string | null;
};

export type BuyerWriteBatch = {
  organizationId: string;
  marketSourceKey: string;
  buyerProfile: {
    legal_name: string;
    display_name: string;
    country: string;
    domain: string;
    website: string;
  };
  people: BatchPerson[];
  channels: BatchChannel[];
  routes: BatchRoute[];
  /** Thứ bị bỏ lại, kèm lý do. Không hiện cho người dùng (spec §9). */
  skipped: { value: string; reason: string }[];
};

export type BatchResult = { ok: true; batch: BuyerWriteBatch } | { ok: false; reason: string };

export type SaveResult =
  | {
      ok: true;
      buyerProfileId: string;
      channels: { inserted: number; refreshed: number; skipped: number };
      people: { inserted: number; refreshed: number };
      routes: { inserted: number; refreshed: number };
      /** Luôn 0: connector không sinh email theo pattern. */
      candidatesInserted: 0;
    }
  | { ok: false; reason: string };

// ------------------------------------------------------------ dựng dữ liệu ---

function clean(value: string) {
  return value.trim();
}

function keyOf(value: string) {
  return value.trim().toLowerCase();
}

function hostFromDomain(domain: string) {
  return domain.replace(/^www\./i, "").toLowerCase();
}

/** Những đường dẫn cho thấy một trang là đường vào cho nhà cung cấp. */
const ROUTE_RULES: { pattern: RegExp; kind: RouteKindDb; note: string }[] = [
  {
    pattern: /(become|new|register|registration|onboard)[-_/a-z]*?(supplier|vendor)|(supplier|vendor)[-_/a-z]*?(regist|onboard|application)/i,
    kind: "vendor_registration",
    note: "trang đăng ký nhà cung cấp",
  },
  { pattern: /ariba|coupa|jaggaer|sap[-_]?business|supplier[-_]?portal|vendor[-_]?portal/i, kind: "supplier_portal", note: "cổng nhà cung cấp" },
  { pattern: /rfq|request[-_]?(a[-_])?(for[-_])?(quote|quotation)|request[-_]?for[-_]?quote/i, kind: "rfq_form", note: "trang yêu cầu báo giá" },
  { pattern: /(^|\/)(procurement|purchasing|sourcing|suppliers?|vendors?)(\/|$)/i, kind: "procurement_page", note: "trang mua hàng / nhà cung cấp" },
];

function routeForUrl(url: string): { kind: RouteKindDb; note: string } | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  for (const rule of ROUTE_RULES) {
    if (rule.pattern.test(path)) return { kind: rule.kind, note: rule.note };
  }
  return null;
}

/**
 * Biến kết quả connector thành các dòng đúng schema 005/006.
 *
 * Trả `{ ok: false }` khi thiếu thứ database bắt buộc mà connector không được
 * phép tự bịa: `country` (cột `buyer_profiles.country` là NOT NULL — suy từ
 * đuôi tên miền là đoán, nên không làm).
 */
export function buildBuyerWriteBatch(
  result: ConnectorResult,
  input: { organizationId: string; domain?: string; companyName?: string; country?: string },
): BatchResult {
  const organizationId = clean(input.organizationId);
  if (!organizationId) return { ok: false, reason: "Thiếu organization_id — không rõ ghi vào workspace nào." };

  const domain = hostFromDomain(clean(input.domain || result.domain));
  if (!domain) return { ok: false, reason: "Thiếu tên miền — không rõ đang ghi về công ty nào." };

  const country = clean(input.country ?? "");
  if (!country) {
    return {
      ok: false,
      reason: "Thiếu quốc gia: cột buyer_profiles.country là bắt buộc, và connector không suy quốc gia từ đuôi tên miền. Gửi kèm `country`.",
    };
  }

  const name = clean(input.companyName ?? "") || domain;
  const skipped: { value: string; reason: string }[] = [];

  // ------------------------------------------------------------------ người --
  const people: BatchPerson[] = [];
  const personIndexByName = new Map<string, number>();

  result.people.forEach((person) => {
    const fullName = clean(person.name);
    if (!fullName) {
      skipped.push({ value: person.id, reason: "người không có tên" });
      return;
    }
    if (!clean(person.sourceUrl)) {
      skipped.push({ value: fullName, reason: "người không có trang nguồn" });
      return;
    }
    const key = keyOf(fullName);
    if (personIndexByName.has(key)) return;
    personIndexByName.set(key, people.length);
    people.push({
      full_name: fullName,
      job_title: person.title ? clean(person.title) : null,
      source_url: person.sourceUrl,
      evidence_snippet: clean(person.evidenceSnippet) || fullName,
    });
  });

  // ------------------------------------------------------------------ kênh --
  const channels: BatchChannel[] = [];
  const seenChannels = new Set<string>();

  result.channels.forEach((channel) => {
    const channelType = CHANNEL_TYPE_DB[channel.type];
    if (!channelType) {
      skipped.push({ value: channel.value, reason: `loại kênh "${channel.type}" không có cột tương ứng trong database` });
      return;
    }

    const value = clean(channel.value);
    if (!value) {
      skipped.push({ value: channel.label, reason: "kênh rỗng" });
      return;
    }

    const sourceUrl = clean(channel.sourceUrl);
    if (!sourceUrl) {
      skipped.push({ value, reason: "kênh không có trang nguồn" });
      return;
    }

    // Điều kiện database bắt buộc: "confirmed" phải có trang nguồn, và ở đây
    // chặt hơn một mức — phải có cả câu chữ đã thấy giá trị, nếu không thì
    // người kiểm sau không có gì để đối chiếu.
    const evidence = clean(channel.evidenceSnippet);
    if (!evidence) {
      skipped.push({ value, reason: "kênh không có câu chữ làm bằng chứng" });
      return;
    }

    if (channel.certainty === "inferred") {
      skipped.push({ value, reason: "kênh được suy ra theo pattern — connector không ghi dạng này" });
      return;
    }

    const dedupeKey = `${channelType}:${keyOf(value)}`;
    if (seenChannels.has(dedupeKey)) return;
    seenChannels.add(dedupeKey);

    const personName = channel.personName ? keyOf(channel.personName) : "";
    const personIndex = personName && personIndexByName.has(personName) ? personIndexByName.get(personName)! : null;

    channels.push({
      channel_type: channelType,
      value,
      // Kênh công bố ngay cạnh tên một người là kênh của người đó — nhưng chỉ
      // khi người đó có trong `people`; nếu không thì hạ về mức công ty chung,
      // không gán bừa cho ai.
      identity_match: (personIndex === null && channel.identityMatch === "person" ? "company_general" : channel.identityMatch) as IdentityMatchDb,
      certainty: channel.certainty === "probable" ? "probable" : "confirmed",
      source_url: sourceUrl,
      evidence_snippet: evidence,
      personIndex,
    });
  });

  // ------------------------------------------------------------- đường vào --
  const routes: BatchRoute[] = [];
  const seenRoutes = new Set<string>();

  const pushRoute = (route: BatchRoute) => {
    const key = `${route.route_kind}:${keyOf(route.url ?? route.value ?? "")}`;
    if (seenRoutes.has(key)) return;
    seenRoutes.add(key);
    routes.push(route);
  };

  // Trang mua hàng / đăng ký nhà cung cấp mà connector đã đọc được.
  result.pages.forEach((page) => {
    if (typeof page.status !== "number" || page.status >= 400) return;
    const rule = routeForUrl(page.url);
    if (!rule) return;
    pushRoute({
      route_kind: rule.kind,
      department: null,
      url: page.url,
      value: null,
      source_url: page.url,
      evidence_snippet: `Trang ${rule.note} đọc được ngày chụp.`,
    });
  });

  // Hộp thư / số điện thoại của bộ phận: cùng một dòng kênh, nhưng đây là
  // đường vào ở mức bộ phận nên cũng nằm trong buyer_routes.
  result.channels.forEach((channel) => {
    if (channel.identityMatch !== "department") return;
    if (channel.type !== "email" && channel.type !== "phone") return;
    pushRoute({
      route_kind: channel.type === "email" ? "department_email" : "department_phone",
      department: null,
      url: null,
      value: clean(channel.value),
      source_url: clean(channel.sourceUrl),
      evidence_snippet: clean(channel.evidenceSnippet) || null,
    });
  });

  return {
    ok: true,
    batch: {
      organizationId,
      marketSourceKey: COMPANY_SITE_SOURCE_KEY,
      buyerProfile: {
        legal_name: name,
        display_name: name,
        country,
        domain,
        website: `https://${domain}`,
      },
      people,
      channels,
      routes,
      skipped,
    },
  };
}

// ------------------------------------------------------------- ghi xuống DB --

/**
 * Cổng ghi nhỏ: production dùng Supabase, test dùng PGlite. Nhờ vậy phần quyết
 * định (khi nào thêm dòng mới, khi nào chỉ làm mới `last_seen_at`) được kiểm
 * trên chính schema thật, không phải trên một bản mô phỏng.
 */
export type BuyerStore = {
  findMarketSourceId(key: string): Promise<string | null>;
  upsertBuyerProfile(row: BuyerWriteBatch["buyerProfile"] & { organizationId: string; marketSourceId: string }): Promise<string>;
  listPeople(buyerProfileId: string): Promise<{ id: string; full_name: string | null }[]>;
  insertPeople(rows: Record<string, unknown>[]): Promise<{ id: string; full_name: string | null }[]>;
  touchPeople(ids: string[]): Promise<void>;
  listChannels(buyerProfileId: string): Promise<{ id: string; channel_type: string; value: string }[]>;
  insertChannels(rows: Record<string, unknown>[]): Promise<void>;
  touchChannels(ids: string[]): Promise<void>;
  listRoutes(buyerProfileId: string): Promise<{ id: string; route_kind: string; url: string | null; value: string | null }[]>;
  insertRoutes(rows: Record<string, unknown>[]): Promise<void>;
};

export async function saveBuyerDiscovery(store: BuyerStore, batch: BuyerWriteBatch): Promise<SaveResult> {
  const marketSourceId = await store.findMarketSourceId(batch.marketSourceKey);
  if (!marketSourceId) {
    return { ok: false, reason: `Chưa có dòng market_sources khoá "${batch.marketSourceKey}" (migration 005) — không ghi được vì thiếu nguồn.` };
  }

  const buyerProfileId = await store.upsertBuyerProfile({
    ...batch.buyerProfile,
    organizationId: batch.organizationId,
    marketSourceId,
  });

  const base = { organization_id: batch.organizationId, buyer_profile_id: buyerProfileId, market_source_id: marketSourceId };

  // ------------------------------------------------------------------ người --
  const existingPeople = await store.listPeople(buyerProfileId);
  const personIdByName = new Map(existingPeople.map((person) => [keyOf(person.full_name ?? ""), person.id]));
  const peopleToInsert = batch.people.filter((person) => !personIdByName.has(keyOf(person.full_name)));

  if (peopleToInsert.length > 0) {
    const inserted = await store.insertPeople(
      peopleToInsert.map((person) => ({
        ...base,
        full_name: person.full_name,
        job_title: person.job_title,
        department: null,
        // Hạng b: có tên, một nguồn công khai. Hạng a dành cho nguồn chính thức
        // đối chiếu được (sổ đăng ký), hạng c là tín hiệu chức danh không tên.
        grade: "b",
        source_url: person.source_url,
        corroboration_count: 1,
      })),
    );
    inserted.forEach((row) => personIdByName.set(keyOf(row.full_name ?? ""), row.id));
  }

  const refreshedPeople = batch.people.filter((person) => existingPeople.some((row) => keyOf(row.full_name ?? "") === keyOf(person.full_name)));
  if (refreshedPeople.length > 0) {
    await store.touchPeople(refreshedPeople.map((person) => personIdByName.get(keyOf(person.full_name))!));
  }

  // ------------------------------------------------------------------ kênh --
  const existingChannels = await store.listChannels(buyerProfileId);
  const channelKey = (channelType: string, value: string) => `${channelType}:${keyOf(value)}`;
  const channelIdByKey = new Map(existingChannels.map((channel) => [channelKey(channel.channel_type, channel.value), channel.id]));

  const channelsToInsert = batch.channels.filter((channel) => !channelIdByKey.has(channelKey(channel.channel_type, channel.value)));
  if (channelsToInsert.length > 0) {
    await store.insertChannels(
      channelsToInsert.map((channel) => ({
        ...base,
        decision_maker_id: channel.personIndex === null ? null : (personIdByName.get(keyOf(batch.people[channel.personIndex].full_name)) ?? null),
        channel_type: channel.channel_type,
        value: channel.value,
        provenance: "company_site",
        certainty: channel.certainty,
        discovered_by: "web_research_agent",
        identity_match: channel.identity_match,
        source_url: channel.source_url,
        evidence_snippet: channel.evidence_snippet,
        // Connector chỉ quan sát. Việc gắn giá trị với đúng người là bước khác.
        is_verified: false,
        is_public: true,
      })),
    );
  }

  const channelsToRefresh = batch.channels.filter((channel) => channelIdByKey.has(channelKey(channel.channel_type, channel.value)));
  if (channelsToRefresh.length > 0) {
    await store.touchChannels(channelsToRefresh.map((channel) => channelIdByKey.get(channelKey(channel.channel_type, channel.value))!));
  }

  // ------------------------------------------------------------- đường vào --
  const existingRoutes = await store.listRoutes(buyerProfileId);
  const routeKeyOf = (routeKind: string, url: string | null, value: string | null) => `${routeKind}:${keyOf(url ?? value ?? "")}`;
  const existingRouteKeys = new Set(existingRoutes.map((route) => routeKeyOf(route.route_kind, route.url, route.value)));

  const routesToInsert = batch.routes.filter((route) => !existingRouteKeys.has(routeKeyOf(route.route_kind, route.url, route.value)));
  if (routesToInsert.length > 0) {
    await store.insertRoutes(
      routesToInsert.map((route) => ({
        ...base,
        route_kind: route.route_kind,
        department: route.department,
        url: route.url,
        value: route.value,
        source_url: route.source_url,
        evidence_snippet: route.evidence_snippet,
        is_verified: false,
        discovered_by: "web_research_agent",
      })),
    );
  }

  return {
    ok: true,
    buyerProfileId,
    channels: { inserted: channelsToInsert.length, refreshed: channelsToRefresh.length, skipped: batch.skipped.length },
    people: { inserted: peopleToInsert.length, refreshed: refreshedPeople.length },
    routes: { inserted: routesToInsert.length, refreshed: batch.routes.length - routesToInsert.length },
    // Không có nhánh nào ghi vào contact_candidates: connector không đoán email.
    candidatesInserted: 0,
  };
}

// ------------------------------------------------------- adapter Supabase ----

/** `BuyerStore` chạy bằng session/ service-role client của Supabase. */
export function supabaseBuyerStore(client: SupabaseClient): BuyerStore {
  return {
    async findMarketSourceId(key) {
      const { data, error } = await client.from("market_sources").select("id").eq("key", key).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { id: string } | null)?.id ?? null;
    },

    async upsertBuyerProfile(row) {
      const { data, error } = await client
        .from("buyer_profiles")
        .upsert(
          {
            organization_id: row.organizationId,
            legal_name: row.legal_name,
            display_name: row.display_name,
            country: row.country,
            domain: row.domain,
            website: row.website,
          },
          { onConflict: "organization_id,domain" },
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    },

    async listPeople(buyerProfileId) {
      const { data, error } = await client.from("decision_makers").select("id, full_name").eq("buyer_profile_id", buyerProfileId);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; full_name: string | null }[];
    },

    async insertPeople(rows) {
      const { data, error } = await client.from("decision_makers").insert(rows).select("id, full_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; full_name: string | null }[];
    },

    async touchPeople(ids) {
      const { error } = await client.from("decision_makers").update({ last_seen_at: new Date().toISOString() }).in("id", ids);
      if (error) throw new Error(error.message);
    },

    async listChannels(buyerProfileId) {
      const { data, error } = await client.from("contact_channels").select("id, channel_type, value").eq("buyer_profile_id", buyerProfileId);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; channel_type: string; value: string }[];
    },

    async insertChannels(rows) {
      const { error } = await client.from("contact_channels").insert(rows);
      if (error) throw new Error(error.message);
    },

    async touchChannels(ids) {
      const { error } = await client.from("contact_channels").update({ last_seen_at: new Date().toISOString() }).in("id", ids);
      if (error) throw new Error(error.message);
    },

    async listRoutes(buyerProfileId) {
      const { data, error } = await client.from("buyer_routes").select("id, route_kind, url, value").eq("buyer_profile_id", buyerProfileId);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; route_kind: string; url: string | null; value: string | null }[];
    },

    async insertRoutes(rows) {
      const { error } = await client.from("buyer_routes").insert(rows);
      if (error) throw new Error(error.message);
    },
  };
}
