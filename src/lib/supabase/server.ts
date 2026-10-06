import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

/**
 * Server-side Supabase client bound to the visitor's session cookies.
 *
 * Every query runs as the signed-in user, so Row Level Security stays the
 * authorization boundary. Returns `null` when the project is not configured.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called during a Server Component render, where cookies are
          // read-only. Middleware refreshes the session instead.
        }
      },
    },
  });
}
