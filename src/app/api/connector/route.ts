import { NextResponse } from "next/server";

import { runConnector } from "@/lib/connector";
import { normalizeSeed } from "@/lib/connector/discover";
import { channelsToContacts, resultToNotes, resultToPeople } from "@/lib/connector/to-report";
import type { TargetFamily } from "@/lib/connector/types";

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

export async function POST(request: Request) {
  let payload: { domain?: unknown; targets?: unknown; maxPages?: unknown };
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
    const result = await runConnector(seed, { maxPages, delayMs: 250, targets });

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

    return NextResponse.json({
      domain: result.domain,
      seedUrl: result.seedUrl,
      channels: channelsToContacts(result),
      people: resultToPeople(result),
      notes: resultToNotes(result),
      pages: result.pages,
      raw: { channels: result.channels, notes: result.notes },
      persisted: false,
      note: "Kết quả chưa được lưu vào database: tầng ghi buyer_profiles / contact_channels / decision_makers / buyer_routes chưa được viết (schema 002–006 đã sẵn sàng).",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không rõ nguyên nhân";
    return NextResponse.json({ error: `Connector dừng: ${message}` }, { status: 500 });
  }
}
