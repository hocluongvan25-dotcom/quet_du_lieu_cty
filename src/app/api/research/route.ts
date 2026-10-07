import { NextResponse } from "next/server";
import { createDemoReport, type CompanyReport } from "@/lib/demo-data";
import { runConnector } from "@/lib/connector";
import { normalizeSeed } from "@/lib/connector/discover";
import { searchOpenWeb, type SearchProvider } from "@/lib/connector/secondary";
import { buildConnectorReport } from "@/lib/data/connector-report";
import { pickOfficialDomain, websiteQueryFor } from "@/lib/data/company-resolver";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchWorkspaceAccount } from "@/lib/data/workspace";
import { toCompanyReportView, type CompanyReportRow, type SourceEvidenceRow } from "@/lib/data/report-view";
import { REPORT_COST } from "@/lib/data/workspace-types";
import { CONNECTOR_PROVIDER, DEMO_PROVIDER, resolveResearchProvider, searchApiKeyFromEnv } from "@/lib/data/research-provider";
import { normalizeLocale, type AppLocale } from "@/lib/i18n";

export const runtime = "nodejs";
/** Research thật đọc vài trang công khai — cần hơn mặc định của nền tảng. */
export const maxDuration = 60;

/** Trần số trang đọc cho một report. Nhiều hơn thì tốn thời gian mà ít thêm giá trị. */
const MAX_PAGES = 6;
/** Ngân sách thời gian cho cả lần chạy. Hết thì trả về phần đã đọc, có ghi chú. */
const RESEARCH_BUDGET_MS = 45_000;

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

function searchProviderFromEnv(): SearchProvider | undefined {
  const named = (process.env.SEARCH_PROVIDER ?? "").trim().toLowerCase();
  return named === "serper" || named === "tavily" || named === "brave" ? named : undefined;
}

/** Turns the provider output into the rows `complete_research_job` expects. */
function toPersistencePayload(report: CompanyReport, provider: string) {
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
    report_data: { signals: report.signals, requirements: report.requirements ?? [], provider },
    provider_trace: { provider: "demo-provider", captured_by: "seekora-app", provider_kind: provider },
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

type RealResearch =
  | { ok: true; report: CompanyReport; evidence: EvidenceInput[]; reportRow: Record<string, unknown>; resolved: { domain: string; via: "link" | "search"; why: string[] } }
  | { ok: false; status: number; error: string };

/**
 * Research thật: **tên → website** (qua search API) → đọc trang công khai của
 * chính công ty đó → report.
 *
 * Ba chỗ có thể hỏng, và mỗi chỗ trả về một câu khác nhau — người dùng phải phân
 * biệt được "khoá hỏng", "không tìm thấy website", và "tìm thấy nhưng site chặn
 * đọc". Gộp chúng thành một câu chung là cách chắc chắn nhất để hiểu sai.
 */
async function researchWithConnector(input: {
  companyName: string;
  sourceUrl: string;
  country: string;
  locale: AppLocale;
  retentionDays: number;
}): Promise<RealResearch> {
  const searchKey = searchApiKeyFromEnv();
  let seed = "";
  let resolvedFrom: { url: string; why: string[] } | null = null;

  if (input.sourceUrl) {
    seed = normalizeSeed(input.sourceUrl);
    if (!seed) return { ok: false, status: 400, error: `Không đọc được tên miền từ "${input.sourceUrl}".` };
  } else {
    const outcome = await searchOpenWeb(websiteQueryFor(input.companyName, input.country), {
      apiKey: searchKey,
      provider: searchProviderFromEnv(),
    });

    if (!outcome.ok) {
      const detail =
        outcome.reason === "rejected"
          ? "Nhà cung cấp tìm kiếm từ chối khoá (HTTP 401/403). Kiểm tra lại SEARCH_API_KEY ở server."
          : outcome.reason === "shape"
            ? "Phản hồi tìm kiếm không đúng định dạng — nhiều khả năng sai nhà cung cấp (SEARCH_PROVIDER)."
            : `Không gọi được dịch vụ tìm kiếm: ${outcome.detail}.`;
      return { ok: false, status: 502, error: detail };
    }

    const picked = pickOfficialDomain(outcome.hits, input.companyName);
    if (!picked) {
      return {
        ok: false,
        status: 404,
        error: `Không tìm thấy website công khai nào khớp với tên "${input.companyName}" (đã hỏi ${outcome.hits.length} kết quả tìm kiếm). Hãy dán link website công ty — mình không đoán tên miền, vì đoán sai thì cả report nói về một công ty khác.`,
      };
    }

    seed = picked.domain;
    resolvedFrom = { url: picked.url, why: picked.why };
  }

  let result;
  try {
    result = await runConnector(seed, {
      maxPages: MAX_PAGES,
      delayMs: 250,
      country: input.country || null,
      companyName: input.companyName || undefined,
      deadlineAt: Date.now() + RESEARCH_BUDGET_MS,
      secondary: {
        searchApiKey: searchKey,
        searchProvider: searchProviderFromEnv(),
        companiesHouseApiKey: process.env.COMPANIES_HOUSE_API_KEY,
        secUserAgent: process.env.SEC_USER_AGENT,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "không rõ nguyên nhân";
    return { ok: false, status: 502, error: `Không đọc được website: ${message}` };
  }

  if (result.pagesFetched === 0) {
    return {
      ok: false,
      status: 502,
      error: `Tìm thấy ${result.domain} nhưng không đọc được trang nào (robots.txt chặn hoặc site từ chối truy cập). Chưa trừ credits — hãy thử lại sau hoặc kiểm tra link.`,
    };
  }

  const { report, evidence, columns, provenance } = buildConnectorReport({
    companyName: input.companyName,
    country: input.country,
    sourceInput: input.sourceUrl || input.companyName,
    result,
    locale: input.locale,
    resolvedFrom,
    retentionDays: input.retentionDays,
  });

  const reportRow: Record<string, unknown> = {
    ...columns,
    company_name: report.companyName,
    country: report.country,
    industry: report.industry,
    description: report.description,
    confidence: report.confidence,
    report_data: {
      signals: report.signals,
      requirements: report.requirements ?? [],
      provider: CONNECTOR_PROVIDER,
      // Toàn bộ kênh/kênh-của-người và phần để người kiểm đọc lại. Cột
      // `public_business_*` chỉ giữ một giá trị mỗi loại, nên nếu không lưu ở
      // đây thì phần còn lại mất sau khi ghi.
      contacts: report.contacts,
      people: report.people ?? [],
      provenance,
    },
    provider_trace: {
      provider: "public-web-connector",
      captured_by: "seekora-app",
      domain: result.domain,
      pages_fetched: result.pagesFetched,
      resolved_via: resolvedFrom ? "search" : "user_link",
      stopped_early: result.stoppedEarly ?? null,
    },
  };

  return {
    ok: true,
    report,
    evidence,
    reportRow,
    resolved: { domain: result.domain, via: resolvedFrom ? "search" : "link", why: resolvedFrom?.why ?? [] },
  };
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

  const supabase = await getSupabaseServerClient();

  // Anonymous visitors keep the demo response so the product can be explored
  // before an account exists — real research costs search quota and page reads,
  // so it stays behind a signed-in workspace.
  if (!supabase) {
    const report = createDemoReport({ companyName, sourceUrl, country });
    return NextResponse.json({ report, mode: "demo", provider: DEMO_PROVIDER, dataSource: "demo", creditsCharged: 0, stored: false, resolved: null });
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
    const report = createDemoReport({ companyName, sourceUrl, country });
    return NextResponse.json({ report, mode: "demo", provider: DEMO_PROVIDER, dataSource: "demo", creditsCharged: 0, stored: false, resolved: null });
  }

  // Provider được chọn cho **từng lượt**: có khoá tìm kiếm thì đọc nguồn công
  // khai thật (tính credits), không có thì trả báo cáo mẫu (0 credits, có nhãn).
  const research = resolveResearchProvider({ searchKey: searchApiKeyFromEnv(), reportCost: REPORT_COST });

  try {
    const account = await fetchWorkspaceAccount(supabase, user);
    if (!account) {
      return NextResponse.json(
        { error: "Workspace chưa được tạo cho tài khoản này. Hãy tạo workspace rồi thử lại." },
        { status: 409 },
      );
    }

    // Kiểm credits **trước** khi tiêu thời gian và quota tìm kiếm: chạy research
    // xong mới báo hết credits là bắt người dùng trả giá cho một lỗi của mình.
    if (research.cost > 0 && account.credits < research.cost) {
      return NextResponse.json(
        { error: `Bạn cần ít nhất ${research.cost} credits để tạo một Company Report.`, code: "SK402" },
        { status: 402 },
      );
    }

    let report: CompanyReport;
    let evidence: EvidenceInput[];
    let reportRow: Record<string, unknown>;
    let resolved: { domain: string; via: "link" | "search"; why: string[] } | null = null;

    if (research.provider === CONNECTOR_PROVIDER) {
      const outcome = await researchWithConnector({
        companyName,
        sourceUrl,
        country,
        locale,
        retentionDays: account.retentionDays,
      });
      if (!outcome.ok) return NextResponse.json({ error: outcome.error, provider: CONNECTOR_PROVIDER, charged: false }, { status: outcome.status });

      report = outcome.report;
      evidence = outcome.evidence;
      reportRow = outcome.reportRow;
      resolved = outcome.resolved;
    } else {
      report = createDemoReport({ companyName, sourceUrl, country });
      const payload = toPersistencePayload(report, research.provider);
      evidence = payload.evidence;
      reportRow = payload.reportRow as unknown as Record<string, unknown>;
    }

    const { data: createdId, error } = await supabase.rpc("complete_research_job", {
      p_organization_id: account.organizationId,
      p_input_company_name: companyName || null,
      p_input_source_url: sourceUrl || null,
      p_input_country: country || null,
      p_report: reportRow,
      p_evidence: evidence,
      p_cost: research.cost,
      p_retention_days: account.retentionDays,
    });

    if (error) {
      const status = error.code === "SK402" ? 402 : error.code === "42501" ? 403 : 400;
      const message =
        error.code === "SK402"
          ? `Bạn cần ít nhất ${research.cost} credits để tạo một Company Report.`
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

    return NextResponse.json({
      report: storedReport,
      // `mode` nói dữ liệu **được lưu** ở đâu; `dataSource` nói nội dung **lấy
      // từ** đâu. Trước đây trường thứ hai trả "supabase", khiến phản hồi đọc
      // như "kết quả thật" trong khi nội dung vẫn là báo cáo mẫu.
      mode: "live",
      provider: research.provider,
      dataSource: research.provider === DEMO_PROVIDER ? "demo" : "connector",
      stored: true,
      creditsCharged: research.cost,
      creditsRemaining: Math.max(0, account.credits - research.cost),
      resolved,
      readPages: research.provider === CONNECTOR_PROVIDER ? ((reportRow.provider_trace as { pages_fetched?: number } | undefined)?.pages_fetched ?? 0) : 0,
    });
  } catch {
    return NextResponse.json(
      { error: "Không lưu được report vào Supabase. Hãy kiểm tra kết nối rồi thử lại." },
      { status: 503 },
    );
  }
}
