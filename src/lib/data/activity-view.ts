import type { AppLocale } from "@/lib/i18n";
import { formatDate, formatMoment } from "./report-view";
import type { ReportChange, ReportChangeKind, WorkspaceMember } from "./workspace-types";

/**
 * Maps change-monitoring and membership rows onto the shapes the Team and
 * Change history pages render. Pure functions, no network access.
 */

export type ReportChangeRow = {
  id: string;
  company_report_id: string | null;
  company_name: string;
  field_name: string;
  change_kind: string;
  previous_value: string | null;
  new_value: string | null;
  detected_at: string;
};

export type WorkspaceMemberRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  joined_at: string | null;
  reports_created: number | string | null;
};

const FIELD_LABELS: Record<string, { vi: string; en: string }> = {
  official_website: { vi: "Website chính thức", en: "Official website" },
  linkedin_url: { vi: "LinkedIn công ty", en: "Company LinkedIn" },
  public_business_email: { vi: "Email kinh doanh", en: "Business email" },
  public_business_phone: { vi: "Điện thoại văn phòng", en: "Office phone" },
  whatsapp_business_url: { vi: "WhatsApp doanh nghiệp", en: "Business WhatsApp" },
  country: { vi: "Quốc gia", en: "Country" },
  city: { vi: "Thành phố", en: "City" },
  industry: { vi: "Ngành", en: "Industry" },
  confidence: { vi: "Độ tin cậy", en: "Confidence" },
};

const ROLE_LABELS: Record<string, { vi: string; en: string }> = {
  owner: { vi: "Chủ sở hữu", en: "Owner" },
  admin: { vi: "Quản trị", en: "Admin" },
  member: { vi: "Thành viên", en: "Member" },
  viewer: { vi: "Chỉ xem", en: "Viewer" },
};

export const CHANGE_KINDS: ReportChangeKind[] = ["added", "removed", "changed"];

/** Values coming from evidence or the provider can be long URLs or emails. */
function displayValue(value: string | null) {
  if (value === null || value === "") return null;
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

function asCount(value: number | string | null) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(parsed) ? Number(parsed) : 0;
}

export function fieldLabel(fieldName: string, locale: AppLocale) {
  return FIELD_LABELS[fieldName]?.[locale] ?? fieldName.replace(/_/g, " ");
}

export function roleLabel(role: string | null, locale: AppLocale) {
  const key = (role ?? "member").toLowerCase();
  return ROLE_LABELS[key]?.[locale] ?? key;
}

export function toReportChange(row: ReportChangeRow, locale: AppLocale): ReportChange {
  const kind = (CHANGE_KINDS as string[]).includes(row.change_kind)
    ? (row.change_kind as ReportChangeKind)
    : "changed";

  return {
    id: row.id,
    companyName: row.company_name,
    fieldName: row.field_name,
    fieldLabel: fieldLabel(row.field_name, locale),
    kind,
    previousValue: displayValue(row.previous_value),
    newValue: displayValue(row.new_value),
    detectedAt: row.detected_at,
    detectedLabel: formatMoment(row.detected_at, locale),
    reportId: row.company_report_id,
  };
}

export function toWorkspaceMember(
  row: WorkspaceMemberRow,
  locale: AppLocale,
  selfId: string | null,
): WorkspaceMember {
  const name = row.full_name?.trim() || row.email?.split("@")[0] || (locale === "vi" ? "Thành viên" : "Member");
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return {
    userId: row.user_id,
    name,
    email: row.email,
    role: (row.role ?? "member").toLowerCase(),
    initials: initials || "MB",
    joinedLabel: row.joined_at ? formatDate(row.joined_at, locale) : "-",
    reportsCreated: asCount(row.reports_created),
    isSelf: selfId !== null && row.user_id === selfId,
  };
}

/** Groups the diffs that one research run produced into a single timeline entry. */
export function groupChanges(changes: ReportChange[]) {
  const groups = new Map<string, { key: string; companyName: string; detectedLabel: string; detectedAt: string; changes: ReportChange[] }>();

  for (const change of changes) {
    const key = `${change.companyName}::${change.detectedAt}`;
    const existing = groups.get(key);
    if (existing) {
      existing.changes.push(change);
      continue;
    }
    groups.set(key, {
      key,
      companyName: change.companyName,
      detectedLabel: change.detectedLabel,
      detectedAt: change.detectedAt,
      changes: [change],
    });
  }

  return [...groups.values()];
}

/** One short sentence per change, used as the timeline summary. */
export function describeChange(change: ReportChange, locale: AppLocale) {
  const label = change.fieldLabel;
  if (change.kind === "added") {
    return locale === "vi"
      ? `Phát hiện ${label}: ${change.newValue}`
      : `Detected ${label}: ${change.newValue}`;
  }
  if (change.kind === "removed") {
    return locale === "vi"
      ? `${label} không còn trong snapshot mới (trước đó: ${change.previousValue})`
      : `${label} is gone from the new snapshot (was: ${change.previousValue})`;
  }
  return locale === "vi"
    ? `${label}: ${change.previousValue} → ${change.newValue}`
    : `${label}: ${change.previousValue} → ${change.newValue}`;
}
