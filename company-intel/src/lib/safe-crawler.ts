/**
 * Safe Crawl Sandbox Contract
 *
 * Implements the crawl security requirements from README.md / docs/kich-ban-san-pham.md:
 * - Only http/https allowed
 * - Block private IPs (10/8, 172.16/12, 192.168/16), loopback, link-local, ULA
 * - Block cloud metadata (169.254.169.254, metadata.google.internal, ...)
 * - Block dangerous redirects (must re-check redirect target against url-guard)
 * - Sandbox limits: ≤10s, ≤5MB content, max 2 redirects
 * - NO cookie / user auth forwarding (credentials: 'omit')
 * - No Authorization header from client
 */

import { assertSandboxSafe, SANDBOX_LIMITS, type SecurityResult } from "./url-guard";

export interface CrawlOptions {
  maxContentBytes?: number;
  maxFetchMs?: number;
  maxRedirects?: number;
}

export interface CrawlResult {
  ok: boolean;
  status?: number;
  body?: string;
  truncated?: boolean;
  error?: string;
  redirectBlocked?: boolean;
}

/**
 * Safe fetch for crawl pipeline.
 * Never forwards browser cookies or user credentials to external sources.
 */
export async function safeFetch(
  urlInput: string,
  opts?: CrawlOptions
): Promise<CrawlResult> {
  // 1. Gate: URL security guard
  const gate: SecurityResult = assertSandboxSafe(urlInput);
  if (!gate.safe) {
    return { ok: false, error: gate.reason || "URL không vượt qua kiểm tra bảo mật." };
  }

  const url = gate.url!;
  const maxMs = opts?.maxFetchMs ?? SANDBOX_LIMITS.MAX_FETCH_MS;
  const maxBytes = opts?.maxContentBytes ?? SANDBOX_LIMITS.MAX_CONTENT_BYTES;
  const maxRedirects = opts?.maxRedirects ?? SANDBOX_LIMITS.MAX_REDIRECTS;

  // 2. Sandbox timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), maxMs);

  try {
    // 3. Fetch with explicit no-cookie / no-auth policy
    // redirect: "manual" lets us inspect redirect targets before following
    let currentUrl = url.toString();
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        credentials: "omit", // Critical: never send cookies / auth
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "vi,en;q=0.9",
          "User-Agent": "SeekoraBot/0.1 (+https://seekora.example/robots)",
        },
      });

      // 4. Redirect handling with re-check
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location && redirectCount < maxRedirects) {
          const redirectTarget = new URL(location, new URL(currentUrl)).toString();
          const redirectCheck = assertSandboxSafe(redirectTarget);
          if (!redirectCheck.safe) {
            clearTimeout(timeoutId);
            return {
              ok: false,
              status: response.status,
              error: `Redirect bị chặn: ${redirectCheck.reason}`,
              redirectBlocked: true,
            };
          }
          currentUrl = redirectTarget;
          redirectCount++;
          continue; // follow redirect manually
        } else if (location) {
          // No redirects allowed or missing target
          clearTimeout(timeoutId);
          return {
            ok: false,
            status: response.status,
            error: "Quá số bước redirect cho phép hoặc thiếu địa chỉ đích.",
            redirectBlocked: true,
          };
        }
      }

      // 5. Load response with size guard (stream-based)
      const reader = response.body?.getReader();
      if (!reader) {
        clearTimeout(timeoutId);
        return { ok: true, status: response.status, body: "", truncated: false };
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      let exceeded = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            exceeded = true;
            // Continue draining slightly or just abort reading
            // For simplicity, break out and truncate
            chunks.push(value.subarray(0, Math.max(0, maxBytes - (total - value.byteLength))));
            // We will treat as truncated; do not keep reading forever.
            break;
          }
          chunks.push(value);
        }
      }

      // Combine chunks
      let combinedLength = chunks.reduce((s, c) => s + c.byteLength, 0);
      const combined = new Uint8Array(combinedLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const text = new TextDecoder().decode(combined, { stream: false });

      clearTimeout(timeoutId);
      return {
        ok: true,
        status: response.status,
        body: text,
        truncated: exceeded,
      };
    }

    // Should not reach here; defensive
    clearTimeout(timeoutId);
    return { ok: false, error: "Vượt quá giới hạn redirect." };
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `Crawl vượt quá thời gian sandbox (${maxMs}ms).` };
    }
    return { ok: false, error: `Lỗi crawl: ${(e as Error)?.message || "Không xác định."}` };
  }
}
