import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AppLocale } from "@/lib/i18n";
import { toCompanyReportView, type CompanyReportRow, type SourceEvidenceRow } from "./report-view";
import {
  toReportChange,
  toWorkspaceMember,
  type ReportChangeRow,
  type WorkspaceMemberRow,
} from "./activity-view";
import {
  emptyWorkspace,
  type ReportChange,
  type WorkspaceAccount,
  type WorkspaceMember,
  type WorkspaceSnapshot,
} from "./workspace-types";

/**
 * Server-side workspace loader.
 *
 * Reads everything through the visitor's own session, so RLS decides what is
 * visible. A missing configuration or an unreachable project never throws: the
 * dashboard falls back to demo data instead of rendering a broken page.
 */

type MembershipRow = {
  role: string | null;
  organizations: {
    id: string;
    name: string;
    plan: string;
    credits_balance: number;
    default_retention_days: number;
  } | null;
};

const REPORT_COLUMNS = [
  "id",
  "company_name",
  "country",
  "city",
  "industry",
  "description",
  "official_website",
  "linkedin_url",
  "public_business_email",
  "public_business_phone",
  "whatsapp_business_url",
  "confidence",
  "report_data",
  "captured_at",
  "expires_at",
  "research_jobs(status)",
].join(", ");

const EVIDENCE_COLUMNS =
  "company_report_id, kind, source_label, source_url, field_name, evidence_snippet, is_verified";

export function initialsFromName(value: string) {
  const letters = value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return letters || "SE";
}

/**
 * Resolves the signed-in user's workspace. Returns `null` when the user has no
 * membership yet, which means onboarding still has to run.
 */
export async function fetchWorkspaceAccount(
  supabase: SupabaseClient,
  user: User,
): Promise<WorkspaceAccount | null> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, name, plan, credits_balance, default_retention_days)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const membership = data as unknown as MembershipRow | null;
  const organization = membership?.organizations;
  if (!organization) return null;

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.user_metadata?.name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Member";

  return {
    userId: user.id,
    email: user.email ?? null,
    displayName,
    initials: initialsFromName(displayName),
    organizationId: organization.id,
    organizationName: organization.name,
    plan: organization.plan,
    credits: organization.credits_balance,
    retentionDays: organization.default_retention_days,
    role: membership?.role ?? "member",
  };
}

export const loadWorkspace = cache(async (locale: AppLocale): Promise<WorkspaceSnapshot> => {
  if (!getSupabasePublicConfig()) return emptyWorkspace;

  const supabase = await getSupabaseServerClient();
  if (!supabase) return emptyWorkspace;

  let user: User | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // No session cookie is a normal anonymous visit, not an outage.
      const isMissingSession = error.name === "AuthSessionMissingError" || error.status === 400;
      if (!isMissingSession) return { state: "unavailable", account: null, reports: [] };
    }
    user = data.user ?? null;
  } catch {
    return { state: "unavailable", account: null, reports: [] };
  }

  if (!user) return emptyWorkspace;

  try {
    const account = await fetchWorkspaceAccount(supabase, user);
    if (!account) return { state: "onboarding", account: null, reports: [] };

    const { data: reportRows, error: reportError } = await supabase
      .from("company_reports")
      .select(REPORT_COLUMNS)
      .order("captured_at", { ascending: false })
      .limit(50);

    if (reportError) throw new Error(reportError.message);

    const reports = (reportRows ?? []) as unknown as CompanyReportRow[];
    if (reports.length === 0) return { state: "live", account, reports: [] };

    const { data: evidenceRows, error: evidenceError } = await supabase
      .from("source_evidence")
      .select(EVIDENCE_COLUMNS)
      .in(
        "company_report_id",
        reports.map((report) => report.id),
      );

    if (evidenceError) throw new Error(evidenceError.message);

    const evidence = (evidenceRows ?? []) as unknown as SourceEvidenceRow[];

    return {
      state: "live",
      account,
      reports: reports.map((report) =>
        toCompanyReportView({
          report,
          evidence: evidence.filter((row) => row.company_report_id === report.id),
          locale,
        }),
      ),
    };
  } catch {
    return { state: "unavailable", account: null, reports: [] };
  }
});


const CHANGE_COLUMNS =
  "id, company_report_id, company_name, field_name, change_kind, previous_value, new_value, detected_at";

/**
 * Members of the caller's workspace, resolved through a definer function
 * because the email lives in `auth.users`.
 */
export async function fetchWorkspaceMembers(
  supabase: SupabaseClient,
  locale: AppLocale,
  selfId: string | null,
): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase.rpc("workspace_members");
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as WorkspaceMemberRow[]).map((row) =>
    toWorkspaceMember(row, locale, selfId),
  );
}

/** Detected contact/website changes for the caller's workspace, newest first. */
export async function fetchReportChanges(
  supabase: SupabaseClient,
  locale: AppLocale,
  limit = 40,
): Promise<ReportChange[]> {
  const { data, error } = await supabase
    .from("report_changes")
    .select(CHANGE_COLUMNS)
    .order("detected_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as ReportChangeRow[]).map((row) => toReportChange(row, locale));
}

export type ActivityLoad<T> = { available: boolean; data: T };

/** Shared guard: returns demo fallbacks when the project is not reachable. */
async function withWorkspace<T>(
  locale: AppLocale,
  query: (supabase: SupabaseClient, account: WorkspaceAccount) => Promise<T>,
  fallback: T,
): Promise<ActivityLoad<T>> {
  if (!getSupabasePublicConfig()) return { available: false, data: fallback };

  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { available: false, data: fallback };

    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") return { available: false, data: fallback };

    const user = data.user;
    if (!user) return { available: false, data: fallback };

    const account = await fetchWorkspaceAccount(supabase, user);
    if (!account) return { available: false, data: fallback };

    return { available: true, data: await query(supabase, account) };
  } catch {
    return { available: false, data: fallback };
  }
}

export function loadWorkspaceMembers(locale: AppLocale) {
  return withWorkspace<WorkspaceMember[]>(
    locale,
    async (supabase, account) => {
      const { data } = await supabase.auth.getUser();
      return fetchWorkspaceMembers(supabase, locale, data.user?.id ?? account.userId);
    },
    [],
  );
}

export function loadReportChanges(locale: AppLocale) {
  return withWorkspace<ReportChange[]>(locale, (supabase) => fetchReportChanges(supabase, locale), []);
}
