import { NextResponse } from "next/server";

import { reverifyChannels, summarizeReverification, toReverificationRecord, type ChannelForReverification } from "@/lib/connector/reverify";
import type { FoundChannel } from "@/lib/connector/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Lượt đọc lại định kỳ (cổng Freshness, migration 010).
 *
 * Mở lại đúng trang đã thấy giá trị, và trả lời một câu: còn hay không còn.
 * Không mở được trang thì **không kết luận** — xem `src/lib/connector/reverify.ts`.
 *
 *   POST /api/maintenance/reverify
 *   body: { "days": 90, "limit": 200 }        (days mặc định 90, limit mặc định 200)
 *
 * Cần `CRON_SECRET` như lượt dọn hạn mức: cùng một bí mật dùng chung cho
 * `scripts/run-reverify.mjs` và lịch chạy tự động.
 */

const DEFAULT_DAYS = 90;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
const DELAY_MS = 300;

function isAuthorized(request: Request, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const direct = request.headers.get("x-cron-secret") ?? "";
  return bearer === secret || direct === secret;
}

/** Kiểu dữ liệu thô của `contact_reverify_queue` (view trong migration 010). */
type QueueRow = {
  channel_id: string;
  channel_type: string;
  value: string;
  source_url: string | null;
  expected_evidence: string | null;
  days_since_seen: number | null;
};

/** Loại kênh trong DB → loại kênh connector hiểu. */
const CONNECTOR_TYPE: Record<string, FoundChannel["type"] | undefined> = {
  email: "email",
  phone: "phone",
  linkedin_url: "linkedin",
  whatsapp: "whatsapp",
  form: "form",
};

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET chưa được đặt. Thêm CRON_SECRET vào .env.local rồi gọi lại endpoint này kèm header Authorization: Bearer <secret>.",
      },
      { status: 501 },
    );
  }

  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY ở server." }, { status: 501 });
  }

  let payload: { days?: unknown; limit?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    // Không có body cũng chạy: dùng giá trị mặc định.
  }

  const days = typeof payload.days === "number" && Number.isFinite(payload.days) ? Math.min(Math.max(Math.floor(payload.days), 1), 720) : DEFAULT_DAYS;
  const limit =
    typeof payload.limit === "number" && Number.isFinite(payload.limit)
      ? Math.min(Math.max(Math.floor(payload.limit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const startedAt = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("contact_reverify_queue")
      .select("channel_id, channel_type, value, source_url, expected_evidence, days_since_seen")
      .gte("days_since_seen", days)
      .order("days_since_seen", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as unknown as QueueRow[]).filter((row) => row.source_url);
    const channels: ChannelForReverification[] = [];
    for (const row of rows) {
      const channelType = CONNECTOR_TYPE[row.channel_type];
      // Loại kênh không đọc lại được bằng cách mở một trang web (ví dụ cổng nhà
      // cung cấp) thì bỏ qua, và nói rõ đã bỏ qua bao nhiêu.
      if (!channelType || !row.source_url) continue;
      channels.push({
        channelId: row.channel_id,
        channelType,
        value: row.value,
        sourceUrl: row.source_url,
        expectedEvidence: row.expected_evidence ?? null,
      });
    }

    const unchecked = rows.length - channels.length;

    const answers = await reverifyChannels(channels, { delayMs: DELAY_MS, log: () => {} });

    // Ghi từng kết quả qua hàm SQL: hàm quyết định hệ quả, không phải route này.
    let recorded = 0;
    const failures: { channelId: string; error: string }[] = [];
    for (const answer of answers) {
      const { error: recordError } = await supabase.rpc("record_contact_reverification", {
        ...toReverificationRecord(answer),
        p_refresh_days: days,
      });
      if (recordError) {
        failures.push({ channelId: answer.channelId, error: recordError.message });
        continue;
      }
      recorded += 1;
    }

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...summarizeReverification(answers),
      thresholdDays: days,
      queued: rows.length,
      /** Kênh trong hàng đợi mà loại của nó không đọc lại được (ví dụ cổng nhà cung cấp). */
      skipped: unchecked,
      recorded,
      failures,
      // `unreachable` không hạ kênh nào: lần chạy sau sẽ thử lại.
      note: "Kênh không mở được trang thì giữ nguyên trạng thái — không kết luận gì từ một lần lỗi mạng.",
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const unreachable = /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(raw);
    return NextResponse.json(
      { ok: false, error: unreachable ? "Không kết nối được database." : raw },
      { status: unreachable ? 503 : 500 },
    );
  }
}
