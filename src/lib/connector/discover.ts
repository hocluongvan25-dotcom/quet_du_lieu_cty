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

const WELL_KNOWN_PATHS = ["/contact", "/contact-us", "/pages/contact-us", "/about", "/about-us", "/pages/about-us", "/suppliers", "/pages/suppliers"];

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

export type CandidateLink = { url: string; score: number };

export function collectCandidateLinks(html: string, baseUrl: string, siteDomain: string): CandidateLink[] {
  const anchors = html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi) ?? [];
  const found = new Map<string, number>();

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
    if (SKIP_EXTENSION.test(target.pathname)) return;

    target.hash = "";
    const url = target.toString().replace(/\/$/, "");
    const textMatch = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(anchor);
    const text = (textMatch?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const score = scoreLink(url, text);
    if (score <= 0) return;
    found.set(url, Math.max(found.get(url) ?? 0, score));
  });

  return [...found.entries()].map(([url, score]) => ({ url, score })).sort((a, b) => b.score - a.score);
}

export type DiscoveryPlan = {
  urls: string[];
  skipped: { url: string; reason: string }[];
  robotsFound: boolean;
  homePage?: FetchOutcome;
};

export type DiscoveryOptions = {
  fetchImpl?: typeof fetch;
  maxPages?: number;
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
    queue.push({ url: seedUrl, score: 200 });
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
    queue.push({ url: `${origin}${path}`, score: 40 });
  });

  (options.extraUrls ?? []).forEach((url) => queue.push({ url, score: 200 }));

  const ordered = queue
    .filter((candidate) => !SKIP_PATH.test(new URL(candidate.url).pathname))
    .sort((a, b) => b.score - a.score);

  const urls: string[] = [];
  const seen = new Set<string>();
  const dropReason = (url: string): string | undefined => {
    if (seen.has(url)) return "đã có trong danh sách";
    if (registrableDomain(new URL(url).hostname) !== siteDomain) return "khác tên miền";
    if (!isPathAllowed(robots, new URL(url).pathname)) return "robots.txt chặn";
    return undefined;
  };

  for (const candidate of ordered) {
    if (urls.length >= maxPages) break;
    const reason = dropReason(candidate.url);
    if (reason) {
      if (reason === "robots.txt chặn") skipped.push({ url: candidate.url, reason });
      continue;
    }
    seen.add(candidate.url);
    urls.push(candidate.url);
  }

  return { urls, skipped, robotsFound, homePage };
}
