import type { CompanyReport, Contact, ReportStatus, Source } from "@/lib/demo-data";
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

  const sources: Source[] = evidence
    .filter((row) => SOURCE_KINDS.includes(row.kind as Source["kind"]))
    .map((row) => ({
      label: row.source_label,
      url: row.source_url,
      kind: row.kind as Source["kind"],
      verified: row.is_verified,
    }));

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
    contacts,
    requirements: readRequirements(report.report_data),
    sources,
    signals: signals.length > 0 ? signals : [locale === "vi" ? "Có evidence nguồn" : "Source evidence attached"],
  };
}
