import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig } from "./config";

/**
 * Privileged server-only client. It bypasses Row Level Security, so it must
 * only be used by trusted server code (queued jobs, retention cleanup,
 * scheduled Edge Functions) and never inside a request path that trusts
 * browser input.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const config = getSupabaseAdminConfig();
  if (!config) return null;

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
