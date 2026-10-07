/**
 * Từ **tên công ty** → **website chính thức**.
 *
 * Đây là bước dễ sai nhất của cả luồng. Chọn nhầm tên miền thì mọi thứ phía sau
 * vẫn đúng kỹ thuật — trang đọc được, kênh có nguồn, điểm tin cậy được tính —
 * nhưng toàn bộ report nói về **một công ty khác**, và người đọc không có cách
 * nào nhận ra. Vì vậy hàm ở đây chọn rất hẹp: chỉ nhận khi có **bằng chứng tên**
 * (tên nằm trong chính tên miền, hoặc trong tiêu đề kết quả tìm kiếm). Không có
 * bằng chứng thì trả `null` để người dùng dán link, thay vì đoán bừa.
 *
 * Snippet của search **không** được dùng làm dữ liệu ở đây — chỉ để xếp hạng.
 * Bằng chứng vẫn phải là câu chữ trên trang mà mình tự mở.
 */

import { registrableDomain } from "@/lib/connector/html";
import { foldName, nameSlug } from "@/lib/connector/identity";
import type { SearchHit } from "@/lib/connector/secondary";

/**
 * Những tên miền **không bao giờ** là website của công ty: mạng xã hội, sổ dữ
 * liệu, sàn thương mại, báo. Chúng thường đứng đầu kết quả tìm kiếm cho một cái
 * tên, và lấy chúng làm "website công ty" là sai ngay từ bước đầu.
 */
const NOT_COMPANY_SITES = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
  "wikidata.org",
  "crunchbase.com",
  "bloomberg.com",
  "zoominfo.com",
  "glassdoor.com",
  "indeed.com",
  "yelp.com",
  "apollo.io",
  "rocketreach.co",
  "signalhire.com",
  "leadiq.com",
  "dnb.com",
  "kompass.com",
  "europages.com",
  "alibaba.com",
  "made-in-china.com",
  "amazon.com",
  "ebay.com",
  "tradeindia.com",
  "exportersindia.com",
  "go4worldbusiness.com",
  "importyeti.com",
  "volza.com",
  "panjiva.com",
  "importgenius.com",
  "yellowpages.com",
  "trustpilot.com",
  "reuters.com",
  "forbes.com",
  "medium.com",
  "github.com",
  "google.com",
  "bing.com",
  "facebook.net",
]);

export type DomainCandidate = {
  /** Tên miền đăng ký được, dùng làm hạt giống cho connector. */
  domain: string;
  /** URL đầy đủ của kết quả đã thắng — để đối chiếu lại với search. */
  url: string;
  /** Vì sao chọn nó. Câu người đọc được, để người kiểm tra lại lý do. */
  why: string[];
  score: number;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isHomepage(url: string): boolean {
  try {
    const { pathname, search, hash } = new URL(url);
    return (pathname === "/" || pathname === "") && !search && !hash;
  } catch {
    return false;
  }
}

/**
 * Chọn website công ty từ kết quả tìm kiếm. Trả `null` khi không có ứng viên nào
 * mang **bằng chứng tên** — im lặng và trả rỗng tốt hơn trả về một tên miền nghe
 * hợp lý.
 */
export function pickOfficialDomain(hits: SearchHit[], companyName: string): DomainCandidate | null {
  const slug = nameSlug(companyName);
  const foldedName = foldName(companyName);
  if (!slug) return null;

  // Tên cụt (1–3 ký tự) khớp vu vơ ở khắp nơi — "AC" nằm trong "machinery.com".
  // Với những tên đó, hàm này **không đoán**: trả null để người dùng dán link.
  // Đoán ở đây thì report sẽ rất gọn ghẽ và rất sai.
  if (slug.length < 4) return null;

  type Scored = DomainCandidate & { firstSeen: number };
  const best = new Map<string, Scored>();

  hits.forEach((hit, index) => {
    const host = hostOf(hit.url);
    if (!host) return;
    const domain = registrableDomain(host);
    if (!domain || NOT_COMPANY_SITES.has(domain)) return;

    const label = domain.split(".")[0] ?? "";
    // Tên có trong tên miền: "vinamilk" trong vinamilk.com.vn — hoặc tên công ty
    // dài hơn nhãn tên miền, như "Sun-Maid Growers Of California" với sunmaid.com.
    const hostHasName = foldName(host).includes(slug) || (label.length >= 4 && slug.includes(label));
    const titleHasName = foldName(`${hit.title} ${hit.snippet}`).includes(foldedName || slug);

    if (!hostHasName && !titleHasName) return;

    const why: string[] = [];
    let score = 0;
    if (hostHasName) {
      score += 3;
      why.push("tên công ty nằm trong tên miền");
    }
    if (titleHasName) {
      score += 2;
      why.push("kết quả tìm kiếm nhắc đúng tên công ty");
    }
    if (isHomepage(hit.url)) {
      score += 1;
      why.push("là trang chủ");
    }

    const existing = best.get(domain);
    if (existing && existing.score >= score) return;
    best.set(domain, { domain, url: hit.url, why, score, firstSeen: index });
  });

  const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen);
  const winner = ranked[0];
  if (!winner) return null;
  return { domain: winner.domain, url: winner.url, why: winner.why, score: winner.score };
}

/** Câu truy vấn đi tìm website. Giữ tên trong dấu ngoặc kép để bớt kết quả nhiễu. */
export function websiteQueryFor(companyName: string, country?: string | null): string {
  const name = companyName.trim().replace(/"/g, "");
  if (!name) return "";
  return country ? `"${name}" ${country} official website` : `"${name}" official website`;
}
