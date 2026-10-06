#!/usr/bin/env node
/**
 * Chốt chặn: report là dữ liệu, không phải lời khuyên.
 *
 * Lý do tồn tại script này: một lời khuyên sai không chỉ gây hại ở chỗ nó sai.
 * Nó làm người dùng mất niềm tin vào cả những dữ liệu đúng trong cùng report,
 * vì trên màn hình lời khuyên và dữ liệu trông giống hệt nhau — cùng font,
 * cùng thứ tự, cùng vẻ chắc chắn. Người dùng không có cách nào phân biệt
 * "giá trị này thấy trên nguồn" và "đây là ý kiến của nền tảng".
 *
 * Nên quy tắc: không có trường nào mang tính khuyên bảo trong report.
 * Chạy: npm run check:content
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["src/lib", "src/components"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

const BANNED = [
  { pattern: /\bsellerOffer\b/, label: "xếp hạng theo use case của người bán" },
  { pattern: /\brelevance\s*:/, label: "đoạn 'vì sao nên gặp người này'" },
  { pattern: /\bcaution\s*:/, label: "cảnh báo mang tính khuyên bảo" },
  { pattern: /\bgatekeeper\b/, label: "nhãn 'người gác cửa'" },
  { pattern: /\bplaybook\b/i, label: "cẩm nang bán hàng" },
  { pattern: /\brank\s*:/, label: "xếp hạng đầu mối" },
  { pattern: /\bpriority\s*:/, label: "mức ưu tiên do nền tảng tự đặt" },
  { pattern: /Vì sao\s*:/, label: "câu giải thích nên gặp ai" },
  { pattern: /nên gặp|nên liên hệ|khuyến nghị/i, label: "câu khuyến nghị" },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

let failures = 0;
let scanned = 0;

for (const root of ROOTS) {
  for await (const file of walk(root)) {
    const content = await readFile(file, "utf8");
    scanned += 1;

    // Chỉ soi phần code, bỏ qua dòng bắt đầu bằng * hoặc // (ghi chú giải thích quy tắc).
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

      for (const rule of BANNED) {
        if (rule.pattern.test(line)) {
          failures += 1;
          console.error(`✗ ${file}:${index + 1} — ${rule.label}`);
          console.error(`    ${trimmed.slice(0, 120)}`);
        }
      }
    });
  }
}

if (failures > 0) {
  console.error(`\n${failures} chỗ vi phạm trên ${scanned} file.`);
  console.error("Report chỉ chứa: giá trị tìm được, nguồn, ngày thấy, nhãn tin cậy.");
  console.error("Nếu một trường không trả lời được câu 'giá trị này thấy ở đâu?', nó không thuộc về đây.");
  process.exit(1);
}

console.log(`✓ ${scanned} file: không có trường mang tính khuyên bảo.`);
