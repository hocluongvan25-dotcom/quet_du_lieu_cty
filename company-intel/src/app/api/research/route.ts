import { NextResponse } from "next/server";
import { createDemoReport } from "@/lib/demo-data";
import { assertSandboxSafe, SANDBOX_LIMITS } from "@/lib/url-guard";

export const runtime = "nodejs";

type ResearchPayload = {
  companyName?: unknown;
  sourceUrl?: unknown;
  country?: unknown;
};

function asText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeUrl(value: string, forError = false): string {
  if (!value) return "";
  const raw = value.trim();
  // Convenience: allow bare domain (will be validated after prepend)
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  const check = assertSandboxSafe(candidate);
  if (!check.safe) {
    // If caller wants error details, expose via separate path
    if (forError) {
      // Return a marker that can be unpacked; keep interface simple
      return `__BLOCKED__:${check.reason ?? "Chặn bởi url-guard"}`;
    }
    return "";
  }
  return check.url?.toString() ?? "";
}

export async function POST(request: Request) {
  let body: ResearchPayload;

  try {
    body = (await request.json()) as ResearchPayload;
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }

  const companyName = asText(body.companyName, 140);
  const rawSourceUrl = asText(body.sourceUrl, 500);

  let sourceUrl = "";
  if (rawSourceUrl) {
    const normalized = normalizeUrl(rawSourceUrl, true);
    if (normalized.startsWith("__BLOCKED__:")) {
      const reason = normalized.replace("__BLOCKED__:", "");
      return NextResponse.json(
        { error: `Link tham chiếu không an toàn: ${reason}` },
        { status: 400 },
      );
    }
    sourceUrl = normalized;
  }

  const country = asText(body.country, 80);

  if (!companyName && !sourceUrl) {
    return NextResponse.json(
      { error: "Hãy nhập tên công ty hoặc dán một link tham chiếu." },
      { status: 400 },
    );
  }

  const sandboxWarnings = [
    "Crawler chạy trong sandbox giới hạn thời gian (≤10s) và kích thước (≤5MB).",
    "Chỉ cho phép http/https; chặn localhost, private IP (10/8, 172.16/12, 192.168/16), metadata (169.254.169.254).",
    "Chặn redirect nguy hiểm; tối đa 2 bước redirect; kiểm tra lại target.",
    "Không chuyển cookie / Authorization từ người dùng cho nguồn bên ngoài (credentials: 'omit').",
  ];

  // This is a safe demo provider. In production, replace it with a queued
  // orchestration job: URL validation -> permitted source connectors ->
  // extraction -> entity resolution -> source evidence -> Supabase persistence.
  const report = createDemoReport({ companyName, sourceUrl, country });

  return NextResponse.json({
    report,
    mode: "demo",
    creditsCharged: 5,
    security: {
      urlPassed: !!sourceUrl,
      sandboxLimits: SANDBOX_LIMITS,
      rules: sandboxWarnings,
    },
  });
}
