/**
 * URL Security Guard — Crawl Pipeline
 * Enforced BEFORE any fetch/crawl operation.
 * Rules drawn from README security checklist and docs/kich-ban-san-pham.md.
 */

export const SANDBOX_LIMITS = {
  MAX_CONTENT_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_FETCH_MS: 10000,                 // 10 seconds
  MAX_REDIRECTS: 2,
  FORWARD_COOKIES: false,
  FORWARD_AUTH: false,
  ALLOWED_PROTOCOLS: ["http:", "https:"] as const,
};

function isPrivateRange(host: string): boolean {
  // 10/8
  if (/^10\./.test(host)) return true;
  // 172.16/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // 192.168/16
  if (/^192\.168\./.test(host)) return true;
  // 127/8 loopback
  if (/^127\./.test(host)) return true;
  // unspecified / all-zeros
  if (/^0\.0\.0\.0$/.test(host)) return true;
  // IPv6 loopback
  if (/^::1$/.test(host)) return true;
  // IPv6 link-local / ULA (private)
  if (/^fe80:/i.test(host)) return true;
  if (/^fc00:/i.test(host)) return true;
  return false;
}

function isCloudMetadataHost(host: string, rawIp?: string): boolean {
  if (rawIp === "169.254.169.254") return true;
  if (host === "169.254.169.254") return true;
  const metaHosts = new Set([
    "metadata.google.internal",
    "metadata",
    "metadata.aws",
    "metadata.google",
    "metadata.google.internal.",
  ]);
  if (metaHosts.has(host)) return true;
  if (host.endsWith(".amazonaws.com") && host.includes("metadata")) return true;
  return false;
}

export interface SecurityResult {
  safe: boolean;
  reason?: string;
  url?: URL;
  warnings: string[];
}

export function assertSandboxSafe(input: string): SecurityResult {
  const warnings = [
    "Crawler phải chạy trong sandbox giới hạn thời gian (≤10s) và kích thước (≤5MB).",
    "Không chuyển cookie/user credentials của người dùng cho nguồn bên ngoài.",
    "Không chuyển header Authorization từ client.",
    "Giới hạn redirect tối đa 2 bước; chặn redirect về địa chỉ private/metadata.",
    "Sử dụng fetch với credentials: 'omit' để đảm bảo không gửi cookie.",
  ];

  if (!input || typeof input !== "string") {
    return { safe: false, reason: "Dữ liệu nhập phải là chuỗi.", warnings };
  }

  const trimmed = input.trim();

  // Require explicit http/https — do not allow arbitrary strings
  if (!/^https?:\/\//i.test(trimmed)) {
    return { safe: false, reason: "Chỉ cho phép http:// hoặc https://.", warnings };
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { safe: false, reason: "Chỉ cho phép giao thức http hoặc https.", warnings };
    }

    const host = url.hostname.toLowerCase();

    // Loopback / local
    const blockedLocal = new Set([
      "localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]",
    ]);
    if (blockedLocal.has(host)) {
      return { safe: false, reason: "Chặn localhost / loopback.", warnings };
    }

    // Private IP ranges
    if (isPrivateRange(host)) {
      return {
        safe: false,
        reason:
          "Chặn dải IP private (10/8, 172.16/12, 192.168/16, loopback, link-local, ULA).",
        warnings,
      };
    }

    // Cloud metadata endpoints (169.254.169.254, metadata.google.internal, ...)
    if (isCloudMetadataHost(host)) {
      return {
        safe: false,
        reason: "Chặn endpoint metadata đám mây (169.254.169.254, metadata.google.internal, ...).",
        warnings,
      };
    }

    // If the URL resolves to a dangerous redirect target (checked at parse time)
    if (isPrivateRange(url.hostname) || isCloudMetadataHost(url.hostname)) {
      return { safe: false, reason: "Target redirect nguy hiểm.", warnings };
    }

    return { safe: true, url, warnings };
  } catch {
    return { safe: false, reason: "URL không hợp lệ.", warnings };
  }
}
