import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Email-link landing point for Supabase Auth.
 *
 * Handles both flows the project can send:
 *   - `?code=...`                     PKCE code exchange (default for web)
 *   - `?token_hash=...&type=signup`   email OTP / magic link verification
 *
 * Afterwards the visitor is redirected to a sanitised in-app path.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const requestedNext = url.searchParams.get("next") ?? "/vi";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/vi";
  const locale = next.startsWith("/en") ? "en" : "vi";

  const failure = (reason: string) =>
    NextResponse.redirect(new URL(`/${locale}/login?error=${encodeURIComponent(reason)}`, url.origin));

  const supabase = await getSupabaseServerClient();
  if (!supabase) return failure("not_configured");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email",
      token_hash: tokenHash,
    });
    if (error) return failure(error.message);
  } else {
    return failure("missing_verification_parameters");
  }

  // Give the new session a workspace right away; ignore failures because the
  // dashboard can retry through the onboarding banner.
  try {
    await supabase.rpc("bootstrap_workspace", { p_name: null });
  } catch {
    // no-op
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
