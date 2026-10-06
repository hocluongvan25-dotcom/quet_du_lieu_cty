import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig, projectRefFromUrl } from "@/lib/supabase/config";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Refreshes the Supabase session cookies on navigation.
 *
 * Anonymous visitors are passed straight through: no network call is made
 * unless an auth cookie for this project already exists, so demo mode and
 * preview environments never pay for an unreachable project.
 */
export async function proxy(request: NextRequest) {
  const config = getSupabasePublicConfig();
  if (!config) return NextResponse.next({ request });

  const projectRef = projectRefFromUrl(config.url);
  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => (projectRef ? cookie.name.startsWith(`sb-${projectRef}-auth-token`) : cookie.name.startsWith("sb-")));

  if (!hasSessionCookie) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // An unreachable project must not break navigation; pages fall back to
    // demo mode and show the offline notice.
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
