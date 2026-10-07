/**
 * Sitemap — bản đồ chính công ty tự công bố về website của họ.
 *
 * ## Vì sao đây là "nguồn cấp 1.5"
 *
 * Bước 2 của thiết kế là đọc những đường dẫn đoán được (`/contact`,
 * `/suppliers`…). Cách đó bỏ sót đúng thứ đáng giá nhất: trang mua hàng **không
 * đoán được tên** — `/vi/doi-tac-cung-ung`, `/en/partners/become-vendor`,
 * `/supplier-quality-hub`. Những trang đó nằm trong sitemap.
 *
 * Sitemap là nguồn tốt hơn search API ở mọi mặt: công ty tự công bố nó, không
 * cần khoá API, không có bên thứ ba phải tin, và không tốn thêm lượt gọi mạng
 * nào ngoài tên miền. Vì vậy nó chạy **trước**, và chỉ khi vẫn không tìm thấy
 * đầu mối mua hàng thì mới tới nguồn cấp 2 (search API, sổ đăng ký).
 *
 * ## Giới hạn có chủ ý
 *
 *  - Chỉ cùng tên miền (kiểm bằng registrable domain, như mọi phần khác).
 *  - Chỉ đọc file nhỏ: một sitemap khổng lồ nghĩa là website lớn, và mình không
 *    cần đọc hết — chỉ cần những URL khớp từ khoá.
 *  - Có sitemap index (sitemap của nhiều sitemap) thì chỉ lấy tối đa vài file con,
 *    và ưu tiên file con có tên gợi ý (supplier, pages…).
 */

import { fetchPage } from "./fetch";
import { registrableDomain } from "./html";

/** Đường dẫn sitemap thường gặp, xếp theo mức phổ biến. */
export const SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemap/sitemap.xml", "/sitemap.xml.gz"];

/** Từ khoá cho biết một URL trong sitemap là trang mình cần đọc. */
const RELEVANT_URL = /supplier|vendor|procure|purchas|sourcing|become-a-|partner|contact|about|quality|certificat|tender|rfq|compliance|nhà cung|doi-tac|nha-cung|tuyen-dung/i;

export type SitemapResult = {
  /** URL trang (không phải PDF) khớp từ khoá, đã bỏ trùng, giữ thứ tự xuất hiện. */
  urls: string[];
  /** URL tài liệu PDF khớp từ khoá. */
  documents: string[];
  /** File sitemap đã đọc được, để ghi vào nhật ký. */
  sitemapsRead: string[];
  /** Vì sao không lấy được gì — chỉ để người kiểm đọc. */
  reason?: string;
};

const MAX_SITEMAPS = 4;
const MAX_BYTES = 2_000_000;
const MAX_URLS = 60;

/** `<loc>` trong sitemap, giải mã entity tối thiểu. */
function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const pattern = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let match = pattern.exec(xml);
  while (match) {
    locs.push(
      match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    );
    match = pattern.exec(xml);
  }
  return locs;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex/i.test(xml);
}

/** Tên file con có gợi ý gì không (để biết file nào đáng đọc trước). */
function childScore(url: string): number {
  if (/supplier|vendor|procure|purchas|sourcing|partner/i.test(url)) return 100;
  if (/page|post|product|company|about|contact/i.test(url)) return 50;
  return 10;
}

export type SitemapDeps = {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  guard?: (url: string) => Promise<unknown>;
  maxSitemaps?: number;
  /** Chốt robots.txt: trả false thì URL đó không được đọc/không được nhận. */
  allowed?: (url: string) => boolean;
  log?: (message: string) => void;
};

/**
 * Đọc sitemap của một tên miền và trả về những trang đáng đọc.
 *
 * Không ném lỗi: không có sitemap là chuyện bình thường (nhiều website không
 * có), ghi lại lý do rồi đi tiếp.
 */
export async function readSitemap(seedUrl: string, deps: SitemapDeps = {}): Promise<SitemapResult> {
  const { fetchImpl, userAgent, guard, maxSitemaps = MAX_SITEMAPS, allowed, log = () => {} } = deps;

  let origin: string;
  let siteDomain: string;
  try {
    const parsed = new URL(seedUrl);
    origin = parsed.origin;
    siteDomain = registrableDomain(parsed.hostname);
  } catch {
    return { urls: [], documents: [], sitemapsRead: [], reason: "seed URL không hợp lệ" };
  }

  const sitemapsRead: string[] = [];
  const urls: string[] = [];
  const documents: string[] = [];
  const seen = new Set<string>();
  let reason: string | undefined;

  const collect = (locs: string[]) => {
    locs.forEach((loc) => {
      let target: URL;
      try {
        target = new URL(loc);
      } catch {
        return;
      }
      // Chỉ cùng tên miền: sitemap hay trỏ sang shop, blog, CDN khác.
      if (registrableDomain(target.hostname) !== siteDomain) return;
      if (allowed && !allowed(target.toString())) return;
      if (!RELEVANT_URL.test(target.pathname)) return;

      const clean = target.toString().replace(/\/$/, "");
      if (seen.has(clean)) return;
      seen.add(clean);

      if (/\.pdf$/i.test(target.pathname)) {
        documents.push(clean);
      } else if (urls.length < MAX_URLS) {
        urls.push(clean);
      }
    });
  };

  const queue = SITEMAP_PATHS.map((path) => `${origin}${path}`);
  const tried: string[] = [];
  let read = 0;

  while (queue.length > 0 && read < maxSitemaps) {
    const candidate = queue.shift()!;
    if (tried.includes(candidate)) continue;
    tried.push(candidate);
    if (allowed && !allowed(candidate)) {
      reason = "robots.txt chặn sitemap";
      continue;
    }

    const outcome = await fetchPage(candidate, { fetchImpl, userAgent, guard, maxBytes: MAX_BYTES });
    if (!outcome.ok || !outcome.body) continue;
    if (!/<(urlset|sitemapindex)/i.test(outcome.body)) continue;

    read += 1;
    sitemapsRead.push(outcome.finalUrl ?? candidate);

    if (isSitemapIndex(outcome.body)) {
      // File con là bản đồ thật, nên đọc trước những đường dẫn gốc còn lại —
      // nếu không, hạn mức có thể bị ăn hết bởi các đường dẫn không tồn tại.
      const children = extractLocs(outcome.body)
        .filter((loc) => {
          try {
            return registrableDomain(new URL(loc).hostname) === siteDomain;
          } catch {
            return false;
          }
        })
        .sort((a, b) => childScore(b) - childScore(a));
      children.forEach((child) => queue.unshift(child));
      if (children.length === 0) reason = "sitemap index không có file con cùng tên miền";
      continue;
    }

    const before = urls.length + documents.length;
    collect(extractLocs(outcome.body));

    // Đã có bản đồ dùng được thì không thử thêm đường dẫn gốc khác nữa: mỗi lượt
    // thử là một yêu cầu gửi tới máy chủ của họ mà gần như không thêm thông tin.
    if (urls.length + documents.length > before) break;
  }

  if (read === 0) reason = reason ?? "không tìm thấy sitemap";
  log(`sitemap: đọc ${sitemapsRead.length} file, ${urls.length} trang liên quan, ${documents.length} tài liệu`);

  return { urls, documents, sitemapsRead, ...(reason ? { reason } : {}) };
}
