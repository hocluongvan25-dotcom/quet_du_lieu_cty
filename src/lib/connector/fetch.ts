/**
 * Tải một trang công khai — và chỉ trang công khai.
 *
 * Không đăng nhập, không gửi cookie, không giải CAPTCHA, không đổi user-agent
 * giả để lách chặn. Trang trả 401/403/429 hoặc chuyển hướng tới trang đăng nhập
 * thì dừng lại và ghi nhận, không cố vượt.
 */

import { assertPublicUrl, UnsafeUrlError } from "./safety";
import { stripDiacritics } from "./phone";

export type FetchKind = "html" | "pdf";

export type FetchOutcome = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  blocked: boolean;
  loginWall: boolean;
  contentType: string;
  /** PDF được giữ nguyên từng byte (chuỗi latin1), không giải mã UTF-8. */
  kind: FetchKind;
  body: string;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 3_000_000;
/** PDF thường nặng hơn trang HTML: báo cáo thường niên vài MB là bình thường. */
const DEFAULT_MAX_PDF_BYTES = 12_000_000;
export const DEFAULT_USER_AGENT = "SeekoraBot/0.1 (+public contact discovery; respects robots.txt)";

/**
 * Làm sạch một giá trị để đưa vào **header HTTP**.
 *
 * Header HTTP là ByteString (Latin-1), không phải UTF-8: một chữ có dấu như `đ`
 * (U+0111 = 273) làm `fetch` ném lỗi ngay **trước khi gửi** —
 * "Cannot convert argument to a ByteString…". Lỗi này đã xảy ra thật: chuỗi
 * User-Agent mặc định cho SEC EDGAR có chữ "đặt", nên việc tra sổ Mỹ chết ngay
 * ở tầng gửi request, và người dùng chỉ thấy một câu lỗi khó hiểu thay vì thấy
 * hướng dẫn đặt `SEC_USER_AGENT`.
 *
 * Vì vậy mọi giá trị header do người dùng cấp đều đi qua đây: bỏ dấu, rồi bỏ
 * nốt những ký tự còn lại không nằm trong khoảng in được của ASCII.
 */
export function asciiHeaderValue(value: string, maxLength = 300): string {
  const cleaned = stripDiacritics(value).replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, maxLength);
}

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
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number; maxPdfBytes?: number; userAgent?: string; guard?: (url: string) => Promise<unknown> } = {},
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
    kind: "html",
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
        "user-agent": asciiHeaderValue(options.userAgent ?? DEFAULT_USER_AGENT),
        accept: "text/html,application/xhtml+xml,application/pdf",
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

    const isPdf = /application\/pdf|application\/x-pdf/i.test(contentType);
    if (!isPdf && !/html|xml|text/i.test(contentType)) {
      return { ...base, finalUrl, status, contentType, reason: `không phải HTML hay PDF (${contentType || "không rõ content-type"})` };
    }

    if (isPdf) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > (options.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES)) {
        return { ...base, finalUrl, status, contentType, kind: "pdf", reason: "file PDF quá lớn" };
      }
      // Giữ nguyên từng byte: giải mã UTF-8 sẽ làm hỏng luồng nén của PDF.
      let body = "";
      for (let index = 0; index < buffer.length; index += 8192) {
        body += String.fromCharCode(...Array.from(buffer.subarray(index, index + 8192)));
      }
      return { url, finalUrl, status, ok: true, blocked: false, loginWall: false, contentType, kind: "pdf", body };
    }

    const body = await response.text();
    if (body.length > maxBytes) {
      return { ...base, finalUrl, status, contentType, reason: "trang quá lớn" };
    }

    if (looksLikeLoginWall(finalUrl)) {
      return { ...base, finalUrl, status, loginWall: true, contentType, reason: "chuyển hướng tới trang đăng nhập" };
    }

    return { url, finalUrl, status, ok: true, blocked: false, loginWall: false, contentType, kind: "html", body };
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
