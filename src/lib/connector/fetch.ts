/**
 * Tải một trang công khai — và chỉ trang công khai.
 *
 * Không đăng nhập, không gửi cookie, không giải CAPTCHA, không đổi user-agent
 * giả để lách chặn. Trang trả 401/403/429 hoặc chuyển hướng tới trang đăng nhập
 * thì dừng lại và ghi nhận, không cố vượt.
 */

import { assertPublicUrl, UnsafeUrlError } from "./safety";

export type FetchOutcome = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  blocked: boolean;
  loginWall: boolean;
  contentType: string;
  body: string;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 3_000_000;
export const DEFAULT_USER_AGENT = "SeekoraBot/0.1 (+public contact discovery; respects robots.txt)";

const LOGIN_PATH = /\/(login|signin|sign-in|auth|account|dang-nhap)(\/|$|\?)/i;

export function looksLikeLoginWall(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOGIN_PATH.test(parsed.pathname) || LOGIN_PATH.test(parsed.search);
  } catch {
    return false;
  }
}

export async function fetchPage(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number; userAgent?: string; guard?: (url: string) => Promise<unknown> } = {},
): Promise<FetchOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const base: FetchOutcome = {
    url,
    finalUrl: url,
    status: 0,
    ok: false,
    blocked: false,
    loginWall: false,
    contentType: "",
    body: "",
  };

  try {
    // Chốt SSRF: chặn trước khi mở kết nối, và chặn cả URL sau khi chuyển hướng.
    const guard = options.guard ?? assertPublicUrl;
    await guard(url);

    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    });

    const finalUrl = response.url || url;
    const contentType = response.headers.get("content-type") ?? "";
    const status = response.status;

    if (status === 401 || status === 403 || status === 429) {
      return { ...base, finalUrl, status, blocked: true, loginWall: looksLikeLoginWall(finalUrl), contentType, reason: `máy chủ trả ${status}` };
    }

    if (!response.ok) {
      return { ...base, finalUrl, status, contentType, reason: `máy chủ trả ${status}` };
    }

    if (!/html|xml|text/i.test(contentType)) {
      return { ...base, finalUrl, status, contentType, reason: `không phải HTML (${contentType || "không rõ content-type"})` };
    }

    const body = await response.text();
    if (body.length > maxBytes) {
      return { ...base, finalUrl, status, contentType, reason: "trang quá lớn" };
    }

    if (looksLikeLoginWall(finalUrl)) {
      return { ...base, finalUrl, status, loginWall: true, contentType, reason: "chuyển hướng tới trang đăng nhập" };
    }

    return { url, finalUrl, status, ok: true, blocked: false, loginWall: false, contentType, body };
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return { ...base, status: 0, blocked: true, reason: `bị chặn vì an toàn: ${error.message}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, status: 0, reason: message.includes("abort") ? "quá thời gian chờ" : message };
  } finally {
    clearTimeout(timer);
  }
}
