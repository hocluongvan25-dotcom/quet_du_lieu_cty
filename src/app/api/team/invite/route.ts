import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchWorkspaceAccount } from "@/lib/data/workspace";

export const runtime = "nodejs";

/**
 * Invites a teammate into the caller's workspace.
 *
 * Authorization happens on the caller's own session (owner/admin), the write
 * itself uses the service role because `auth.admin.*` is privileged. The role
 * is restricted here and can never be escalated to owner.
 */

type InvitePayload = { email?: unknown; role?: unknown };

const ALLOWED_ROLES = ["admin", "member", "viewer"];

export async function POST(request: Request) {
  let body: InvitePayload;
  try {
    body = (await request.json()) as InvitePayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200).toLowerCase() : "";
  const role = typeof body.role === "string" && ALLOWED_ROLES.includes(body.role) ? body.role : "member";

  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return NextResponse.json({ ok: false, error: "Hãy nhập một địa chỉ email hợp lệ." }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase chưa được cấu hình." }, { status: 501 });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập." }, { status: 401 });
  }

  let account;
  try {
    account = await fetchWorkspaceAccount(supabase, authData.user);
  } catch {
    return NextResponse.json({ ok: false, error: "Không đọc được workspace." }, { status: 503 });
  }

  if (!account) {
    return NextResponse.json({ ok: false, error: "Tài khoản chưa có workspace." }, { status: 409 });
  }

  if (account.role !== "owner" && account.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Chỉ Owner hoặc Admin mới mời được thành viên." },
      { status: 403 },
    );
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY ở server nên không thể mời thành viên." },
      { status: 501 },
    );
  }

  const redirectTo = new URL("/auth/callback", request.url).toString();
  let invitedUserId: string | null = null;
  let emailSent = false;
  let emailError: string | null = null;

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (inviteError) {
    // The person may already have an account: fall back to a lookup so the
    // membership can still be granted instead of failing the whole request.
    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = existing?.users?.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;

    if (!match) {
      return NextResponse.json(
        { ok: false, error: `Không mời được: ${inviteError.message}` },
        { status: 400 },
      );
    }
    invitedUserId = match.id;
    emailError = inviteError.message;
  } else {
    invitedUserId = invited.user?.id ?? null;
    emailSent = true;
  }

  if (!invitedUserId) {
    return NextResponse.json({ ok: false, error: "Supabase không trả về người dùng đã mời." }, { status: 400 });
  }

  // Upsert so re-inviting someone only refreshes their role.
  const { error: membershipError } = await admin
    .from("organization_members")
    .upsert(
      { organization_id: account.organizationId, user_id: invitedUserId, role },
      { onConflict: "organization_id,user_id" },
    );

  if (membershipError) {
    return NextResponse.json({ ok: false, error: membershipError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    emailSent,
    emailError,
    role,
    userId: invitedUserId,
  });
}
