/**
 * Từ kết quả connector (đã đọc trang thật) → **Company Report** đúng định dạng
 * mà app lưu và hiển thị.
 *
 * Nguyên tắc của file này: mọi trường đều **đếm được hoặc đọc được từ một trang
 * đã mở**. Không có trường nào được suy diễn cho đẹp:
 *
 *  - quốc gia chỉ lấy từ bộ lọc người dùng đã chọn, không đoán từ đuôi tên miền;
 *  - ngành, năm thành lập, số nhân sự để trống — connector không đọc ra chúng;
 *  - mô tả là **câu của chính website** (meta description), kèm URL;
 *  - điểm tin cậy tính từ những gì đã đếm được, và công thức nằm ngay dưới đây
 *    để người đọc kiểm lại được, không phải một con số từ trên trời rơi xuống.
 */

import type { CompanyReport, Contact, IntelNote } from "@/lib/demo-data";
import type { ConnectorResult, FoundChannel } from "@/lib/connector/types";
import { channelToContact, resultToNotes, resultToPeople, resultToRequirements } from "@/lib/connector/to-report";
import { coverageOf } from "@/lib/connector/gate";
import type { AppLocale } from "@/lib/i18n";

export type EvidenceInput = {
  kind: "website";
  source_label: string;
  source_url: string;
  field_name?: string;
  evidence_snippet?: string;
  is_verified: boolean;
};

export type ReportColumns = {
  official_website: string | null;
  linkedin_url: string | null;
  public_business_email: string | null;
  public_business_phone: string | null;
  whatsapp_business_url: string | null;
};

const ACCENTS = ["#5D53E8", "#219070", "#F29E4C", "#3E7BE8", "#B4508C", "#7A6BE0"];

function accentFor(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return ACCENTS[hash % ACCENTS.length];
}

export function initialsFromCompanyName(value: string): string {
  const letters = value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return letters || "SE";
}

/** Hạng của một kênh khi phải chọn **một** giá trị cho cột trong database. */
function channelRank(channel: FoundChannel): number {
  const identity =
    channel.identityMatch === "department" ? 0 : channel.identityMatch === "company_general" ? 1 : channel.identityMatch === "person" ? 2 : 3;
  const policy =
    channel.policy === "outreach_ready" ? 0 : channel.policy === "needs_mailbox_check" ? 1 : channel.policy === "manual_contact_only" ? 2 : 3;
  const certainty = channel.certainty === "confirmed" ? 0 : channel.certainty === "probable" ? 1 : 2;
  return identity * 100 + policy * 10 + certainty;
}

/**
 * Cột `public_business_*` của bảng `company_reports` giữ **một** giá trị mỗi
 * loại, nên phải chọn: kênh của bộ phận trước, kênh chung sau, kênh của cá nhân
 * cuối cùng. Toàn bộ danh sách vẫn được lưu trong `report_data.contacts`.
 */
export function pickPrimaryChannels(result: ConnectorResult): Record<"email" | "phone" | "linkedin" | "whatsapp", FoundChannel | null> {
  const choose = (type: FoundChannel["type"]) => {
    const candidates = result.channels.filter((channel) => channel.type === type);
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => channelRank(a) - channelRank(b))[0];
  };
  return { email: choose("email"), phone: choose("phone"), linkedin: choose("linkedin"), whatsapp: choose("whatsapp") };
}

/**
 * Điểm tin cậy — công thức đếm được, không phải cảm giác:
 *
 * | Thành phần | Điểm |
 * | --- | --- |
 * | đọc được ít nhất một trang | +10 |
 * | **tên công ty có trên trang đã đọc** | +20 (không xác nhận được: −5 và ghi chú) |
 * | mỗi loại kênh khác nhau tìm được (email/phone/linkedin/whatsapp/form) | +5, tối đa +20 |
 * | có kênh thuộc nhóm mua hàng | +10 |
 * | sổ đăng ký doanh nghiệp đối chiếu được | +5 |
 * | bị chặn/hết thời gian giữa đường | −10 |
 *
 * Nền 30, trần 90, sàn 25. Không bao giờ chạm 100: chưa kiểm được hộp thư có
 * thật hay không thì không có chuyện "chắc chắn".
 */
export function confidenceForConnector(input: {
  pagesFetched: number;
  identityMatched?: boolean;
  nameGiven: boolean;
  channelTypes: number;
  buyingDoor: boolean;
  registry: boolean;
  partial: boolean;
}): number {
  let score = 30;
  if (input.pagesFetched > 0) score += 10;
  if (input.identityMatched === true) score += 20;
  else if (input.nameGiven) score -= 5;
  score += Math.min(20, 5 * input.channelTypes);
  if (input.buyingDoor) score += 10;
  if (input.registry) score += 5;
  if (input.partial) score -= 10;
  return Math.max(25, Math.min(90, score));
}

function pageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`.slice(0, 90);
  } catch {
    return url.slice(0, 90);
  }
}

export type ConnectorReportInput = {
  /** Tên người dùng nhập. Rỗng khi họ dán link — khi đó lấy tên miền làm tên. */
  companyName: string;
  /** Quốc gia người dùng đã chọn, hoặc rỗng. Không đoán từ đâu khác. */
  country: string;
  sourceInput?: string;
  result: ConnectorResult;
  locale: AppLocale;
  /** URL gốc của kết quả tìm kiếm đã dẫn tới tên miền này, nếu có. */
  resolvedFrom?: { url: string; why: string[] } | null;
  retentionDays: number;
  now?: Date;
};

/** Dữ liệu để **người kiểm** đọc lại: chạy từ đâu, đã hỏi những đâu, trang nào chặn. */
export type ReportProvenance = {
  resolvedFrom: { url: string; why: string[] } | null;
  registry: ConnectorResult["registry"] | null;
  secondary: ConnectorResult["secondary"] | null;
  pages: ConnectorResult["pages"];
  stoppedEarly: string | null;
};

export function buildConnectorReport(input: ConnectorReportInput): {
  report: CompanyReport;
  evidence: EvidenceInput[];
  columns: ReportColumns;
  provenance: ReportProvenance;
} {
  const { result, companyName, country, locale } = input;
  const now = input.now ?? new Date();
  const name = companyName.trim() || result.domain;
  const website = `https://${result.domain}`;
  const coverage = coverageOf(result.channels);
  const primary = pickPrimaryChannels(result);
  const channelTypes = new Set(result.channels.map((channel) => channel.type)).size;
  const identityConfirmed = result.identityMatched === true;

  const confidence = confidenceForConnector({
    pagesFetched: result.pagesFetched,
    identityMatched: result.identityMatched,
    nameGiven: Boolean(companyName.trim()),
    channelTypes,
    buyingDoor: coverage.enough,
    registry: Boolean(result.registry),
    partial: Boolean(result.stoppedEarly),
  });

  // Kênh hiển thị: website trước, rồi tới kênh của công ty/bộ phận. Kênh của cá
  // nhân ở lại thẻ người đó (PeoplePanel), không lẫn vào danh sách chung.
  const websiteContact: Contact = {
    label: locale === "vi" ? "Website chính thức" : "Official website",
    value: result.domain,
    type: "website",
    // Website coi như đã xác nhận khi: tên công ty có trên trang, hoặc chính
    // người dùng dán link này (họ tự bảo đảm nó là website công ty).
    verified: identityConfirmed || !companyName.trim(),
    source: identityConfirmed ? (locale === "vi" ? "Trang đã đọc, có tên công ty" : "Page read, company name present") : locale === "vi" ? "Do bạn dán link" : "Pasted by you",
    sourceUrl: website,
  };
  const contacts: Contact[] = [
    websiteContact,
    ...result.channels.filter((channel) => channel.identityMatch !== "person").map(channelToContact),
  ];

  const notes: IntelNote[] = resultToNotes(result);
  if (companyName.trim() && !identityConfirmed) {
    notes.push({
      kind: "not_found",
      label: locale === "vi" ? "Tên công ty trên trang đã đọc" : "Company name on the pages read",
      detail: (locale === "vi"
        ? `Đã đọc ${result.pagesFetched} trang của ${result.domain} nhưng không thấy tên "${companyName.trim()}" trên trang nào. Có thể website này không phải công ty đó, hoặc tên trên site viết khác đi.`
        : `Read ${result.pagesFetched} pages on ${result.domain} without seeing "${companyName.trim()}". The site may be a different company, or it writes its name differently.`),
      sourceUrl: website,
    });
  }
  for (const hint of result.reviewHints) {
    notes.push({
      kind: "excluded",
      label: hint.value,
      detail: `${locale === "vi" ? "Gần đúng — người xem lại" : "Near match — needs review"}: ${hint.reason}`,
      sourceUrl: result.channels.find((channel) => channel.value === hint.value)?.sourceUrl,
    });
  }
  const signals: string[] = [];
  signals.push(locale === "vi" ? `Đã đọc ${result.pagesFetched} trang công khai` : `Read ${result.pagesFetched} public pages`);
  if (coverage.enough) signals.push(locale === "vi" ? "Có kênh thuộc nhóm mua hàng" : "Has a buying-team channel");
  if (channelTypes > 0) signals.push(locale === "vi" ? `${channelTypes} loại kênh liên hệ` : `${channelTypes} channel types`);
  if (result.people.length > 0) signals.push(locale === "vi" ? `${result.people.length} người công bố kèm kênh` : `${result.people.length} people with channels`);
  if (result.registry) signals.push(locale === "vi" ? "Đã đối chiếu sổ đăng ký" : "Registry checked");
  if (companyName.trim() && !identityConfirmed) signals.push(locale === "vi" ? "Chưa xác nhận tên trên trang" : "Name not confirmed on page");
  if (result.stoppedEarly) signals.push(locale === "vi" ? "Chưa đọc hết — hết thời gian" : "Not fully read — out of time");

  const dateLabel = (date: Date) => new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(date);
  const dayLabel = (date: Date) => new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short" }).format(date);
  const expires = new Date(now.getTime() + Math.max(1, input.retentionDays) * 86_400_000);

  const report: CompanyReport = {
    id: `report-${now.getTime().toString(36)}`,
    companyName: name,
    initials: initialsFromCompanyName(name),
    accent: accentFor(name),
    country: country.trim() || (locale === "vi" ? "Chưa xác định" : "Not determined"),
    sourceInput: input.sourceInput,
    status: result.channels.length > 0 ? "ready" : "needs_review",
    confidence,
    createdAt: dateLabel(now),
    expiresAt: dayLabel(expires),
    daysLeft: Math.max(1, input.retentionDays),
    industry: "",
    description: result.description?.text ?? "",
    website: result.domain,
    lastUpdated: dateLabel(now),
    contacts,
    sources: [],
    signals,
    people: resultToPeople(result),
    requirements: resultToRequirements(result),
  };

  // Bằng chứng: mỗi giá trị đi kèm **đúng câu chữ** đã thấy nó và URL của trang.
  const evidence: EvidenceInput[] = [
    {
      kind: "website",
      source_label: locale === "vi" ? "Website chính thức" : "Official website",
      source_url: website,
      field_name: "official_website",
      evidence_snippet: result.description?.text?.slice(0, 300) ?? pageLabel(website),
      is_verified: identityConfirmed || !companyName.trim(),
    },
  ];

  const fieldByChannel: Partial<Record<FoundChannel["type"], keyof ReportColumns>> = {
    email: "public_business_email",
    phone: "public_business_phone",
    linkedin: "linkedin_url",
    whatsapp: "whatsapp_business_url",
  };

  for (const channel of result.channels) {
    const field = fieldByChannel[channel.type];
    if (!field) continue;
    // Evidence cho **mọi** kênh đã tìm thấy, không chỉ kênh được chọn vào cột:
    // người kiểm cần thấy cả những gì không lên cột chính.
    evidence.push({
      kind: "website",
      source_label: `${locale === "vi" ? "Trang công ty" : "Company page"} · ${pageLabel(channel.sourceUrl)}`,
      source_url: channel.sourceUrl,
      field_name: field,
      evidence_snippet: channel.evidenceSnippet?.slice(0, 300),
      is_verified: channel.policy === "outreach_ready",
    });
  }

  // Những trang đã đọc nhưng không cho ra kênh nào vẫn là nguồn đã kiểm: người
  // đọc thấy được phạm vi đã đọc, không phải đoán. Trang chỉ đọc để **xác minh
  // quan hệ tên miền** không tính: nó không chống lưng cho giá trị nào, và đưa
  // vào đây sẽ làm report của công ty này liệt kê website của tên miền khác.
  const readPages = result.pages
    .filter((page) => !page.relationCheck && typeof page.status === "number" && page.status < 400)
    .slice(0, 6);
  for (const page of readPages) {
    if (page.url === website) continue;
    evidence.push({
      kind: "website",
      source_label: `${locale === "vi" ? "Đã đọc" : "Read"} · ${pageLabel(page.url)}`,
      source_url: page.url,
      evidence_snippet: undefined,
      is_verified: false,
    });
  }

  const columns: ReportColumns = {
    official_website: website,
    linkedin_url: primary.linkedin ? primary.linkedin.value : null,
    public_business_email: primary.email ? primary.email.value : null,
    public_business_phone: primary.phone ? primary.phone.value : null,
    whatsapp_business_url: primary.whatsapp ? primary.whatsapp.value : null,
  };

  const provenance: ReportProvenance = {
    resolvedFrom: input.resolvedFrom ?? null,
    registry: result.registry ?? null,
    secondary: result.secondary ?? null,
    pages: result.pages,
    stoppedEarly: result.stoppedEarly ?? null,
  };

  return { report, evidence, columns, provenance };
}
