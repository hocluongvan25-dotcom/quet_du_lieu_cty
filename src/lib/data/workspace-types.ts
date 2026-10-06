import type { CompanyReport } from "@/lib/demo-data";

/**
 * Serialisable workspace snapshot shared between server components and client
 * components. Types only — safe to import from either environment.
 */

export type WorkspaceState =
  /** No Supabase project configured, or nobody is signed in. */
  | "demo"
  /** Signed in with a workspace: real credits, real reports. */
  | "live"
  /** Signed in, but the workspace has not been created yet. */
  | "onboarding"
  /** Supabase is configured but unreachable (offline preview, outage). */
  | "unavailable";

export type WorkspaceAccount = {
  userId: string;
  email: string | null;
  displayName: string;
  initials: string;
  organizationId: string;
  organizationName: string;
  plan: string;
  credits: number;
  retentionDays: number;
  role: string;
};

export type WorkspaceSnapshot = {
  state: WorkspaceState;
  account: WorkspaceAccount | null;
  reports: CompanyReport[];
};

export type WorkspaceMember = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  initials: string;
  joinedLabel: string;
  reportsCreated: number;
  isSelf: boolean;
};

export type ReportChangeKind = "added" | "removed" | "changed";

export type ReportChange = {
  id: string;
  companyName: string;
  fieldName: string;
  fieldLabel: string;
  kind: ReportChangeKind;
  previousValue: string | null;
  newValue: string | null;
  detectedAt: string;
  detectedLabel: string;
  reportId: string | null;
};

/** How many credits one Company Report costs. Mirrors the retention default. */
export const REPORT_COST = 5;

export const DEMO_CREDITS = 128;

export const emptyWorkspace: WorkspaceSnapshot = {
  state: "demo",
  account: null,
  reports: [],
};
