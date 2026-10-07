/**
 * Kiểu dữ liệu, bộ lọc và CSV của danh sách buyer — thuần, không phụ thuộc server.
 *
 * Tách khỏi `buyers.ts` (loader) để client component dùng được bộ lọc và định
 * dạng CSV mà không kéo `next/headers` vào bundle trình duyệt.
 */

import { initialReports, type CompanyReport } from "@/lib/demo-data";

/**
 * Danh sách buyer: đọc từ `buyer_outreach_summary` + `outreach_ready_contacts`
 * (đều là view `security_invoker`, nên RLS theo tenant vẫn quyết định).
 *
 * Nguyên tắc của file này, giống phần còn lại của sản phẩm: chỉ giá trị tìm
 * được, nguồn, ngày thấy, nhãn tin cậy. Không xếp hạng, không khuyến nghị.
 */

export type BuyerListRow = {
  id: string;
  name: string;
  country: string | null;
  region: string | null;
  website: string | null;
  industry: string | null;
  /** Số kênh được phép xuất (đã qua policy). */
  exportableChannels: number;
  /** Trong đó đã xác minh được là của đúng người/bộ phận. */
  verifiedChannels: number;
  /** Số kênh bị policy giữ lại (chưa kiểm mailbox, catch-all, hết hạn...). */
  withheldChannels: number;
  namedPeople: number;
  lastSignalAt: string | null;
  lastContactSeenAt: string | null;
};

export type BuyerContactRow = {
  buyerId: string;
  buyerName: string;
  country: string | null;
  website: string | null;
  personName: string | null;
  jobTitle: string | null;
  department: string | null;
  channelType: string;
  value: string;
  confidenceLabel: string;
  identityMatch: string;
  deliverability: string;
  isVerified: boolean;
  requiresOverride: boolean;
  sourceUrl: string | null;
  lastSeenAt: string | null;
  /** Khoá để nối với `contact_whatsapp_links`; chỉ có khi đọc từ database. */
  channelId?: string | null;
  /** Chỉ có khi số đã được kiểm là có WhatsApp. Chưa kiểm thì không có gì. */
  whatsappUrl?: string | null;
  whatsappCheckedBy?: string | null;
};

export type BuyerListPayload = {
  buyers: BuyerListRow[];
  contacts: BuyerContactRow[];
};

// ---------------------------------------------------------------------------
// Định dạng dữ liệu thô từ Postgres
// ---------------------------------------------------------------------------
export type BuyerSummaryDbRow = {
  buyer_profile_id: string;
  display_name: string | null;
  country: string | null;
  region: string | null;
  website: string | null;
  industry: string | null;
  named_people: number | null;
  verified_channels: number | null;
  last_signal_at: string | null;
  last_contact_seen_at: string | null;
};

export type BuyerContactDbRow = {
  buyer_profile_id: string;
  buyer_name: string | null;
  country: string | null;
  website: string | null;
  full_name: string | null;
  job_title: string | null;
  department: string | null;
  channel_type: string;
  value: string;
  confidence_label: string | null;
  identity_match: string | null;
  deliverability: string | null;
  is_verified: boolean | null;
  requires_override: boolean | null;
  source_url: string | null;
  last_seen_at: string | null;
  channel_id?: string | null;
};

export const BUYER_SUMMARY_COLUMNS =
  "buyer_profile_id, display_name, country, region, website, industry, named_people, verified_channels, last_signal_at, last_contact_seen_at";

/**
 * Số đã được một dịch vụ kiểm là có WhatsApp (view `contact_whatsapp_links`,
 * migration 008). Chỉ những dòng có lần kiểm mới nằm trong view này, nên UI
 * không phải tự quyết định gì thêm.
 */
export type WhatsAppLinkRow = {
  channel_id: string;
  buyer_profile_id: string;
  phone_e164: string | null;
  whatsapp_url: string;
  whatsapp_checked_by: string | null;
};

export const WHATSAPP_LINK_COLUMNS = "channel_id, buyer_profile_id, phone_e164, whatsapp_url, whatsapp_checked_by";

export const BUYER_CONTACT_COLUMNS =
  "buyer_profile_id, buyer_name, country, website, full_name, job_title, department, channel_type, value, confidence_label, identity_match, deliverability, is_verified, requires_override, source_url, last_seen_at";

export function toBuyerList(
  summaryRows: BuyerSummaryDbRow[],
  contactRows: BuyerContactDbRow[],
  withheldByBuyer: Map<string, number>,
  whatsappByChannel: Map<string, { url: string; checkedBy: string | null }> = new Map(),
): BuyerListPayload {
  const contacts: BuyerContactRow[] = contactRows.map((row) => ({
    buyerId: row.buyer_profile_id,
    buyerName: row.buyer_name ?? "",
    country: row.country,
    website: row.website,
    personName: row.full_name,
    jobTitle: row.job_title,
    department: row.department,
    channelType: row.channel_type,
    value: row.value,
    confidenceLabel: row.confidence_label ?? "probable",
    identityMatch: row.identity_match ?? "unknown",
    deliverability: row.deliverability ?? "not_checked",
    isVerified: Boolean(row.is_verified),
    requiresOverride: Boolean(row.requires_override),
    sourceUrl: row.source_url,
    lastSeenAt: row.last_seen_at,
    channelId: row.channel_id ?? null,
    whatsappUrl: row.channel_id ? (whatsappByChannel.get(row.channel_id)?.url ?? null) : null,
    whatsappCheckedBy: row.channel_id ? (whatsappByChannel.get(row.channel_id)?.checkedBy ?? null) : null,
  }));

  const exportableByBuyer = new Map<string, number>();
  contacts.forEach((contact) => {
    exportableByBuyer.set(contact.buyerId, (exportableByBuyer.get(contact.buyerId) ?? 0) + 1);
  });

  const buyers: BuyerListRow[] = summaryRows.map((row) => ({
    id: row.buyer_profile_id,
    name: row.display_name?.trim() || "—",
    country: row.country,
    region: row.region,
    website: row.website,
    industry: row.industry,
    exportableChannels: exportableByBuyer.get(row.buyer_profile_id) ?? 0,
    verifiedChannels: Numeric(row.verified_channels),
    withheldChannels: withheldByBuyer.get(row.buyer_profile_id) ?? 0,
    namedPeople: Numeric(row.named_people),
    lastSignalAt: row.last_signal_at,
    lastContactSeenAt: row.last_contact_seen_at,
  }));

  return { buyers, contacts };
}

function Numeric(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// Lọc — một chỗ duy nhất, để màn hình và file CSV luôn khớp nhau
// ---------------------------------------------------------------------------
export type BuyerFilters = {
  country?: string;
  query?: string;
  onlyWithPeople?: boolean;
};

export function filterBuyerList(payload: BuyerListPayload, filters: BuyerFilters = {}): BuyerListPayload {
  const country = filters.country?.trim() ?? "";
  const query = filters.query?.trim().toLowerCase() ?? "";

  const buyers = payload.buyers.filter((buyer) => {
    if (country && buyer.country !== country) return false;
    if (filters.onlyWithPeople && buyer.namedPeople === 0) return false;
    if (!query) return true;
    return [buyer.name, buyer.country, buyer.industry, buyer.website]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query));
  });

  const allowed = new Set(buyers.map((buyer) => buyer.id));
  return { buyers, contacts: payload.contacts.filter((contact) => allowed.has(contact.buyerId)) };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export const CSV_COLUMNS = [
  "company",
  "country",
  "website",
  "person_name",
  "job_title",
  "department",
  "channel_type",
  "channel_value",
  "confidence",
  "identity_match",
  "deliverability",
  "verified",
  "export_scope",
  "source_url",
  "last_seen",
] as const;

/** Bọc giá trị theo RFC 4180: nhân đôi dấu nháy, bọc khi có dấu phẩy/xuống dòng. */
export function csvCell(value: string | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * CSV để mở bằng Excel: có BOM UTF-8 để tiếng Việt không bị lỗi font, xuống
 * dòng CRLF. Chỉ chứa dữ liệu và nguồn — không có cột xếp hạng hay khuyến nghị.
 */
export function buildBuyerCsv(payload: BuyerListPayload): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];

  const buyerById = new Map(payload.buyers.map((buyer) => [buyer.id, buyer]));

  payload.contacts.forEach((contact) => {
    const buyer = buyerById.get(contact.buyerId);
    lines.push(
      [
        buyer?.name ?? contact.buyerName,
        buyer?.country ?? contact.country,
        buyer?.website ?? contact.website,
        contact.personName,
        contact.jobTitle,
        contact.department,
        contact.channelType,
        contact.value,
        contact.confidenceLabel,
        contact.identityMatch,
        contact.deliverability,
        contact.isVerified ? "yes" : "no",
        contact.requiresOverride ? "requires_confirmation" : "standard",
        contact.sourceUrl,
        contact.lastSeenAt,
      ]
        .map(csvCell)
        .join(","),
    );
  });

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Demo: suy ra danh sách từ các report mẫu để UI vẫn chạy khi chưa có dữ liệu
// ---------------------------------------------------------------------------
export function demoBuyerList(): BuyerListPayload {
  const buyers: BuyerListRow[] = [];
  const contacts: BuyerContactRow[] = [];

  initialReports.forEach((report: CompanyReport) => {
    let exportable = 0;

    report.contacts.forEach((contact) => {
      const policy = contact.policy ?? "needs_mailbox_check";
      if (policy === "requires_override") return;
      exportable += 1;
      contacts.push({
        buyerId: report.id,
        buyerName: report.companyName,
        country: report.country,
        website: report.website ?? null,
        personName: contact.identityMatch === "person" ? (contact.personName ?? null) : null,
        jobTitle: contact.identityMatch === "person" ? (contact.personTitle ?? contact.via ?? null) : null,
        department: contact.identityMatch === "department" ? (contact.via ?? null) : null,
        channelType: contact.type,
        value: contact.value,
        confidenceLabel: contact.verified ? "verified" : (contact.certainty ?? "probable"),
        identityMatch: contact.identityMatch ?? "unknown",
        deliverability: "not_checked",
        isVerified: contact.verified,
        requiresOverride: false,
        sourceUrl: contact.sourceUrl ?? null,
        lastSeenAt: null,
      });
    });

    report.people?.forEach((person) => {
      person.channels.forEach((channel) => {
        if (channel.policy === "requires_override") return;
        exportable += 1;
        contacts.push({
          buyerId: report.id,
          buyerName: report.companyName,
          country: report.country,
          website: report.website ?? null,
          personName: person.name,
          jobTitle: person.title,
          department: person.department,
          channelType: channel.type,
          value: channel.value,
          confidenceLabel: channel.certainty,
          identityMatch: person.identityMatch,
          deliverability: "not_checked",
          isVerified: false,
          requiresOverride: false,
          sourceUrl: person.sourceUrl,
          lastSeenAt: person.lastSeenAt,
        });
      });
    });

    buyers.push({
      id: report.id,
      name: report.companyName,
      country: report.country,
      region: null,
      website: report.website ?? null,
      industry: report.industry,
      exportableChannels: exportable,
      verifiedChannels: report.contacts.filter((contact) => contact.verified).length,
      withheldChannels: 0,
      namedPeople: report.people?.length ?? 0,
      lastSignalAt: null,
      lastContactSeenAt: report.lastUpdated ?? null,
    });
  });

  return { buyers, contacts };
}
