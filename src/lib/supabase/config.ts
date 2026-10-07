/**
 * Supabase configuration shared by the browser, the server and middleware.
 * Kept free of `next/headers` so it can be imported from anywhere.
 */

export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

export type SupabaseAdminConfig = SupabasePublicConfig & {
  serviceRoleKey: string;
};

function cleanUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : "";
}

function cleanKey(value?: string) {
  return value?.trim() ?? "";
}

/** Browser-safe configuration (project URL + anon key). */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = cleanUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = cleanKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !anonKey) return null;

  return { url, anonKey };
}

/**
 * Server-only configuration including the service role key.
 * Never import this from a client component: the key bypasses RLS.
 */
export function getSupabaseAdminConfig(): SupabaseAdminConfig | null {
  const publicConfig = getSupabasePublicConfig();
  const serviceRoleKey = cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!publicConfig || !serviceRoleKey) return null;

  return { ...publicConfig, serviceRoleKey };
}

/** `https://abcdefgh.supabase.co` -> `abcdefgh`. Null for custom domains. */
export function projectRefFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : null;
  } catch {
    return null;
  }
}

export const isSupabaseConfigured = Boolean(getSupabasePublicConfig());
