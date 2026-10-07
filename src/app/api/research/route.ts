import { NextResponse } from "next/server";
import { createDemoReport, type CompanyReport } from "@/lib/demo-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchWorkspaceAccount } from "@/lib/data/workspace";
import { toCompanyReportView, type CompanyReportRow, type SourceEvidenceRow } from "@/lib/data/report-view";
import { REPORT_COST } from "@/lib/data/workspace-types";
import { RESEARCH_PROVIDER, researchCreditCost } from "@/lib/data/research-provider";
import { normalizeLocale } from "@/lib/i18n";

export const runtime = "nodejs";

type ResearchPayload = {
  companyName?: unknown;
  sourceUrl?: unknown;
  country?: unknown;
  locale?: unknown;
};

type EvidenceInput = {
  kind: string;
  source_label: string;
  source_url: string;
  field_name?: string;
  evidence_snippet?: string;
  is_verified: boolean;
};

const FIELD_BY_CONTACT: Record<string, string> = {
  website: "official_website",
  email: "public_business_email",
  phone: "public_business_phone",
  linkedin: "linkedin_url",
  whatsapp: "whatsapp_business_url",
};

function asText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function withProtocol(value?: string) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
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

/** Turns the provider output into the rows `complete_research_job` expects. */
function toPersistencePayload(report: CompanyReport) {
  const contactByType = new Map(report.contacts.map((contact) => [contact.type, contact]));
  const website = withProtocol(report.website);
  const fallbackSourceUrl = website ?? report.sources[0]?.url ?? null;

  const reportRow = {
    company_name: report.companyName,
    country: report.country,
    industry: report.industry,
    description: report.description,
    official_website: website,
    linkedin_url: contactByType.get("linkedin")?.value ? withProtocol(contactByType.get("linkedin")?.value) : null,
    public_business_email: contactByType.get("email")?.value ?? null,
    public_business_phone: contactByType.get("phone")?.value ?? null,
    whatsapp_business_url: contactByType.get("whatsapp")?.value ?? null,
    confidence: report.confidence,
    report_data: { signals: report.signals, requirements: report.requirements ?? [], provider: "demo" },
    provider_trace: { provider: "demo-provider", captured_by: "seekora-app" },
  };

  const evidence: EvidenceInput[] = report.sources
    .filter((source) => Boolean(source.url))
    .map((source) => ({
      kind: source.kind,
      source_label: source.label,
      source_url: source.url,
      is_verified: Boolean(source.verified),
    }));

  for (const contact of report.contacts) {
    const field = FIELD_BY_CONTACT[contact.type];
    if (!field || !contact.verified) continue;
    if (!fallbackSourceUrl) continue;
    evidence.push({
      kind: "website",
      source_label: contact.source,
      source_url: fallbackSourceUrl,
      field_name: field,
      is_verified: true,
    });
  }

  return { reportRow, evidence };
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
  const locale = normalizeLocale(typeof body.locale === "string" ? body.locale : undefined);

  if (!companyName && !sourceUrl) {
    return NextResponse.json(
      { error: "Hãy nhập tên công ty hoặc dán một link tham chiếu." },
      { status: 400 },
    );
  }

  // Provider hiện tại là **provider mẫu**: nội dung là báo cáo minh hoạ, không
  // phải kết quả đọc nguồn công khai. Vì vậy report mang `sampleData: true`,
  // KHÔNG trừ credits (`researchCreditCost`), và phản hồi nói rõ
  // `dataSource: "demo"` — "đã lưu vào Supabase" không có nghĩa "dữ liệu thật".
  // Khi nối provider thật: thay lời gọi này bằng job xếp hàng đợi
  // (validate URL → connector nguồn được phép → trích xuất → đối chiếu pháp nhân
  // → bằng chứng), rồi đổi RESEARCH_PROVIDER trong src/lib/data/research-provider.ts.
  const report = createDemoReport({ companyName, sourceUrl, country });

  const supabase = await getSupabaseServerClient();

  // Anonymous visitors keep the demo response so the product can be explored
  // before an account exists.
  if (!supabase) {
    return NextResponse.json({ report, mode: "demo", provider: RESEARCH_PROVIDER, dataSource: "demo", creditsCharged: 0, stored: false });
  }

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") {
      return NextResponse.json(
        { error: "Không kết nối được Supabase từ môi trường này. Hãy thử lại hoặc dùng chế độ demo." },
        { status: 503 },
      );
    }
    user = data.user ?? null;
  } catch {
    return NextResponse.json(
      { error: "Không kết nối được Supabase từ môi trường này. Hãy thử lại hoặc dùng chế độ demo." },
      { status: 503 },
    );
  }

  if (!user) {
    return NextResponse.json({ report, mode: "demo", provider: RESEARCH_PROVIDER, dataSource: "demo", creditsCharged: 0, stored: false });
  }

  try {
    const account = await fetchWorkspaceAccount(supabase, user);
    if (!account) {
      return NextResponse.json(
        { error: "Workspace chưa được tạo cho tài khoản này. Hãy tạo workspace rồi thử lại." },
        { status: 409 },
      );
    }

    const { reportRow, evidence } = toPersistencePayload(report);

    const { data: createdId, error } = await supabase.rpc("complete_research_job", {
      p_organization_id: account.organizationId,
      p_input_company_name: companyName || null,
      p_input_source_url: sourceUrl || null,
      p_input_country: country || null,
      p_report: reportRow,
      p_evidence: evidence,
      p_cost: researchCreditCost(RESEARCH_PROVIDER, REPORT_COST),
      p_retention_days: account.retentionDays,
    });

    if (error) {
      const status = error.code === "SK402" ? 402 : error.code === "42501" ? 403 : 400;
      const message =
        error.code === "SK402"
          ? `Bạn cần ít nhất ${REPORT_COST} credits để tạo một Company Report.`
          : error.message;
      return NextResponse.json({ error: message, code: error.code }, { status });
    }

    const reportId = createdId as unknown as string;
    const { data: storedRows } = await supabase
      .from("company_reports")
      .select(
        "id, company_name, country, city, industry, description, official_website, linkedin_url, public_business_email, public_business_phone, whatsapp_business_url, confidence, report_data, captured_at, expires_at, research_jobs(status)",
      )
      .eq("id", reportId)
      .maybeSingle();

    const { data: storedEvidence } = await supabase
      .from("source_evidence")
      .select("company_report_id, kind, source_label, source_url, field_name, evidence_snippet, is_verified")
      .eq("company_report_id", reportId);

    const storedRow = storedRows as unknown as CompanyReportRow | null;
    const storedReport = storedRow
      ? toCompanyReportView({
          report: storedRow,
          evidence: (storedEvidence ?? []) as unknown as SourceEvidenceRow[],
          locale,
        })
      : report;

    const charged = researchCreditCost(RESEARCH_PROVIDER, REPORT_COST);

    return NextResponse.json({
      report: storedReport,
      // `mode` nói dữ liệu **được lưu** ở đâu; `dataSource` nói nội dung **lấy
      // từ** đâu. Trước đây trường thứ hai trả "supabase", khiến phản hồi đọc
      // như "kết quả thật" trong khi nội dung vẫn là báo cáo mẫu.
      mode: "live",
      provider: RESEARCH_PROVIDER,
      dataSource: RESEARCH_PROVIDER === "demo" ? "demo" : "connector",
      stored: true,
      creditsCharged: charged,
      creditsRemaining: Math.max(0, account.credits - charged),
    });
  } catch {
    return NextResponse.json(
      { error: "Không lưu được report vào Supabase. Hãy kiểm tra kết nối rồi thử lại." },
      { status: 503 },
    );
  }
}
