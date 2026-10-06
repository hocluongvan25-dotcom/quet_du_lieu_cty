/**
 * HTML → từng dòng văn bản, giữ nguyên câu chữ trên trang.
 *
 * Bằng chứng (`evidenceSnippet`) phải là câu chữ thật của trang, nên bước này
 * không được tóm tắt, không được viết lại, chỉ được tách dòng và giải mã entity.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  eacute: "é",
  aacute: "á",
  agrave: "à",
  ecirc: "ê",
  ocirc: "ô",
  plusmn: "±",
  times: "×",
  laquo: "«",
  raquo: "»",
  euro: "€",
  pound: "£",
  yen: "¥",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    // Một số trang nhúng JSON escape ngay trong HTML.
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&");
}

const BLOCK_END = /<\/(p|div|li|tr|h1|h2|h3|h4|h5|h6|section|article|header|footer|td|th|ul|ol|table|blockquote|dd|dt|form|label|span|strong|em|b|i|a)>/gi;

/**
 * Trả về mảng dòng: mỗi dòng là một đoạn văn bản đã gộp khoảng trắng.
 * Script/style/svg bị bỏ — chúng chứa mã, không chứa thông tin liên hệ công bố.
 */
export function htmlToLines(html: string): string[] {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const withBreaks = stripped
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_END, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(withBreaks)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/** Toàn bộ văn bản của trang trên một dòng (dùng để tìm mẫu nằm vắt qua nhiều dòng). */
export function htmlToText(html: string): string {
  return htmlToLines(html).join(" | ");
}

/** Registrable domain gần đúng: đủ dùng để phân biệt "cùng công ty" và "bên thứ ba". */
export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  // IP viết thẳng không có "tên miền rút gọn".
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean) || clean.includes(":")) return clean;
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;

  const twoPartTlds = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "com.vn", "co.jp",
    "com.sg", "com.my", "co.th", "com.br", "com.mx", "co.in", "com.tw", "com.hk", "co.kr", "com.cn",
  ]);
  const lastTwo = parts.slice(-2).join(".");
  return twoPartTlds.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}
