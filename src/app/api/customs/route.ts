import { NextResponse } from "next/server";

import { supabaseCustomsStore, type CustomsLinkInput } from "@/lib/customs/persist";
import type { CustomsMatchMethod, CustomsMatchStatus } from "@/lib/customs/types";
import { fetchWorkspaceAccount } from "@/lib/data/workspace";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Quyết định của người dùng trên hàng đợi hải quan: nối một bên nhận hàng với
 * hồ sơ khách hàng, đánh dấu "chờ xem"/"chưa có ứng viên", hoặc tạo hồ sơ mới.
 *
 * Ba điều cố ý:
 *
 *  - `organization_id` **không** lấy từ request. Bên được thao tác phải đọc được
 *    bằng phiên của người dùng (RLS theo workspace) — không đọc được nghĩa là
 *    không thuộc workspace này, và bị từ chối trước khi gọi hàm ghi.
 *  - Lệnh ghi chạy bằng service role vì bốn hàm của 012 chỉ cấp cho service_role,
 *    đúng như production (browser không được ghi thẳng vào bảng buyer).
 *  - Bên gửi hàng không đi qua đây: DB từ chối, và lớp này không cố lách.
 */

const METHODS: CustomsMatchMethod[] = ["exact_domain", "exact_name_country", "exact_name", "fuzzy_name", "created_from_customs", "manual"];

type Body = {
  action?: string;
  partyId?: string;
  buyerProfileId?: string;
  method?: string;
  confidence?: number;
  reasons?: string[];
  status?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body không phải JSON." }, { status: 400 });
  }

  const partyId = (body.partyId ?? "").trim();
  if (!partyId) return NextResponse.json({ ok: false, error: "Thiếu bên cần xử lý." }, { status: 400 });

  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Chưa cấu hình Supabase." }, { status: 503 });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return NextResponse.json({ ok: false, error: "Chưa đăng nhập." }, { status: 401 });
  const account = await fetchWorkspaceAccount(supabase, userData.user);
  if (!account) return NextResponse.json({ ok: false, error: "Tài khoản chưa có workspace." }, { status: 403 });

  // RLS quyết định: đọc được bên này bằng phiên người dùng tức là cùng workspace.
  const { data: party, error: partyError } = await supabase
    .from("customs_record_parties")
    .select("id, organization_id, role, name_as_printed")
    .eq("id", partyId)
    .maybeSingle();
  if (partyError) return NextResponse.json({ ok: false, error: partyError.message }, { status: 400 });
  if (!party) return NextResponse.json({ ok: false, error: "Không tìm thấy bên này trong workspace của bạn." }, { status: 404 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Chưa cấu hình service role để ghi." }, { status: 503 });

  const store = supabaseCustomsStore(admin);
  const decidedBy = userData.user.email ?? account.organizationId;

  try {
    if (body.action === "link") {
      const buyerProfileId = (body.buyerProfileId ?? "").trim();
      if (!buyerProfileId) return NextResponse.json({ ok: false, error: "Chưa chọn hồ sơ khách hàng để nối." }, { status: 400 });

      const method = body.method && METHODS.includes(body.method as CustomsMatchMethod) ? (body.method as CustomsMatchMethod) : "manual";
      const confidence = clampConfidence(body.confidence ?? (method === "manual" ? 60 : 70));

      const input: CustomsLinkInput = {
        partyId,
        buyerProfileId,
        method,
        confidence,
        reasons: cleanReasons(body.reasons),
        decidedBy,
      };
      const match = await store.link(input);
      return NextResponse.json({ ok: true, match });
    }

    if (body.action === "mark") {
      const status = body.status === "unmatched" ? "unmatched" : "review";
      const match = await store.mark({
        partyId,
        status: status as Extract<CustomsMatchStatus, "review" | "unmatched">,
        method: body.method && METHODS.includes(body.method as CustomsMatchMethod) ? (body.method as CustomsMatchMethod) : null,
        confidence: body.confidence === undefined ? null : clampConfidence(body.confidence),
        reasons: cleanReasons(body.reasons),
        decidedBy,
      });
      return NextResponse.json({ ok: true, match });
    }

    if (body.action === "create_buyer") {
      const match = await store.createBuyer({ partyId, decidedBy });
      return NextResponse.json({ ok: true, match });
    }

    return NextResponse.json({ ok: false, error: "Hành động không hợp lệ." }, { status: 400 });
  } catch (error) {
    // Thông báo của DB là câu người dùng cần đọc (vai gửi hàng, thiếu quốc gia,
    // hồ sơ khác workspace) — giữ nguyên, không bọc lại thành câu chung chung.
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanReasons(reasons?: string[]): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons.map((reason) => String(reason).trim()).filter(Boolean).slice(0, 8);
}
