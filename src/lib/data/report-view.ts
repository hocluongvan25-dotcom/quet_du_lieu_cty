import type { CompanyReport, Contact, DecisionMaker, ReportStatus, Source } from "@/lib/demo-data";
import type { AppLocale } from "@/lib/i18n";
import type { Requirement, RequirementCategory } from "@/lib/requirements";

/**
 * Maps Supabase rows onto the report shape the dashboard renders.
 * Pure functions: no network, no React, usable on the server and in tests.
 */

export type CompanyReportRow = {
  id: string;
  company_name: string;
  country: string | null;
  city: string | null;
  industry: string | null;
  description: string | null;
  official_website: string | null;
  linkedin_url: string | null;
  public_business_email: string | null;
  public_business_phone: string | null;
  whatsapp_business_url: string | null;
  confidence: number;
  report_data: unknown;
  captured_at: string;
  expires_at: string;
  research_jobs?: { status: string | null } | { status: string | null }[] | null;
};

export type SourceEvidenceRow = {
  company_report_id: string;
  kind: string;
  source_label: string;
  source_url: string;
  field_name: string | null;
  evidence_snippet: string | null;
  is_verified: boolean;
};

const ACCENTS = ["#4F7CFF", "#7C6CFC", "#28A88B", "#F29E4C", "#D2679E", "#3E9BC4"];
const SOURCE_KINDS: Source["kind"][] = ["website", "directory", "social", "news"];

const FIELD_LABELS: Record<string, { vi: string; en: string }> = {
  official_website: { vi: "Website chính thức", en: "Official website" },
  linkedin_url: { vi: "LinkedIn công ty", en: "Company LinkedIn" },
  public_business_email: { vi: "Email kinh doanh", en: "Business email" },
  public_business_phone: { vi: "Điện thoại văn phòng", en: "Office phone" },
  whatsapp_business_url: { vi: "WhatsApp doanh nghiệp", en: "Business WhatsApp" },
};

const CONTACT_TYPES: Record<string, Contact["type"]> = {
  official_website: "website",
  linkedin_url: "linkedin",
  public_business_email: "email",
  public_business_phone: "phone",
  whatsapp_business_url: "whatsapp",
};

function initialsFor(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return letters || "CR";
}

function accentFor(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  return ACCENTS[hash % ACCENTS.length];
}

function researchStatus(row: CompanyReportRow): ReportStatus {
  const status = Array.isArray(row.research_jobs) ? row.research_jobs[0]?.status : row.research_jobs?.status;

  if (status === "queued" || status === "researching") return "researching";
  if (status === "needs_review" || status === "failed" || status === "expired") return "needs_review";
  return row.confidence >= 70 ? "ready" : "needs_review";
}

function dayStamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatMoment(value: string, locale: AppLocale) {
  const date = dayStamp(value);
  if (!date) return "-";

  const time = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfValue = new Date(date);
  startOfValue.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfValue.getTime()) / 86_400_000);

  if (dayDiff === 0) return locale === "vi" ? `Hôm nay, ${time}` : `Today, ${time}`;
  if (dayDiff === 1) return locale === "vi" ? `Hôm qua, ${time}` : `Yesterday, ${time}`;

  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(date);
}

/**
 * The credit ledger is the one place where money is real. It is read as stored
 * rows and mapped here — never rendered from a hand-written list, because a
 * fabricated debit line reads exactly like a genuine charge.
 */
export type LedgerRow = {
  id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
};

export type LedgerView = {
  id: string;
  label: string;
  detail: string;
  amountLabel: string;
  direction: "in" | "out";
  dateLabel: string;
};

const LEDGER_LABELS: Record<string, { vi: string; en: string }> = {
  credit: { vi: "Cấp credits", en: "Credits granted" },
  debit: { vi: "Company Report", en: "Company Report" },
  refund: { vi: "Hoàn credits", en: "Credits refunded" },
  adjustment: { vi: "Điều chỉnh", en: "Adjustment" },
};

export function toLedgerView(rows: LedgerRow[] | null | undefined, locale: AppLocale): LedgerView[] {
  return (rows ?? []).map((row) => {
    const direction: "in" | "out" = row.type === "credit" || row.type === "refund" ? "in" : "out";
    return {
      id: row.id,
      label: LEDGER_LABELS[row.type]?.[locale] ?? row.type,
      detail: row.description,
      amountLabel: `${direction === "in" ? "+" : "-"}${row.amount}`,
      direction,
      dateLabel: formatDate(row.created_at, locale),
    };
  });
}

export function formatDate(value: string, locale: AppLocale) {
  const date = dayStamp(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short" }).format(date);
}

function daysLeft(value: string) {
  const date = dayStamp(value);
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

const REQUIREMENT_CATEGORIES: RequirementCategory[] = ["certification", "document", "audit", "terms", "labelling"];

/** Đọc lại yêu cầu nhà cung cấp đã lưu trong `report_data`. Dữ liệu lạ bị bỏ qua. */
function readRequirements(reportData: unknown): Requirement[] {
  if (!reportData || typeof reportData !== "object") return [];
  const raw = (reportData as { requirements?: unknown }).requirements;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<Requirement>;
    if (!item.label || !item.detail || !item.sourceUrl) return [];
    return [{
      id: item.id ?? `req-${String(item.label)}`,
      category: REQUIREMENT_CATEGORIES.includes(item.category as RequirementCategory) ? (item.category as RequirementCategory) : "document",
      label: String(item.label),
      detail: String(item.detail),
      sourceUrl: String(item.sourceUrl),
      kind: item.kind === "pdf" ? "pdf" : "html",
      certainty: "confirmed" as const,
    }];
  });
}

/**
 * Đọc lại danh sách kênh **đầy đủ** đã lưu trong `report_data`.
 *
 * Bảng `company_reports` chỉ có một cột cho mỗi loại kênh (một email, một số
 * điện thoại…), nên nếu chỉ đọc các cột đó thì mọi kênh thừa — cùng câu chữ
 * bằng chứng, cùng nhãn tin cậy, cùng chính sách dùng — biến mất sau khi ghi.
 * Connector tìm được bao nhiêu kênh thì report phải giữ bấy nhiêu.
 */
function readContacts(reportData: unknown): Contact[] {
  if (!reportData || typeof reportData !== "object") return [];
  const raw = (reportData as { contacts?: unknown }).contacts;
  if (!Array.isArray(raw)) return [];
  const allowedTypes = new Set<Contact["type"]>(["website", "email", "phone", "linkedin", "whatsapp"]);
  const allowedCertainty = new Set(["confirmed", "probable", "inferred"]);
  const allowedIdentity = new Set(["person", "department", "company_general", "unknown"]);
  const allowedPolicy = new Set(["outreach_ready", "needs_mailbox_check", "manual_contact_only", "requires_override"]);

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<Contact>;
    if (!item.label || !item.value || !item.type || !allowedTypes.has(item.type)) return [];
    return [{
      label: String(item.label),
      value: String(item.value),
      type: item.type,
      verified: Boolean(item.verified),
      source: String(item.source ?? ""),
      ...(allowedCertainty.has(item.certainty as string) ? { certainty: item.certainty } : {}),
      ...(allowedIdentity.has(item.identityMatch as string) ? { identityMatch: item.identityMatch } : {}),
      ...(allowedPolicy.has(item.policy as string) ? { policy: item.policy } : {}),
      ...(item.via ? { via: String(item.via) } : {}),
      ...(item.sourceUrl ? { sourceUrl: String(item.sourceUrl) } : {}),
      ...(item.personName ? { personName: String(item.personName) } : {}),
      ...(item.personTitle ? { personTitle: String(item.personTitle) } : {}),
    }];
  });
}

/** Người ra quyết định đã lưu trong `report_data` — cùng lý do như `readContacts`. */
function readPeople(reportData: unknown): DecisionMaker[] {
  if (!reportData || typeof reportData !== "object") return [];
  const raw = (reportData as { people?: unknown }).people;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<DecisionMaker>;
    if (!item.name || !item.sourceUrl) return [];
    return [{
      id: String(item.id ?? `person-${item.name}`),
      name: String(item.name),
      title: String(item.title ?? ""),
      department: String(item.department ?? ""),
      identityMatch: "person" as const,
      certainty: "confirmed" as const,
      sourceLabel: String(item.sourceLabel ?? ""),
      sourceUrl: String(item.sourceUrl),
      lastSeenAt: String(item.lastSeenAt ?? ""),
      channels: Array.isArray(item.channels) ? item.channels : [],
    }];
  });
}

function readSignals(reportData: unknown): string[] {
  if (!reportData || typeof reportData !== "object") return [];
  const signals = (reportData as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) return [];
  return signals.filter((signal): signal is string => typeof signal === "string").slice(0, 6);
}

export function toCompanyReportView(options: {
  report: CompanyReportRow;
  evidence: SourceEvidenceRow[];
  locale: AppLocale;
}): CompanyReport {
  const { report, evidence, locale } = options;
  const label = (key: string) => FIELD_LABELS[key][locale];
  const evidenceByField = new Map(evidence.filter((row) => row.field_name).map((row) => [row.field_name as string, row]));

  const channels: Array<[keyof typeof FIELD_LABELS, string | null]> = [
    ["official_website", report.official_website],
    ["linkedin_url", report.linkedin_url],
    ["public_business_email", report.public_business_email],
    ["public_business_phone", report.public_business_phone],
    ["whatsapp_business_url", report.whatsapp_business_url],
  ];

  const contacts: Contact[] = channels
    .filter(([, value]) => Boolean(value))
    .map(([field, value]) => {
      const match = evidenceByField.get(field);
      return {
        label: label(field),
        value: String(value).replace(/^https?:\/\//, ""),
        type: CONTACT_TYPES[field],
        verified: Boolean(match?.is_verified),
        source: match?.source_label ?? (locale === "vi" ? "Chưa có evidence" : "No evidence yet"),
      };
    });

  // Một dòng cho mỗi nguồn. Bảng `source_evidence` có một dòng cho **mỗi trường**
  // lấy từ cùng một trang, nên nếu không gộp thì danh sách nguồn lặp cùng một URL
  // ba bốn lần — trông như đã kiểm nhiều nơi hơn thực tế.
  const sourceByUrl = new Map<string, Source>();
  for (const row of evidence) {
    if (!SOURCE_KINDS.includes(row.kind as Source["kind"])) continue;
    const url = row.source_url;
    if (!url) continue;
    const existing = sourceByUrl.get(url);
    if (existing) {
      // Dòng có gắn trường (bằng chứng cho một giá trị) nói được nhiều hơn dòng
      // chỉ ghi "đã đọc", nên nó thắng khi cả hai cùng trỏ một URL.
      if (row.field_name && !existing.verified) existing.verified = row.is_verified;
      continue;
    }
    sourceByUrl.set(url, {
      label: row.source_label,
      url,
      kind: row.kind as Source["kind"],
      verified: row.is_verified,
    });
  }
  const sources: Source[] = [...sourceByUrl.values()];

  const signals = readSignals(report.report_data);

  // Nguồn gốc nội dung, đọc từ chính dòng dữ liệu: provider mẫu ⇒ report mẫu.
  // Report do provider thật tạo sau này sẽ không mang nhãn này.
  const providerValue = (report.report_data as { provider?: unknown } | null | undefined)?.provider;
  const sampleData = typeof providerValue === "string" && providerValue.toLowerCase().startsWith("demo");

  return {
    id: report.id,
    companyName: report.company_name,
    initials: initialsFor(report.company_name),
    accent: accentFor(report.company_name),
    country: report.country || (locale === "vi" ? "Chưa xác định" : "Unknown"),
    status: researchStatus(report),
    confidence: report.confidence,
    ...(sampleData ? { sampleData: true } : {}),
    createdAt: formatMoment(report.captured_at, locale),
    expiresAt: formatDate(report.expires_at, locale),
    daysLeft: daysLeft(report.expires_at),
    industry: report.industry || (locale === "vi" ? "Chưa phân loại" : "Unsorted"),
    description:
      report.description ||
      (locale === "vi"
        ? "Report này chưa có mô tả từ nguồn công khai."
        : "This report has no description from a public source yet."),
    website: report.official_website?.replace(/^https?:\/\//, "") ?? undefined,
    lastUpdated: formatMoment(report.captured_at, locale),
    // Danh sách đầy đủ trong `report_data` thắng các cột đơn lẻ — nhưng chỉ khi
    // thật sự có, để report cũ (và report mẫu) giữ nguyên hành vi.
    contacts: readContacts(report.report_data).length > 0 ? readContacts(report.report_data) : contacts,
    requirements: readRequirements(report.report_data),
    sources,
    signals: signals.length > 0 ? signals : [locale === "vi" ? "Có evidence nguồn" : "Source evidence attached"],
    ...(readPeople(report.report_data).length > 0 ? { people: readPeople(report.report_data) } : {}),
  };
}
