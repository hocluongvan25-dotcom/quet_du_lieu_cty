import { NextResponse } from "next/server";
import { createDemoReport } from "@/lib/demo-data";

export const runtime = "nodejs";

type ResearchPayload = {
  companyName?: unknown;
  sourceUrl?: unknown;
  country?: unknown;
};

function asText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeUrl(value: string) {
  if (!value) return "";
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";

    // The actual crawler must also block private IPs and cloud metadata ranges.
    // This endpoint only validates a user-facing seed URL.
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname)) return "";

    return url.toString();
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  let body: ResearchPayload;

  try {
    body = (await request.json()) as ResearchPayload;
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }

  const companyName = asText(body.companyName, 140);
  const sourceUrl = normalizeUrl(asText(body.sourceUrl, 500));
  const country = asText(body.country, 80);

  if (!companyName && !sourceUrl) {
    return NextResponse.json(
      { error: "Hãy nhập tên công ty hoặc dán một link tham chiếu." },
      { status: 400 },
    );
  }

  // This is a safe demo provider. In production, replace it with a queued
  // orchestration job: URL validation -> permitted source connectors ->
  // extraction -> entity resolution -> source evidence -> Supabase persistence.
  const report = createDemoReport({ companyName, sourceUrl, country });

  return NextResponse.json({
    report,
    mode: "demo",
    creditsCharged: 5,
  });
}
