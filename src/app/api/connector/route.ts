import { NextResponse } from "next/server";

import { runConnector } from "@/lib/connector";
import { normalizeSeed } from "@/lib/connector/discover";
import { buildBuyerWriteBatch, saveBuyerDiscovery, supabaseBuyerStore } from "@/lib/connector/persist";
import { channelsToContacts, resultToNotes, resultToPeople } from "@/lib/connector/to-report";
import type { TargetFamily } from "@/lib/connector/types";
import { fetchWorkspaceAccount } from "@/lib/data/workspace";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TARGETS: TargetFamily[] = ["email", "phone", "whatsapp", "linkedin", "form"];
const MAX_PAGES = 6;

/**
 * Giới hạn tần suất tạm thời trong bộ nhớ tiến trình. Chỉ có tác dụng chống lạm
 * dụng lặt vặt; khi có Supabase sẽ chuyển sang đếm theo credit như /api/research.
 */
const recentRuns = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_RUNS_PER_WINDOW = 3;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const runs = (recentRuns.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  runs.push(now);
  recentRuns.set(key, runs);
  return runs.length > MAX_RUNS_PER_WINDOW;
}

/**
 * Ghi kết quả vào workspace của người đang đăng nhập.
 *
 * Chỉ ghi khi có ba thứ: phiên đăng nhập, workspace, và `country` (cột bắt
 * buộc trong database — connector không suy quốc gia từ đuôi tên miền). Thiếu
 * thứ nào thì trả về lý do cụ thể, không im lặng.
 *
 * Ghi bằng service role vì `insert/update` trên các bảng buyer đã bị thu hồi
 * khỏi `authenticated` (005/006) — browser không được phép ghi dữ liệu buyer.
 * Vì vậy `organization_id` lấy từ phiên, không bao giờ lấy từ body request.
 */
async function persistRun(domain: string, companyName: string, country: string, result: Awaited<ReturnType<typeof runConnector>>) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { persisted: false as const, reason: "Chưa cấu hình Supabase nên chỉ trả kết quả, không lưu." };

  let organizationId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { persisted: false as const, reason: "Chưa đăng nhập nên không lưu vào workspace nào." };
    const account = await fetchWorkspaceAccount(supabase, data.user);
    organizationId = account?.organizationId ?? null;
  } catch {
    return { persisted: false as const, reason: "Không đọc được phiên đăng nhập nên không lưu." };
  }

  if (!organizationId) {
    return { persisted: false as const, reason: "Tài khoản chưa có workspace nên chưa có chỗ lưu." };
  }

  const batch = buildBuyerWriteBatch(result, { organizationId, domain, companyName, country });
  if (!batch.ok) return { persisted: false as const, reason: batch.reason };

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return {
      persisted: false as const,
      reason: "Thiếu SUPABASE_SERVICE_ROLE_KEY ở server: các bảng buyer chỉ cho service role ghi, và quyền đó cố tình không mở cho trình duyệt.",
    };
  }

  try {
    const saved = await saveBuyerDiscovery(supabaseBuyerStore(admin), batch.batch);
    if (!saved.ok) return { persisted: false as const, reason: saved.reason };
    return {
      persisted: true as const,
      reason: "Đã lưu vào danh sách buyer của workspace này.",
      counts: {
        buyerProfileId: saved.buyerProfileId,
        channels: saved.channels,
        people: saved.people,
        routes: saved.routes,
        candidatesInserted: saved.candidatesInserted,
      },
      skipped: batch.batch.skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "không rõ nguyên nhân";
    return { persisted: false as const, reason: `Không ghi được vào database: ${message}` };
  }
}

export async function POST(request: Request) {
  let payload: { domain?: unknown; companyName?: unknown; country?: unknown; targets?: unknown; maxPages?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body phải là JSON." }, { status: 400 });
  }

  const rawDomain = typeof payload.domain === "string" ? payload.domain.trim().slice(0, 200) : "";
  if (!rawDomain) {
    return NextResponse.json({ error: "Cần tên miền công ty, ví dụ mariani.com" }, { status: 400 });
  }

  const seed = normalizeSeed(rawDomain);
  if (!seed) {
    return NextResponse.json({ error: `Không đọc được tên miền từ "${rawDomain}"` }, { status: 400 });
  }

  const companyName = typeof payload.companyName === "string" ? payload.companyName.trim().slice(0, 200) : "";
  const country = typeof payload.country === "string" ? payload.country.trim().slice(0, 60) : "";

  const targets = Array.isArray(payload.targets)
    ? (payload.targets.filter((item): item is TargetFamily => typeof item === "string" && (ALLOWED_TARGETS as string[]).includes(item)))
    : ALLOWED_TARGETS;
  const requestedPages = typeof payload.maxPages === "number" && Number.isFinite(payload.maxPages) ? Math.floor(payload.maxPages) : 4;
  const maxPages = Math.min(Math.max(requestedPages, 1), MAX_PAGES);

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(forwardedFor)) {
    return NextResponse.json({ error: "Quá nhiều lần tra cứu trong một phút. Thử lại sau." }, { status: 429 });
  }

  try {
    const result = await runConnector(seed, { maxPages, delayMs: 250, targets, country });

    const attempted = result.pages.filter((page) => page.status !== "skipped");
    if (attempted.length > 0 && result.channels.length === 0 && attempted.every((page) => page.status === "error" || page.status === "blocked")) {
      return NextResponse.json(
        {
          error: "Không tải được trang nào của tên miền này. Kiểm tra lại tên miền hoặc thử lại sau.",
          pages: result.pages,
        },
        { status: 502 },
      );
    }

    const storage = await persistRun(result.domain, companyName, country, result);

    return NextResponse.json({
      domain: result.domain,
      seedUrl: result.seedUrl,
      channels: channelsToContacts(result),
      people: resultToPeople(result),
      notes: resultToNotes(result),
      pages: result.pages,
      raw: { channels: result.channels, notes: result.notes },
      persisted: storage.persisted,
      persist: storage,
      note: storage.reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không rõ nguyên nhân";
    return NextResponse.json({ error: `Connector dừng: ${message}` }, { status: 500 });
  }
}
