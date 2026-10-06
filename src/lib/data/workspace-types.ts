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

/** How many credits one Company Report costs. Mirrors the retention default. */
export const REPORT_COST = 5;

export const DEMO_CREDITS = 128;

export const emptyWorkspace: WorkspaceSnapshot = {
  state: "demo",
  account: null,
  reports: [],
};
