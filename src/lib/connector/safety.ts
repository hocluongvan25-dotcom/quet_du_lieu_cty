/**
 * Connector tải URL do người dùng đưa vào, nên phải chặn SSRF: không cho trỏ
 * vào máy chủ nội bộ, loopback, link-local hay endpoint metadata của cloud.
 *
 * Kiểm tra cả tên miền (phân giải DNS) lẫn IP viết thẳng trong URL, vì
 * "http://169.254.169.254/latest/meta-data/" là IP chứ không phải tên miền.
 */

export type LookupAddress = { address: string; family: number };
export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localdomain", ".lan", ".home", ".corp"];

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

/** Dải IPv4 không được phép truy cập. */
export function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === undefined) return false;

  const inRange = (cidr: string, bits: number) => {
    const base = ipv4ToInt(cidr);
    if (base === undefined) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
  };

  return (
    inRange("0.0.0.0", 8) ||
    inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) ||
    inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) || // link-local, gồm 169.254.169.254
    inRange("172.16.0.0", 12) ||
    inRange("192.0.0.0", 24) ||
    inRange("192.168.0.0", 16) ||
    inRange("198.18.0.0", 15) ||
    inRange("224.0.0.0", 4) ||
    inRange("240.0.0.0", 4)
  );
}

/** Dải IPv6 không được phép truy cập. */
export function isBlockedIpv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fe80")) return true; // link-local
  if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique local
  if (value.startsWith("ff")) return true; // multicast
  // IPv4-mapped: ::ffff:127.0.0.1
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedAddress(address: string): boolean {
  return address.includes(":") ? isBlockedIpv6(address) : isBlockedIpv4(address);
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  const dns = await import("node:dns/promises");
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => ({ address: record.address, family: record.family }));
}

/**
 * Ném lỗi nếu URL không được phép tải. `deps.lookup` để test không cần DNS thật.
 */
export async function assertPublicUrl(rawUrl: string, deps: { lookup?: LookupFn } = {}): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`URL không hợp lệ: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError(`Chỉ cho phép http/https, nhận được ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UnsafeUrlError(`Tên miền nội bộ không được phép tải: ${hostname}`);
  }

  // IP viết thẳng trong URL.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (isBlockedAddress(hostname)) throw new UnsafeUrlError(`Địa chỉ nội bộ không được phép tải: ${hostname}`);
    return parsed;
  }

  const lookup = deps.lookup ?? defaultLookup;
  let records: LookupAddress[] = [];
  try {
    records = await lookup(hostname);
  } catch (error) {
    throw new UnsafeUrlError(`Không phân giải được ${hostname}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (records.length === 0) throw new UnsafeUrlError(`Không phân giải được ${hostname}`);
  records.forEach((record) => {
    if (isBlockedAddress(record.address)) {
      throw new UnsafeUrlError(`${hostname} trỏ vào địa chỉ nội bộ (${record.address})`);
    }
  });

  return parsed;
}
