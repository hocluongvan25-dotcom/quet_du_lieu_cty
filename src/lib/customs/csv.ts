/**
 * Đọc file CSV của nguồn hải quan — bộ đọc tối thiểu, không phụ thuộc thư viện.
 *
 * File vận đơn của các nhà cung cấp dữ liệu (ImportYeti, Volza, Panjiva…) đều là
 * CSV có ô bọc nháy, vì địa chỉ và mô tả hàng hoá chứa dấu phẩy và xuống dòng.
 * Bộ đọc này theo RFC 4180 ở đúng những chỗ cần thiết:
 *
 *  - ô bọc trong `"…"` được giữ nguyên, kể cả dấu phẩy, xuống dòng, dấu nháy kép;
 *  - `""` trong ô bọc là một dấu nháy kép;
 *  - dòng đầu là tên cột;
 *  - BOM ở đầu file bị bỏ (Excel hay thêm vào);
 *  - CRLF, LF và CR đều được coi là hết dòng.
 *
 * Không tự đoán dấu phân cách: file hải quan luôn dùng dấu phẩy, và đoán sai dấu
 * phân cách là âm thầm cắt sai mọi dòng dữ liệu.
 */

export type ParsedCsv = {
  headers: string[];
  /** Mỗi dòng là mảng ô, đã đủ số cột của header (thiếu thì rỗng). */
  rows: string[][];
};

export function parseCsv(text: string): ParsedCsv {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      endField();
      index += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      endRow();
      // CRLF là một lần xuống dòng, không phải hai.
      index += char === "\r" && input[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Dòng cuối không có ký tự xuống dòng.
  if (field.length > 0 || row.length > 0) endRow();

  const nonEmpty = rows.filter((line) => line.some((cell) => cell.trim().length > 0));
  const headers = (nonEmpty.shift() ?? []).map((cell) => cell.trim());
  const width = headers.length;

  return {
    headers,
    rows: nonEmpty.map((line) => {
      const cells = line.map((cell) => cell.trim());
      while (cells.length < width) cells.push("");
      return cells.slice(0, width);
    }),
  };
}
