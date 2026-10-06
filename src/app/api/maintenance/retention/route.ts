import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retention sweep for expired raw artifacts and evidence.
 *
 * Order matters: the Storage object is deleted first, the database rows
 * second. Rows whose object could not be removed are kept so the next run can
 * retry, which means a transient Storage failure never orphans evidence.
 *
 * Callers must present the shared secret:
 *   Authorization: Bearer $CRON_SECRET     (or)     x-cron-secret: $CRON_SECRET
 *
 * Schedule it with `supabase/migrations/004_retention_cron.sql` (pg_cron +
 * pg_net) or run `npm run retention:run` from a machine that can reach the app.
 */

const ARTIFACT_BUCKET = "research-artifacts";
const DEFAULT_LIMIT = 500;

function isAuthorized(request: Request, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const direct = request.headers.get("x-cron-secret") ?? "";
  return bearer === secret || direct === secret;
}

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
    return NextResponse.json(
      { ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY ở server." },
      { status: 501 },
    );
  }

  const limit = (() => {
    const raw = new URL(request.url).searchParams.get("limit");
    const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : DEFAULT_LIMIT;
  })();

  const startedAt = new Date().toISOString();

  try {
    const { data: candidates, error: listError } = await supabase.rpc("retention_artifact_paths", {
      p_limit: limit,
    });
    if (listError) throw new Error(listError.message);

    const paths = ((candidates ?? []) as Array<{ evidence_id: string; storage_path: string }>)
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path));
    const uniquePaths = [...new Set(paths)];

    let removed: string[] = [];
    let storageError: string | null = null;

    if (uniquePaths.length > 0) {
      const { data: deleted, error } = await supabase.storage.from(ARTIFACT_BUCKET).remove(uniquePaths);
      if (error) storageError = error.message;
      // Objects that already disappeared still count as removed.
      removed = (deleted ?? []).map((item) => item.name);
      // A "not found" error means the objects are already gone, so the rows may
      // still be cleaned up in this run.
      if (storageError && /not found/i.test(storageError)) {
        removed = uniquePaths;
      }
    }

    const { data: purged, error: purgeError } = await supabase.rpc("purge_expired_retention", {
      p_removed_paths: removed,
    });
    if (purgeError) throw new Error(purgeError.message);

    // PostgREST returns a table function as an array; tolerate a single object.
    const purgeRows = Array.isArray(purged)
      ? (purged as Array<{ deleted_evidence: number; deleted_reports: number }>)
      : purged
        ? [purged as { deleted_evidence: number; deleted_reports: number }]
        : [];
    const result = purgeRows[0] ?? { deleted_evidence: 0, deleted_reports: 0 };

    return NextResponse.json({
      ok: true,
      bucket: ARTIFACT_BUCKET,
      startedAt,
      finishedAt: new Date().toISOString(),
      artifactsFound: uniquePaths.length,
      artifactsRemoved: removed.length,
      deletedEvidence: result.deleted_evidence,
      deletedReports: result.deleted_reports,
      // Rows intentionally kept for the next attempt.
      deferred: uniquePaths.length - removed.length,
      storageError,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const cause = (error as { cause?: { code?: string } })?.cause?.code;
    const unreachable = /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(raw);

    return NextResponse.json(
      {
        ok: false,
        error: unreachable
          ? `Không kết nối được Supabase để chạy retention sweep (${cause ?? raw}). Hãy chạy lại từ môi trường truy cập được project.`
          : raw,
        startedAt,
      },
      { status: 500 },
    );
  }
}

/** Convenience for schedulers that probe with GET; same auth rules apply. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET chưa được đặt." }, { status: 501 });
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    message: "Retention endpoint sẵn sàng. Dùng POST để chạy sweep.",
    bucket: ARTIFACT_BUCKET,
  });
}
