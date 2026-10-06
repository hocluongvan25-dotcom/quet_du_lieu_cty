"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

let cachedClient: SupabaseClient | null = null;

/**
 * Browser-safe Supabase client (cookie-based session shared with the server).
 *
 * Returns `null` when the project is not configured, so the dashboard keeps
 * working in demo mode before a Supabase project is connected.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  cachedClient ??= createBrowserClient(config.url, config.anonKey);
  return cachedClient;
}

export const isSupabaseConfigured = Boolean(getSupabasePublicConfig());
