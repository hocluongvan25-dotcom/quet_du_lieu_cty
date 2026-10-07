/**
 * Chuẩn hoá tên, quốc gia, vai, và con số từ file hải quan.
 *
 * Nguyên tắc giống mọi phần khác của dự án: **giữ nguyên bản in, tạo bản sao để
 * tra**. Tên công ty được giữ y như tờ khai in (`name_as_printed`) và có thêm bản
 * chuẩn hoá (`name_normalized`) chỉ dùng để so khớp. Không bao giờ hiển thị bản
 * chuẩn hoá cho người dùng, và không bao giờ ghi đè bản in.
 */

import { registrableDomain } from "@/lib/connector/html";
import { resolveCountry, stripDiacritics } from "@/lib/connector/phone";

export type CustomsPartyRole = "importer" | "consignee" | "shipper" | "notify_party" | "other";
export type CustomsSide = "importer_side" | "exporter_side" | "unknown";

export const CUSTOMS_PARTY_ROLES: CustomsPartyRole[] = ["importer", "consignee", "shipper", "notify_party", "other"];

/**
 * Vai → bên của giao dịch. Bản sao của `public.customs_side_for` trong migration
 * 012 (test đối chiếu hai bản khớp nhau).
 *
 * `notify_party` cố ý để `unknown`: bên được thông báo có thể là hãng tàu, ngân
 * hàng, hoặc đại lý hải quan — suy ra bên mua từ đó là đoán.
 */
export function customsSideFor(role: CustomsPartyRole): CustomsSide {
  if (role === "importer" || role === "consignee") return "importer_side";
  if (role === "shipper") return "exporter_side";
  return "unknown";
}

/**
 * Hậu tố pháp nhân, bỏ đi khi so khớp. "ACME FOODS LTD" và "Acme Foods Limited"
 * là cùng một công ty; nhưng bản in vẫn giữ nguyên trong `name_as_printed`.
 */
const LEGAL_SUFFIXES = [
  "co", "company", "corp", "corporation", "incorporated", "inc", "limited", "ltd", "llc", "llp", "lp", "plc", "pllc",
  "gmbh", "mbh", "ag", "kg", "ug", "ohg", "eg", "bv", "nv", "cv", "sa", "sas", "sarl", "srl", "spa", "snc",
  "ab", "as", "asa", "aps", "oy", "oyj", "a/s", "pte", "pte ltd", "sdn bhd", "bhd", "sdn",
  "jsc", "js company", "joint stock company", "joint stock co", "cp", "cpt", "pt", "tbk", "kk", "yk",
  "sac", "eirl", "sl", "slu", "srl unipersonale", "unipessoal", "lda", "cia", "limitada", "ltda",
];

/**
 * Hình thức pháp nhân đứng **trước** tên, kiểu Việt Nam: "Công ty TNHH Thực phẩm
 * X", "Công ty Cổ phần Y". Bỏ phần này đi khi so khớp, vì tên riêng nằm sau nó.
 */
const LEGAL_PREFIXES = [
  "cong ty tnhh mtv",
  "cong ty tnhh",
  "cong ty co phan",
  "cong ty cp",
  "cong ty",
  "cty tnhh",
  "cty",
  "tnhh mtv",
  "tnhh",
  "ctcp",
  "doanh nghiep tu nhan",
  "dntn",
];

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function suffixPattern(): RegExp {
  // Sắp xếp dài trước để "pte ltd" không bị "pte" ăn mất phần còn lại.
  const ordered = [...LEGAL_SUFFIXES].sort((a, b) => b.length - a.length).map(escape);
  return new RegExp(`[\\s,.-]+(?:${ordered.join("|")})\\.?$`, "i");
}

function prefixPattern(): RegExp {
  const ordered = [...LEGAL_PREFIXES].sort((a, b) => b.length - a.length).map(escape);
  return new RegExp(`^(?:${ordered.join("|")})[\\s,.-]+`, "i");
}

/**
 * Tên chuẩn hoá để so khớp: bỏ dấu, viết thường, bỏ dấu câu, gộp khoảng trắng,
 * bỏ hình thức pháp nhân ở **đầu** ("Công ty TNHH …") và ở **cuối**
 * ("… Co Ltd"). Lặp cho tới khi hết, vì tên thật có thể có cả hai.
 */
export function normalizeCompanyName(raw: string): string {
  let text = stripDiacritics((raw ?? "").toLowerCase())
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const suffix = suffixPattern();
  const prefix = prefixPattern();
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(suffix, "").replace(prefix, "").trim();
  }
  return text;
}

/** Các từ khoá của tên, đã bỏ từ vô nghĩa để so khớp. */
export function nameTokens(normalized: string): string[] {
  const stop = new Set(["the", "and", "of", "for", "de", "la", "el", "y", "và", "cong", "ty", "congty"]);
  return [...new Set(normalized.split(" ").filter((token) => token.length > 1 && !stop.has(token)))];
}

/**
 * Độ giống giữa hai tên đã chuẩn hoá: tỉ lệ token chung trên tổng token (Jaccard).
 * Chỉ dùng để **xếp hạng ứng viên**, không bao giờ để tự nối — hai công ty khác
 * nhau hoàn toàn có thể có tên gần giống.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = nameTokens(left);
  const b = nameTokens(right);
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((token) => setB.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

/** Tên miền đã chuẩn hoá từ một giá trị trong file ("https://www.acme.com/a" → "acme.com"). */
export function declaredDomain(raw?: string | null): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host.includes(".")) return null;
    return registrableDomain(host) || host;
  } catch {
    return null;
  }
}

/** Quốc gia → mã ISO-2 khi nhận ra. Không nhận ra thì trả null, không đoán. */
export function countryIso2(raw?: string | null): string | null {
  const country = resolveCountry(raw ?? null);
  return country?.iso2 ?? null;
}

/**
 * Con số từ file hải quan: "18,240.50 kg" → 18240.5. Dấu phân cách nghìn kiểu
 * châu Âu ("18.240,50") cũng đọc được. Không đọc được thì trả null — không đoán.
 */
export function parseNumber(raw?: string | null): number | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const cleaned = text.replace(/[^0-9.,\-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    // Cái nào đứng sau là dấu thập phân.
    normalized = lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Chỉ có dấu phẩy: 1.234,5 kiểu châu Âu hay 1,234.5 kiểu Anh? Nhìn số chữ số
    // sau dấu phẩy: đúng 3 chữ số và không có phần thập phân khác → phân cách nghìn.
    const afterComma = cleaned.length - lastComma - 1;
    normalized = afterComma === 3 && /^\d{1,3}(,\d{3})+$/.test(cleaned) ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Thứ tự ngày/tháng của file. `auto` = chỉ đọc khi không thể lẫn. */
export type DateOrder = "auto" | "dmy" | "mdy";

export type DateParse =
  | { ok: true; value: string }
  /** Ngày đọc được chữ nhưng không chắc thứ tự ngày/tháng — không đoán. */
  | { ok: false; ambiguous: true }
  | { ok: false; ambiguous: false };

/**
 * Ngày từ file hải quan. Ba trường hợp:
 *
 *  - ISO (`2026-05-12`) hoặc ngày có tên tháng (`12 May 2026`) → đọc chắc chắn;
 *  - dạng số có một phần > 12 (`05/13/2026`) → tự biết phần nào là ngày;
 *  - `05/03/2026` — **không đoán**. Trả về `ambiguous`, và người nhập chọn thứ
 *    tự bằng `dateOrder` khi biết file của mình dùng kiểu nào.
 *
 * Lý do không mặc định ngày trước hay tháng trước: một ngày sai trong báo cáo
 * lịch sử nhập khẩu là một khẳng định sai về hoạt động của công ty người ta.
 */
export function parseShipmentDate(raw: string | null | undefined, order: DateOrder = "auto"): DateParse {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, ambiguous: false };

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return { ok: true, value: `${iso[1]}-${iso[2]}-${iso[3]}` };

  const slashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    const year = slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3];
    if (Number(year) < 1900 || Number(year) > 2200) return { ok: false, ambiguous: false };

    const make = (day: number, month: number) =>
      day >= 1 && day <= 31 && month >= 1 && month <= 12
        ? ({ ok: true, value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` } as const)
        : ({ ok: false, ambiguous: false } as const);

    if (first > 12) return make(first, second);
    if (second > 12) return make(second, first);

    if (order === "dmy") return make(first, second);
    if (order === "mdy") return make(second, first);
    return { ok: false, ambiguous: true };
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    if (year < 1900 || year > 2200) return { ok: false, ambiguous: false };
    return { ok: true, value: `${year}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}` };
  }

  return { ok: false, ambiguous: false };
}
