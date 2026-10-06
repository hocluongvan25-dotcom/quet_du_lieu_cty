/**
 * PDF công khai → từng dòng văn bản.
 *
 * Nhiều thứ quan trọng chỉ nằm trong PDF: báo cáo thường niên, press release,
 * catalogue, tài liệu hướng dẫn nhà cung cấp, danh sách ban điều hành. Không đọc
 * được PDF thì mất đúng phần dữ liệu mà trang HTML không có.
 *
 * Nguyên tắc giống hệt phần HTML: **chỉ lấy chữ có trong file**, không suy diễn.
 * Vì vậy hàm này trả về `ok: false` kèm lý do khi không đọc được (PDF scan ảnh,
 * font nhúng mã hoá riêng, file bị mã hoá) — để connector ghi lại "không đọc được"
 * chứ không đoán.
 *
 * Giới hạn đã biết: PDF ở dạng ảnh (scan) không có lớp chữ thì không đọc được;
 * font dùng bảng mã riêng (CID) có thể ra chữ sai — khi đó hàm trả ok=false thay
 * vì trả về chữ rác.
 */

export type PdfText = {
  ok: boolean;
  lines: string[];
  /** Số luồng nội dung giải nén được bằng zlib. */
  compressedStreams: number;
  /** Số luồng đọc thẳng (không nén). */
  plainStreams: number;
  reason?: string;
};

/** Chuỗi PDF: bỏ escape theo đúng cú pháp chuỗi của đặc tả PDF. */
export function unescapePdfString(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = input[index + 1];
    if (next === undefined) break;
    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "\n") {
      // Dấu xuống dòng sau "\" chỉ là ngắt dòng của file, không phải ký tự.
    } else if (/[0-7]/.test(next)) {
      const octal = input.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? "";
      output += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length - 1;
    } else {
      // \( \) \\ và mọi ký tự khác đều là chính nó.
      output += next;
    }
    index += 1;
  }
  return output;
}

/** Chuỗi hex `<48656c6c6f>` → chữ. BOM UTF-16BE thì giải mã hai byte một. */
export function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes: number[] = [];
  for (let index = 0; index < even.length; index += 2) bytes.push(Number.parseInt(even.slice(index, index + 2), 16));

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    return text;
  }
  return bytes.map((byte) => String.fromCharCode(byte)).join("");
}

/** Có phải PDF thật không (đọc theo magic number, không tin content-type). */
export function looksLikePdf(bytes: Uint8Array | string): boolean {
  const head = typeof bytes === "string" ? bytes.slice(0, 5) : String.fromCharCode(...Array.from(bytes.slice(0, 5)));
  return head.startsWith("%PDF-");
}

function toLatin1String(input: Uint8Array | string): string {
  if (typeof input === "string") return input;
  const chunk = 8192;
  let output = "";
  for (let index = 0; index < input.length; index += chunk) {
    output += String.fromCharCode(...Array.from(input.subarray(index, index + chunk)));
  }
  return output;
}

/**
 * Bỏ đúng một dấu xuống dòng ở cuối luồng: theo đặc tả PDF, EOL ngay trước
 * `endstream` không thuộc dữ liệu. Nhiều bộ giải nén (DecompressionStream) báo
 * lỗi "trailing junk" nếu còn byte thừa này.
 */
function trimStreamEnd(stream: string): string {
  return stream.replace(/\r?\n$/, "");
}

/** Giải nén một luồng FlateDecode; thử zlib của Node trước, rồi tới Web API. */
async function inflate(raw: Uint8Array): Promise<Uint8Array | null> {
  // Node: zlib chấp nhận cả luồng có byte thừa và cả dạng thô/zlib.
  try {
    const zlib = await import("node:zlib");
    for (const attempt of ["inflateSync", "inflateRawSync"] as const) {
      try {
        const output = zlib[attempt](Buffer.from(raw));
        if (output.byteLength > 0) return new Uint8Array(output);
      } catch {
        // thử kiểu kế tiếp
      }
    }
  } catch {
    // không phải môi trường Node (hoặc zlib không có): đi tiếp bằng Web API
  }

  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Blob([new Uint8Array(raw)]).stream().pipeThrough(new DecompressionStream(format));
      const buffer = await new Response(stream).arrayBuffer();
      if (buffer.byteLength > 0) return new Uint8Array(buffer);
    } catch {
      // thử định dạng kế tiếp
    }
  }
  return null;
}

/**
 * Đọc chữ từ các toán tử văn bản của luồng nội dung: `Tj`, `TJ`, `'`, `"`.
 * `Td`, `TD`, `T*`, `ET` và `BT` được coi là ngắt dòng — đúng với cách các trình
 * tạo PDF thường xuống dòng.
 */
function textFromContentStream(content: string): string[] {
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    const line = current.replace(/\s+/g, " ").trim();
    if (line.length > 0) lines.push(line);
    current = "";
  };

  const TOKEN = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[[^\]]*\]|\bT[jJdD*\"]|\bTd\b|\bTD\b|\bET\b|\bBT\b|-?\d+(?:\.\d+)?/g;
  let match = TOKEN.exec(content);

  while (match) {
    const token = match[0];

    if (token.startsWith("(")) {
      current += unescapePdfString(token.slice(1, -1));
    } else if (token.startsWith("<") && !token.startsWith("<</")) {
      current += decodePdfHexString(token.slice(1, -1));
    } else if (token.startsWith("[")) {
      // Mảng TJ: chuỗi xen kẽ số căn chỉnh; số âm lớn là khoảng trắng giữa chữ.
      const inner = token.slice(1, -1);
      const parts = inner.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|-?\d+(?:\.\d+)?/g) ?? [];
      parts.forEach((part) => {
        if (part.startsWith("(")) current += unescapePdfString(part.slice(1, -1));
        else if (part.startsWith("<")) current += decodePdfHexString(part.slice(1, -1));
        else if (Number.parseFloat(part) <= -100) current += " ";
      });
    } else if (/^(-?\d|Td|TD|T\*|ET|BT|Tj|TJ|'|")/.test(token)) {
      // Số hoặc toán tử dịch chuyển: các toán tử ngắt dòng thì chốt dòng lại.
      if (/^(Td|TD|ET|BT|T\*|'|")$/.test(token)) flush();
    }

    match = TOKEN.exec(content);
  }

  flush();
  return lines;
}

/**
 * Đọc PDF thành các dòng chữ. Không đọc được thì trả `ok: false` kèm lý do —
 * connector ghi lại lý do đó, không suy diễn giá trị.
 */
export async function pdfToLines(input: Uint8Array | string): Promise<PdfText> {
  const raw = toLatin1String(input);
  if (!looksLikePdf(raw)) {
    return { ok: false, lines: [], compressedStreams: 0, plainStreams: 0, reason: "không phải PDF" };
  }
  if (/\/Encrypt\b/.test(raw)) {
    return { ok: false, lines: [], compressedStreams: 0, plainStreams: 0, reason: "PDF có mật khẩu/mã hoá" };
  }

  const streams: string[] = [];
  const streamRe = /stream\r?\n?([\s\S]*?)endstream/g;
  let match = streamRe.exec(raw);
  while (match) {
    streams.push(match[1]);
    match = streamRe.exec(raw);
  }
  if (streams.length === 0) {
    return { ok: false, lines: [], compressedStreams: 0, plainStreams: 0, reason: "không thấy luồng nội dung" };
  }

  const lines: string[] = [];
  let compressed = 0;
  let plain = 0;

  for (const rawStream of streams) {
    const stream = trimStreamEnd(rawStream);
    const bytes = Uint8Array.from(stream, (char) => char.charCodeAt(0) & 0xff);
    let content: string | null = null;

    const inflated = await inflate(bytes);
    if (inflated) {
      compressed += 1;
      content = toLatin1String(inflated);
    } else if (/Tj|TJ|\bBT\b/.test(stream)) {
      // Một số PDF để luồng chữ ở dạng không nén.
      plain += 1;
      content = stream;
    }

    if (!content) continue;
    if (!/BT|Tj|TJ/.test(content)) continue;
    lines.push(...textFromContentStream(content));
  }

  if (lines.length === 0) {
    return {
      ok: false,
      lines: [],
      compressedStreams: compressed,
      plainStreams: plain,
      reason:
        compressed + plain === 0
          ? "luồng nội dung được nén bằng kiểu khác (không phải Flate) hoặc PDF ở dạng ảnh scan"
          : "có luồng chữ nhưng không đọc được chuỗi nào — nhiều khả năng là PDF scan hoặc font dùng bảng mã riêng",
    };
  }

  return { ok: true, lines, compressedStreams: compressed, plainStreams: plain };
}
