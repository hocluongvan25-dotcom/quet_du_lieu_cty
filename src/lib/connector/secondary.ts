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
import { asciiHeaderValue } from "./fetch";

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

/**
 * Tiền tố khoá **nhận ra được** của từng nhà cung cấp.
 *
 * Chỉ Tavily có tiền tố đủ đặc trưng để tin (`tvly-`). Khoá Serper là chuỗi hex,
 * khoá Brave là chuỗi chữ-số — đoán hai loại đó từ hình dạng là đoán mò, nên
 * không đoán: người dùng đặt `SEARCH_PROVIDER`, hoặc mặc định về serper.
 */
const KEY_PREFIXES: [string, SearchProvider][] = [["tvly-", "tavily"]];

/** Suy nhà cung cấp từ khoá. Trả null khi không nhận ra — không đoán bừa. */
export function providerFromKey(apiKey?: string | null): SearchProvider | null {
  const key = (apiKey ?? "").trim();
  if (!key) return null;
  for (const [prefix, provider] of KEY_PREFIXES) {
    if (key.startsWith(prefix)) return provider;
  }
  return null;
}

export function isSearchProvider(value: unknown): value is SearchProvider {
  return value === "serper" || value === "tavily" || value === "brave";
}

/**
 * Chọn nhà cung cấp search.
 *
 * Thứ tự: `SEARCH_PROVIDER` (đã chuẩn hoá chữ thường, chỉ nhận ba tên hợp lệ) →
 * suy từ tiền tố khoá → serper. `SEARCH_PROVIDER` được ưu tiên vì nó là lời
 * người dùng nói; nhưng khi người dùng quên đặt (chỉ dán khoá vào), tiền tố
 * `tvly-` cứu được một ca rất dễ xảy ra: khoá Tavily gửi nhầm tới Serper thì
 * nhà cung cấp trả lỗi, mà lỗi đó lại dễ bị đọc thành "khoá hỏng".
 */
export function resolveProvider(apiKey?: string | null, explicit?: string | null): SearchProvider | null {
  if (!apiKey) return null;
  const named = (explicit ?? "").trim().toLowerCase();
  if (isSearchProvider(named)) return named;
  return providerFromKey(apiKey) ?? "serper";
}

type RawHit = { url?: string; title?: string; snippet?: string; description?: string; link?: string; name?: string; content?: string };

/**
 * Một chỗ duy nhất biết hình dạng request của từng nhà cung cấp.
 *
 * Tách ra để lệnh tự-kiểm (`npm run search:check`) dùng đúng cùng một request với
 * connector — nếu connector đổi cách gọi mà lệnh kiểm không đổi, hai bên sẽ lệch
 * nhau và lệnh kiểm trở thành lời nói dối.
 */
export function buildSearchRequest(domain: string, query: string, provider: SearchProvider, apiKey: string): { url: string; init: RequestInit } {
  const scoped = `site:${domain} ${query}`;

  if (provider === "serper") {
    return {
      url: "https://google.serper.dev/search",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ q: scoped, num: 10 }),
      },
    };
  }

  if (provider === "tavily") {
    return {
      url: "https://api.tavily.com/search",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        // Tavily **không** dùng toán tử `site:` như Google/Brave — nó lọc tên
        // miền bằng tham số riêng. Vì vậy câu truy vấn vẫn mang `site:` (giữ
        // nguyên luật của lớp này) và tên miền còn được nói thêm một lần bằng
        // `include_domains`, để nhà cung cấp lọc trước khi trả về. Hàng rào thứ
        // hai trong `parseSearchHits` vẫn giữ nguyên.
        body: JSON.stringify({ query: scoped, max_results: 10, search_depth: "basic", include_domains: [domain] }),
      },
    };
  }

  return {
    url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(scoped)}&count=10`,
    init: { headers: { accept: "application/json", "x-subscription-token": apiKey } },
  };
}

/**
 * Đọc kết quả trả về thành các trang **cùng tên miền**. Hàng rào này giữ cả khi
 * nhà cung cấp trả về kết quả ngoài tên miền dù câu truy vấn đã có `site:`.
 */
function rawRows(payload: unknown, provider: SearchProvider): RawHit[] {
  const body = (payload ?? {}) as Record<string, unknown>;
  return provider === "serper"
    ? ((body.organic as RawHit[]) ?? [])
    : provider === "tavily"
      ? ((body.results as RawHit[]) ?? [])
      : (((body.web as { results?: RawHit[] } | undefined)?.results as RawHit[]) ?? []);
}

/**
 * Phản hồi này có **đúng hình dạng** kết quả tìm kiếm của nhà cung cấp không?
 *
 * Cần hàm này vì một nhà cung cấp có thể trả **HTTP 200 kèm thân lỗi** (sai khoá,
 * sai endpoint). Khi đó "HTTP 200" không phải bằng chứng đã nối được, mà
 * `parseSearchHits` lại trả về mảng rỗng — dễ bị đọc thành "nối được nhưng không
 * có kết quả". Không có mảng kết quả ⇒ không phải phản hồi tìm kiếm.
 */
export function hasSearchShape(payload: unknown, provider: SearchProvider): boolean {
  const body = (payload ?? {}) as Record<string, unknown>;
  if (provider === "serper") return Array.isArray(body.organic);
  if (provider === "tavily") return Array.isArray(body.results);
  return Array.isArray((body.web as { results?: unknown } | undefined)?.results);
}

/** Số dòng nhà cung cấp trả về, **trước** hàng rào tên miền. */
export function countProviderRows(payload: unknown, provider: SearchProvider): number {
  return rawRows(payload, provider).length;
}

export function parseSearchHits(payload: unknown, provider: SearchProvider, domain: string): SearchHit[] {
  const rows = rawRows(payload, provider);

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
    if (registrableDomain(host) !== registrableDomain(domain)) continue;
    hits.push({ url, title: row.title ?? row.name ?? "", snippet: row.snippet ?? row.description ?? row.content ?? "" });
  }
  return hits;
}

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

  try {
    const request = buildSearchRequest(domain, query, provider, apiKey);
    const response = await fetchImpl(request.url, request.init);
    if (!response.ok) {
      log(`search (${provider}): HTTP ${response.status} — bỏ qua`);
      return [];
    }
    const hits = parseSearchHits(await response.json(), provider, domain);
    log(`search (${provider}): ${hits.length} kết quả cùng tên miền`);
    return hits;
  } catch (error) {
    log(`search (${provider}): lỗi ${error instanceof Error ? error.message : "không rõ"} — bỏ qua`);
    return [];
  }
}

// --------------------------------------------- tìm website khi chỉ có tên ---

/**
 * Câu truy vấn **không** giới hạn tên miền. Cả file này chỉ có đúng một việc
 * được phép dùng nó: **tìm ra website của công ty** khi người dùng gõ tên. Sau
 * khi biết tên miền, mọi bước sau quay lại luật cũ — chỉ đọc trang của chính
 * công ty đó.
 */
export function buildOpenSearchRequest(query: string, provider: SearchProvider, apiKey: string): { url: string; init: RequestInit } {
  if (provider === "serper") {
    return {
      url: "https://google.serper.dev/search",
      init: { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey }, body: JSON.stringify({ q: query, num: 10 }) },
    };
  }

  if (provider === "tavily") {
    return {
      url: "https://api.tavily.com/search",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: 10, search_depth: "basic" }),
      },
    };
  }

  return {
    url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
    init: { headers: { accept: "application/json", "x-subscription-token": apiKey } },
  };
}

/** Mọi kết quả nhà cung cấp trả về, **không** lọc tên miền — giữ nguyên thứ tự. */
export function parseOpenHits(payload: unknown, provider: SearchProvider): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const row of rawRows(payload, provider)) {
    const url = row.url ?? row.link;
    if (!url) continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    hits.push({ url, title: row.title ?? row.name ?? "", snippet: row.snippet ?? row.description ?? row.content ?? "" });
  }
  return hits;
}

export type OpenSearchOutcome =
  | { ok: true; provider: SearchProvider; hits: SearchHit[] }
  | { ok: false; provider: SearchProvider | null; reason: "no_key" | "rejected" | "http" | "shape" | "network"; detail: string };

/**
 * Tìm trên toàn internet — **chỉ để tìm website công ty**.
 *
 * Trả về thất bại kèm lý do cụ thể thay vì mảng rỗng, vì ba chuyện rất khác
 * nhau: chưa có khoá, khoá bị từ chối, và "tìm được nhưng không có kết quả".
 * Gộp chúng thành mảng rỗng là cách chắc chắn nhất để người dùng hiểu sai.
 */
export async function searchOpenWeb(query: string, options: SearchOptions = {}): Promise<OpenSearchOutcome> {
  const provider = resolveProvider(options.apiKey, options.provider);
  const apiKey = (options.apiKey ?? "").trim();
  if (!provider || !apiKey) return { ok: false, provider: null, reason: "no_key", detail: "chưa có khoá tìm kiếm" };

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const request = buildOpenSearchRequest(query, provider, apiKey);
    const response = await fetchImpl(request.url, request.init);
    if (!response.ok) {
      const rejected = response.status === 401 || response.status === 403;
      return {
        ok: false,
        provider,
        reason: rejected ? "rejected" : "http",
        detail: rejected ? `HTTP ${response.status} — nhà cung cấp từ chối khoá` : `HTTP ${response.status}`,
      };
    }
    const payload = await response.json();
    if (!hasSearchShape(payload, provider)) {
      return { ok: false, provider, reason: "shape", detail: "phản hồi không phải kết quả tìm kiếm" };
    }
    return { ok: true, provider, hits: parseOpenHits(payload, provider) };
  } catch (error) {
    return { ok: false, provider, reason: "network", detail: error instanceof Error ? error.message : "không rõ" };
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
  /** Chuỗi User-Agent cho SEC EDGAR, nên kèm email liên hệ (chính sách fair-access). */
  secUserAgent?: string;
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

/**
 * SEC chặn (HTTP 403) mọi request thiếu User-Agent nhận diện được — và chính sách
 * fair-access của họ còn đòi **một cách liên hệ**, thường là email. Request đầu
 * tiên trên mariani.com đã nhận 403 vì User-Agent chỉ có tên bot và URL.
 *
 * Không bịa email: người dùng đặt `SEC_USER_AGENT`, ví dụ
 * `Nguyen Van A <a@congty.vn>`. Chưa đặt thì vẫn gửi UA nói rõ điều đó, và lỗi
 * 403 sẽ tự chỉ ra việc cần làm.
 */
export const DEFAULT_SEC_USER_AGENT =
  "SeekoraBot/0.1 (public supplier research; set SEC_USER_AGENT with a contact email)";

/**
 * `SEC_USER_AGENT` do người dùng đặt nên có thể có chữ có dấu — và header HTTP
 * không nhận chữ có dấu (xem `asciiHeaderValue`). Làm sạch ở đây, ngay trước khi
 * gửi, chứ không tin rằng người dùng sẽ chỉ gõ ASCII.
 */
function secHeaders(contact?: string): Record<string, string> {
  const agent = asciiHeaderValue((contact ?? "").trim() || DEFAULT_SEC_USER_AGENT);
  return { "user-agent": agent, accept: "application/json" };
}

/** True khi chuỗi người dùng đặt bị đổi vì header chỉ nhận ASCII. */
function secUserAgentWasNormalized(contact?: string): boolean {
  const raw = (contact ?? "").trim();
  return Boolean(raw) && asciiHeaderValue(raw) !== raw;
}

/**
 * Đọc mã CIK từ phản hồi Atom của EDGAR — và nói rõ **vì sao** không có mã.
 *
 * SEC có thể trả mã CIK ở hai dạng, tuỳ bản CGI: thẻ `<cik>0000320193</cik>` trong
 * khối `<company-info>` (dạng hiện hành), hoặc dạng `CIK=0000320193` nằm trong
 * liên kết. Bản trước chỉ tìm dạng thứ hai, nên một công ty **có thật** trong sổ
 * vẫn có thể ra "không tìm thấy hồ sơ" — câu trả lời đúng vì may, không phải vì
 * đọc được. Ba kết cục phải tách bạch: `found` / `none` (sổ nói không có) /
 * `unreadable` (không nhận ra định dạng).
 */
export function readCikFromEdgarFeed(xml: string): { kind: "found"; cik: string } | { kind: "none" } | { kind: "unreadable" } {
  const patterns = [/<cik>\s*(\d{1,10})\s*<\/cik>/i, /CIK=(\d{1,10})/i, /<CIK>\s*(\d{1,10})\s*<\/CIK>/];
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match) return { kind: "found", cik: match[1].padStart(10, "0") };
  }
  if (/no matching companies|no matching entries|did not match any/i.test(xml)) return { kind: "none" };
  return { kind: "unreadable" };
}

function secForbiddenHint(status: number): string {
  return status === 403
    ? " — SEC đòi User-Agent kèm cách liên hệ, đặt SEC_USER_AGENT trong .env.local (ví dụ: \"Tên anh <email@congty.vn>\")"
    : "";
}

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
  if (secUserAgentWasNormalized(keys.secUserAgent)) {
    log("User-Agent SEC đã được bỏ dấu: header HTTP chỉ nhận ký tự Latin-1, không nhận chữ có dấu.");
  }
  const headers = secHeaders(keys.secUserAgent);

  try {
    const searchResponse = await fetchImpl(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=10-K&dateb=&owner=include&count=10&output=atom`,
      { headers },
    );
    if (!searchResponse.ok) {
      return { queried: ["sec_edgar"], reason: `SEC trả HTTP ${searchResponse.status}${secForbiddenHint(searchResponse.status)}` };
    }

    const xml = await searchResponse.text();
    const lookup = readCikFromEdgarFeed(xml);
    if (lookup.kind === "none") {
      // Sổ **nói rõ** không có công ty nào khớp tên — đây là câu trả lời thật.
      return { queried: ["sec_edgar"], reason: "không tìm thấy hồ sơ theo tên này" };
    }
    if (lookup.kind === "unreadable") {
      // Khác hẳn "không tìm thấy": mình không đọc được phản hồi. Trả về cùng một
      // câu với trường hợp trên là biến "chưa kiểm được" thành "đã kiểm, không có"
      // — và đó là loại sai nguy hiểm nhất vì nó trông y như một câu trả lời.
      return {
        queried: ["sec_edgar"],
        reason: "SEC trả về định dạng không nhận ra (không có mã CIK trong phản hồi) — chưa kiểm được, không phải 'không có hồ sơ'",
      };
    }
    const cik = lookup.cik;

    const detailResponse = await fetchImpl(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers });
    if (!detailResponse.ok) {
      return { queried: ["sec_edgar"], reason: `SEC submissions trả HTTP ${detailResponse.status}${secForbiddenHint(detailResponse.status)}` };
    }

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
