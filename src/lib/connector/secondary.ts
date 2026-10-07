/**
 * Nguồn cấp 2 — chỉ chạy khi nguồn cấp 1 (website công ty) không tìm được đầu mối
 * mua hàng nào.
 *
 * Ba nguồn, cùng một nguyên tắc: **đi tới nguồn gốc, không scrape trung gian**.
 *
 *   1. **Search API** (tuỳ chọn `SEARCH_API_KEY`) — để tìm trang trên chính tên
 *      miền công ty. Câu truy vấn luôn có `site:` nên phạm vi vẫn là website của
 *      họ; search chỉ giúp tìm được trang mà sitemap và đường dẫn đoán trước bỏ sót.
 *   2. **Sổ đăng ký doanh nghiệp** — hiện có cho Anh (Companies House, dữ liệu mở
 *      theo OGL, API miễn phí) và Mỹ (SEC EDGAR, hồ sơ công khai). Cho ra **tên
 *      pháp nhân, số đăng ký, tình trạng, ngành, và tên người đương nhiệm** —
 *      đây là phần trả lời câu hỏi "có đúng công ty này không".
 *   3. **Hội chợ / hiệp hội ngành** — chưa cắm (xem spec §14).
 *
 * ## Điều lớp này không bao giờ làm
 *
 *  - Không sinh email. Sổ đăng ký **không có** email hay điện thoại, nên không
 *    có kênh liên hệ nào được tạo ra từ đây.
 *  - Không coi "tìm thấy trên search" là bằng chứng. Search chỉ trả về **URL**;
 *    bằng chứng vẫn phải là câu chữ trên trang mà chính mình mở ra (bước 4).
 *  - Không đọc nguồn trả phí ở đây. Dòng dữ liệu mua có bảng `market_sources`
 *    riêng và phải khai báo nguồn (005).
 */

import { registrableDomain } from "./html";

// ------------------------------------------------------------- search API ---

export type SearchProvider = "serper" | "tavily" | "brave";

export type SearchOptions = {
  apiKey?: string;
  provider?: SearchProvider;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
};

export type SearchHit = {
  url: string;
  title: string;
  /** Đoạn mô tả của công cụ tìm kiếm. KHÔNG phải bằng chứng — chỉ để xếp hạng. */
  snippet: string;
};

/** Chọn nhà cung cấp search: chỉ dùng khi có khoá, và chỉ khi người dùng cấu hình. */
export function resolveProvider(apiKey?: string, explicit?: SearchProvider): SearchProvider | null {
  if (!apiKey) return null;
  return explicit ?? "serper";
}

type RawHit = { url?: string; title?: string; snippet?: string; description?: string; link?: string; name?: string; content?: string };

/**
 * Tìm trang trên **chính tên miền của công ty**. Câu truy vấn luôn có `site:`,
 * nên không có chuyện lấy dữ liệu từ website khác rồi gán cho công ty này.
 */
export async function searchSite(domain: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const provider = resolveProvider(options.apiKey, options.provider);
  const log = options.log ?? (() => {});
  if (!provider) return [];

  const apiKey = options.apiKey!;
  const fetchImpl = options.fetchImpl ?? fetch;
  const scoped = `site:${domain} ${query}`;

  const request =
    provider === "serper"
      ? {
          url: "https://google.serper.dev/search",
          init: {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": apiKey },
            body: JSON.stringify({ q: scoped, num: 10 }),
          } as RequestInit,
        }
      : provider === "tavily"
        ? {
            url: "https://api.tavily.com/search",
            init: {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ api_key: apiKey, query: scoped, max_results: 10, search_depth: "basic" }),
            } as RequestInit,
          }
        : {
            url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(scoped)}&count=10`,
            init: { headers: { accept: "application/json", "x-subscription-token": apiKey } } as RequestInit,
          };

  try {
    const response = await fetchImpl(request.url, request.init);
    if (!response.ok) {
      log(`search (${provider}): HTTP ${response.status} — bỏ qua`);
      return [];
    }
    const payload = (await response.json()) as Record<string, unknown>;

    const rows: RawHit[] =
      provider === "serper"
        ? ((payload.organic as RawHit[]) ?? [])
        : provider === "tavily"
          ? ((payload.results as RawHit[]) ?? [])
          : (((payload.web as { results?: RawHit[] } | undefined)?.results as RawHit[]) ?? []);

    const hits: SearchHit[] = [];
    for (const row of rows) {
      const url = row.url ?? row.link;
      if (!url) continue;
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      // Hàng rào cuối: search có thể trả về kết quả ngoài tên miền dù đã có site:.
      if (registrableDomain(host) !== registrableDomain(domain)) continue;
      hits.push({ url, title: row.title ?? row.name ?? "", snippet: row.snippet ?? row.description ?? row.content ?? "" });
    }

    log(`search (${provider}): ${hits.length} kết quả cùng tên miền`);
    return hits;
  } catch (error) {
    log(`search (${provider}): lỗi ${error instanceof Error ? error.message : "không rõ"} — bỏ qua`);
    return [];
  }
}

/** Những câu hỏi dùng cho nguồn cấp 2, theo thứ tự ưu tiên. */
export const SECONDARY_QUERIES = [
  "supplier registration",
  "become a supplier",
  "procurement contact",
  "purchasing manager",
  "vendor onboarding",
  "supplier requirements",
];

export type HarvestResult = {
  urls: string[];
  documents: string[];
  queriesRun: number;
  provider: SearchProvider | null;
};

/**
 * Thu hoạch thêm URL từ search API, **không** lấy snippet làm bằng chứng.
 * Chỉ trả về URL cùng tên miền — search chỉ có nhiệm vụ chỉ đường.
 */
export async function harvestUrlsFromSearch(
  domain: string,
  options: SearchOptions & { limit?: number } = {},
): Promise<HarvestResult> {
  const provider = resolveProvider(options.apiKey, options.provider);
  if (!provider) return { urls: [], documents: [], queriesRun: 0, provider: null };

  const limit = options.limit ?? 6;
  const seen = new Set<string>();
  const urls: string[] = [];
  const documents: string[] = [];
  let queriesRun = 0;

  for (const query of SECONDARY_QUERIES) {
    if (urls.length + documents.length >= limit) break;
    queriesRun += 1;
    const hits = await searchSite(domain, query, options);
    for (const hit of hits) {
      const clean = hit.url.split("#")[0].replace(/\/$/, "");
      if (seen.has(clean)) continue;
      seen.add(clean);
      let path = "/";
      try {
        path = new URL(clean).pathname;
      } catch {
        continue;
      }
      if (/\.pdf$/i.test(path)) {
        documents.push(clean);
      } else {
        urls.push(clean);
      }
      if (urls.length + documents.length >= limit) break;
    }
  }

  options.log?.(`search: ${queriesRun} truy vấn, thu được ${urls.length} trang + ${documents.length} tài liệu mới`);
  return { urls: urls.slice(0, limit), documents: documents.slice(0, limit), queriesRun, provider };
}

// ---------------------------------------------------------- sổ đăng ký ------

/** Một người đương nhiệm theo sổ đăng ký. Không kèm kênh liên hệ — sổ không có. */
export type RegistryOfficer = {
  name: string;
  /** Chức danh nguyên văn như sổ ghi, không dịch, không suy diễn. */
  role: string;
  appointedOn?: string;
};

/** Kết quả đối chiếu sổ đăng ký — dùng cho bước 1 (đúng công ty chưa?). */
export type RegistryFinding = {
  registry: "companies_house" | "sec_edgar";
  /** Nhãn hiển thị kèm nguồn, luôn có tên cơ quan. */
  registryLabel: string;
  sourceUrl: string;
  registeredName?: string;
  companyNumber?: string;
  /** Tình trạng pháp lý nguyên văn: "active", "dissolved", "liquidation"… */
  status?: string;
  incorporatedOn?: string;
  /** Ngành theo mã SIC của sổ — nguyên văn. */
  industry?: string;
  formerNames?: string[];
  officers: RegistryOfficer[];
};

export type RegistryResult = {
  /** Sổ đã hỏi, kể cả khi không có kết quả. */
  queried: string[];
  finding?: RegistryFinding;
  /** Vì sao không tra được (thiếu khoá, không tìm thấy công ty, lỗi mạng). */
  reason?: string;
};

export type RegistryKeys = {
  companiesHouseApiKey?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
};

/** Quốc gia → sổ đăng ký miễn phí có API. Chỉ hai nước đã kiểm chứng. */
export function registriesForCountry(country?: string | null): ("companies_house" | "sec_edgar")[] {
  const text = (country ?? "").trim().toLowerCase();
  if (["gb", "uk", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland"].includes(text)) {
    return ["companies_house"];
  }
  if (["us", "usa", "united states", "united states of america", "america"].includes(text)) return ["sec_edgar"];
  return [];
}

const SEC_HEADERS = {
  // SEC yêu cầu User-Agent nhận diện được, kèm cách liên hệ.
  "user-agent": "SeekoraBot/0.1 (public supplier research; +https://github.com/hocluongvan25-dotcom/quet_du_lieu_cty)",
  accept: "application/json",
};

export const COMPANIES_HOUSE_LABEL = "UK Companies House";
export const SEC_EDGAR_LABEL = "US SEC EDGAR";

/**
 * UK Companies House — API miễn phí, dữ liệu mở theo Open Government Licence,
 * cho phép dùng thương mại **với điều kiện ghi nguồn** (nhãn nguồn luôn được ghi).
 *
 * Hai lượt gọi: hồ sơ công ty (tên pháp nhân, số đăng ký, tình trạng, ngành) và
 * danh sách người đương nhiệm. Không lấy gì khác, không suy ra kênh liên hệ.
 */
export async function lookupCompaniesHouse(companyName: string, keys: RegistryKeys = {}): Promise<RegistryResult> {
  const log = keys.log ?? (() => {});
  const apiKey = keys.companiesHouseApiKey?.trim();
  if (!apiKey) return { queried: [], reason: "thiếu COMPANIES_HOUSE_API_KEY" };

  const fetchImpl = keys.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  const base = "https://api.company-information.service.gov.uk";
  const headers = { authorization: auth };

  try {
    const searchResponse = await fetchImpl(`${base}/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=5`, { headers });
    if (!searchResponse.ok) return { queried: ["companies_house"], reason: `Companies House trả HTTP ${searchResponse.status}` };

    const search = (await searchResponse.json()) as { items?: { company_number?: string; title?: string }[] };
    const match = (search.items ?? []).find((item) => item.company_number);
    if (!match?.company_number) return { queried: ["companies_house"], reason: "không tìm thấy công ty theo tên này" };

    const number = match.company_number;
    const profileResponse = await fetchImpl(`${base}/company/${number}`, { headers });
    const profile = profileResponse.ok
      ? ((await profileResponse.json()) as {
          company_name?: string;
          company_status?: string;
          date_of_creation?: string;
          type?: string;
          sic_codes?: string[];
          previous_company_names?: { name?: string }[];
        })
      : {};

    const officerResponse = await fetchImpl(`${base}/company/${number}/officers?items_per_page=50`, { headers });
    const officerPayload = officerResponse.ok
      ? ((await officerResponse.json()) as { items?: { name?: string; officer_role?: string; appointed_on?: string; resigned_on?: string }[] })
      : {};

    const officers: RegistryOfficer[] = (officerPayload.items ?? [])
      .filter((officer) => officer.name && !officer.resigned_on)
      .map((officer) => ({ name: officer.name!, role: officer.officer_role ?? "officer", appointedOn: officer.appointed_on }));

    const industry = profile.sic_codes?.length ? `SIC ${profile.sic_codes.join(", ")}` : undefined;
    const formerNames = (profile.previous_company_names ?? []).map((entry) => entry.name).filter((name): name is string => Boolean(name));

    const finding: RegistryFinding = {
      registry: "companies_house",
      registryLabel: COMPANIES_HOUSE_LABEL,
      sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}/officers`,
      registeredName: profile.company_name ?? match.title,
      companyNumber: number,
      status: profile.company_status,
      incorporatedOn: profile.date_of_creation,
      industry,
      formerNames: formerNames.length > 0 ? formerNames : undefined,
      officers,
    };

    log(`companies house: ${number}, ${finding.status ?? "không rõ tình trạng"}, ${officers.length} người đương nhiệm`);
    return { queried: ["companies_house"], finding };
  } catch (error) {
    return { queried: ["companies_house"], reason: `lỗi khi tra: ${error instanceof Error ? error.message : "không rõ"}` };
  }
}

/**
 * SEC EDGAR — hồ sơ công khai của công ty nộp hồ sơ cho SEC (Mỹ). EDGAR cho
 * **công ty**: tên pháp nhân, tên cũ, địa chỉ, mã ngành SIC, và hồ sơ đã nộp.
 *
 * Không trả về danh sách người đương nhiệm: trong EDGAR, tên và chức danh người
 * ký nằm *bên trong* từng hồ sơ, đọc ra là việc nặng hơn và dễ sai. Thà thiếu
 * còn hơn gán nhầm một cái tên cho công ty.
 */
export async function lookupSecEdgar(companyName: string, keys: RegistryKeys = {}): Promise<RegistryResult> {
  const log = keys.log ?? (() => {});
  const fetchImpl = keys.fetchImpl ?? fetch;

  try {
    const searchResponse = await fetchImpl(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=10-K&dateb=&owner=include&count=10&output=atom`,
      { headers: SEC_HEADERS },
    );
    if (!searchResponse.ok) return { queried: ["sec_edgar"], reason: `SEC trả HTTP ${searchResponse.status}` };

    const xml = await searchResponse.text();
    const cik = [...xml.matchAll(/CIK=(\d{10})/g)].map((match) => match[1])[0];
    if (!cik) return { queried: ["sec_edgar"], reason: "không tìm thấy hồ sơ theo tên này" };

    const detailResponse = await fetchImpl(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: SEC_HEADERS });
    if (!detailResponse.ok) return { queried: ["sec_edgar"], reason: `SEC submissions trả HTTP ${detailResponse.status}` };

    const detail = (await detailResponse.json()) as {
      name?: string;
      sicDescription?: string;
      stateOfIncorporation?: string;
      addresses?: { business?: { city?: string; stateOrCountry?: string } };
      formerNames?: { name?: string }[];
      filings?: { recent?: { form?: string[]; filingDate?: string[] } };
    };

    const recent = detail.filings?.recent;
    const latestFiling = recent?.filingDate?.[0];

    const finding: RegistryFinding = {
      registry: "sec_edgar",
      registryLabel: SEC_EDGAR_LABEL,
      sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=10`,
      registeredName: detail.name ?? companyName,
      companyNumber: `CIK ${cik}`,
      // EDGAR không có trường "tình trạng"; ghi thứ có thật: hồ sơ gần nhất.
      status: latestFiling ? `hồ sơ gần nhất ${latestFiling}` : undefined,
      industry: detail.sicDescription,
      formerNames: (detail.formerNames ?? []).map((entry) => entry.name).filter((name): name is string => Boolean(name)),
      officers: [],
    };

    log(`sec edgar: CIK ${cik} (${finding.registeredName ?? companyName})`);
    return { queried: ["sec_edgar"], finding };
  } catch (error) {
    return { queried: ["sec_edgar"], reason: `lỗi khi tra: ${error instanceof Error ? error.message : "không rõ"}` };
  }
}

/**
 * Tra sổ đăng ký phù hợp với quốc gia của công ty. Không có sổ miễn phí cho
 * quốc gia đó thì trả về lý do — **không** đoán, không dùng nguồn khác thay thế.
 */
export async function lookupRegistry(
  country: string | null | undefined,
  companyName: string,
  keys: RegistryKeys = {},
): Promise<RegistryResult> {
  if (!companyName.trim()) return { queried: [], reason: "thiếu tên công ty để tra sổ" };

  const registries = registriesForCountry(country);
  if (registries.length === 0) {
    return {
      queried: [],
      reason: `chưa có sổ đăng ký miễn phí cho quốc gia "${country ?? "không rõ"}"`,
    };
  }

  const outcomes = await Promise.all(
    registries.map((registry) => (registry === "companies_house" ? lookupCompaniesHouse(companyName, keys) : lookupSecEdgar(companyName, keys))),
  );

  const queried = outcomes.flatMap((outcome) => outcome.queried);
  const finding = outcomes.map((outcome) => outcome.finding).find(Boolean);
  if (finding) return { queried, finding };

  return { queried, reason: outcomes.map((outcome) => outcome.reason).filter(Boolean).join("; ") || "không có kết quả" };
}
