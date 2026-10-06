/**
 * Chọn trang để đọc: chỉ trong cùng website, chỉ trang công khai, ưu tiên trang
 * liên hệ / nhà cung cấp / giới thiệu. Không bám theo mạng xã hội, không đi ra
 * ngoài tên miền, không đọc trang trong robots.txt bị chặn.
 */

import { fetchPage, type FetchOutcome } from "./fetch";
import { registrableDomain } from "./html";
import { isPathAllowed, parseRobots, type RobotsRules } from "./robots";

/** Trang thường chứa thông tin liên hệ, xếp theo mức liên quan. */
const LINK_KEYWORDS: { pattern: RegExp; score: number }[] = [
  { pattern: /contact|liên hệ|lien-he/i, score: 100 },
  { pattern: /supplier|vendor|procurement|purchas|sourcing|nhà cung cấp/i, score: 90 },
  { pattern: /about|company|giới thiệu|ve-chung-toi/i, score: 70 },
  { pattern: /ingredient|bulk|wholesale|export|b2b|distributor/i, score: 60 },
  { pattern: /team|people|leadership|management|our-team/i, score: 50 },
  { pattern: /career|job|tuyển dụng/i, score: 20 },
];

const WELL_KNOWN_PATHS = [
  "/contact",
  "/contact-us",
  "/pages/contact-us",
  "/about",
  "/about-us",
  "/pages/about-us",
  "/suppliers",
  "/pages/suppliers",
  "/supplier",
  "/vendor",
  "/vendors",
  "/procurement",
  "/purchasing",
  "/sourcing",
  "/become-a-supplier",
  "/supplier-registration",
  "/press",
  "/press-releases",
  "/news",
  "/newsroom",
  "/media",
  "/investors",
  "/investor-relations",
  "/annual-report",
  "/certifications",
  "/quality",
  "/catalogue",
  "/catalog",
];

/**
 * Tài liệu (PDF) là nơi chứa thứ trang HTML không có: báo cáo thường niên,
 * press release, catalogue, hướng dẫn nhà cung cấp. Chỉ lấy PDF cùng tên miền,
 * và chỉ khi tên file/đường dẫn cho thấy nó liên quan.
 */
const DOCUMENT_KEYWORDS: { pattern: RegExp; score: number }[] = [
  { pattern: /supplier|vendor|procurement|purchas|sourcing/i, score: 110 },
  { pattern: /annual[-_ ]?report|10-?k|investor|financial|results/i, score: 90 },
  { pattern: /press|news|release|media|announce/i, score: 70 },
  { pattern: /catalog(ue)?|brochure|product[-_ ]?list|specification|spec[-_ ]?sheet/i, score: 60 },
  { pattern: /certificat|quality|sustainab|policy|compliance/i, score: 50 },
  { pattern: /contact|company[-_ ]?profile|about/i, score: 40 },
];

const SKIP_PATH = /\/(cart|checkout|account|login|signin|wishlist|collections|products|shop|blog|news|recipes|privacy|terms|policies|search)\b/i;
const SKIP_EXTENSION = /\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|zip|mp4|mp3|ico|woff2?)$/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeSeed(input: string): string {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function scoreLink(href: string, text: string): number {
  const haystack = `${href} ${text}`;
  let score = 0;
  LINK_KEYWORDS.forEach(({ pattern, score: value }) => {
    if (pattern.test(haystack)) score = Math.max(score, value);
  });
  return score;
}

export type CandidateLink = { url: string; score: number; kind: "page" | "document" };

export function scoreDocument(url: string, text: string): number {
  const haystack = `${url} ${text}`;
  let score = 0;
  DOCUMENT_KEYWORDS.forEach(({ pattern, score: value }) => {
    if (pattern.test(haystack)) score = Math.max(score, value);
  });
  return score;
}

export function collectCandidateLinks(html: string, baseUrl: string, siteDomain: string): CandidateLink[] {
  const anchors = html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi) ?? [];
  const found = new Map<string, CandidateLink>();

  anchors.forEach((anchor) => {
    const hrefMatch = /href=["']([^"']+)["']/i.exec(anchor);
    if (!hrefMatch) return;
    const href = hrefMatch[1].trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;

    let target: URL;
    try {
      target = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!/^https?:$/i.test(target.protocol)) return;
    if (registrableDomain(target.hostname) !== siteDomain) return;

    const isDocument = /\.pdf$/i.test(target.pathname);
    if (!isDocument && SKIP_EXTENSION.test(target.pathname)) return;

    target.hash = "";
    const url = target.toString().replace(/\/$/, "");
    const textMatch = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(anchor);
    const text = (textMatch?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (isDocument) {
      const score = scoreDocument(url, text);
      if (score <= 0) return;
      const current = found.get(url);
      if (!current || current.score < score) found.set(url, { url, score, kind: "document" });
      return;
    }

    const score = scoreLink(url, text);
    if (score <= 0) return;
    const current = found.get(url);
    if (!current || current.score < score) found.set(url, { url, score, kind: "page" });
  });

  return [...found.values()].sort((a, b) => b.score - a.score);
}

export type DiscoveryPlan = {
  urls: string[];
  /** PDF cùng tên miền, xếp theo mức liên quan — đọc sau các trang HTML. */
  documents: string[];
  skipped: { url: string; reason: string }[];
  robotsFound: boolean;
  homePage?: FetchOutcome;
};

export type DiscoveryOptions = {
  fetchImpl?: typeof fetch;
  maxPages?: number;
  maxDocuments?: number;
  userAgent?: string;
  extraUrls?: string[];
  log?: (message: string) => void;
  /** Chốt an toàn SSRF; mặc định là assertPublicUrl, test truyền hàm rỗng. */
  guard?: (url: string) => Promise<unknown>;
};

/** Lập kế hoạch đọc: tải robots.txt, tải trang chủ, chọn các trang cùng miền. */
export async function planDiscovery(seedUrl: string, options: DiscoveryOptions = {}): Promise<DiscoveryPlan> {
  const maxPages = options.maxPages ?? 6;
  const log = options.log ?? (() => {});
  const seed = new URL(seedUrl);
  const siteDomain = registrableDomain(seed.hostname);
  const origin = seed.origin;

  let robots: RobotsRules = { allow: [], disallow: [], hasRules: false };
  let robotsFound = false;
  const robotsUrl = `${origin}/robots.txt`;
  const robotsOutcome = await fetchPage(robotsUrl, { fetchImpl: options.fetchImpl, userAgent: options.userAgent, guard: options.guard, maxBytes: 200_000 });
  if (robotsOutcome.ok) {
    robots = parseRobots(robotsOutcome.body, "*");
    robotsFound = true;
    log(`robots.txt: ${robots.disallow.length} Disallow, ${robots.allow.length} Allow`);
  } else {
    log(`robots.txt: không đọc được (${robotsOutcome.reason ?? "không rõ"}) — chỉ đọc trang công khai, không đăng nhập`);
  }

  const skipped: { url: string; reason: string }[] = [];
  const queue: CandidateLink[] = [];

  // Trang người dùng đưa vào (nếu có đường dẫn cụ thể) luôn được ưu tiên cao nhất.
  if (seed.pathname && seed.pathname !== "/") {
    // Người dùng có thể đưa thẳng một file PDF làm điểm bắt đầu.
    queue.push({ url: seedUrl, score: 200, kind: /\.pdf$/i.test(seed.pathname) ? "document" : "page" });
  }

  const homeUrl = `${origin}/`;
  const homeOutcome = await fetchPage(homeUrl, { fetchImpl: options.fetchImpl, userAgent: options.userAgent, guard: options.guard });
  let homePage: FetchOutcome | undefined;

  if (homeOutcome.ok) {
    homePage = homeOutcome;
    collectCandidateLinks(homeOutcome.body, homeOutcome.finalUrl, siteDomain).forEach((candidate) => queue.push(candidate));
  } else {
    skipped.push({ url: homeUrl, reason: homeOutcome.reason ?? "không tải được" });
    log(`trang chủ: không tải được (${homeOutcome.reason ?? "không rõ"})`);
  }

  WELL_KNOWN_PATHS.forEach((path) => {
    queue.push({ url: `${origin}${path}`, score: 40, kind: "page" });
  });

  (options.extraUrls ?? []).forEach((url) => queue.push({ url, score: 200, kind: /\.pdf$/i.test(url) ? "document" : "page" }));

  const dropReason = (candidate: CandidateLink, seen: Set<string>): string | undefined => {
    if (seen.has(candidate.url)) return "đã có trong danh sách";
    if (registrableDomain(new URL(candidate.url).hostname) !== siteDomain) return candidate.kind === "document" ? "tài liệu khác tên miền" : "khác tên miền";
    if (!isPathAllowed(robots, new URL(candidate.url).pathname)) return "robots.txt chặn";
    if (candidate.kind === "document" && !/\.pdf$/i.test(new URL(candidate.url).pathname)) return "không phải PDF";
    return undefined;
  };

  const pick = (kind: CandidateLink["kind"], limit: number): string[] => {
    const chosen: string[] = [];
    const seen = new Set<string>();
    const ordered = queue
      .filter((candidate) => candidate.kind === kind)
      .filter((candidate) => kind === "document" || !SKIP_PATH.test(new URL(candidate.url).pathname))
      .sort((a, b) => b.score - a.score);

    for (const candidate of ordered) {
      if (chosen.length >= limit) break;
      const reason = dropReason(candidate, seen);
      if (reason) {
        if (reason === "robots.txt chặn" || reason === "tài liệu khác tên miền") skipped.push({ url: candidate.url, reason });
        continue;
      }
      seen.add(candidate.url);
      chosen.push(candidate.url);
    }
    return chosen;
  };

  const urls = pick("page", maxPages);
  // Tài liệu bị giới hạn riêng và ít hơn: PDF nặng hơn trang HTML.
  const documents = pick("document", options.maxDocuments ?? 3);

  return { urls, documents, skipped, robotsFound, homePage };
}
