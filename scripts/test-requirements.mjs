#!/usr/bin/env node
/**
 * Kiểm phần "Điều kiện & giấy tờ nhà cung cấp phải đáp ứng".
 *
 * Điều phải đúng, theo thứ tự quan trọng:
 *  1. Không bịa: câu không phải yêu cầu thì không được thành mục nào.
 *  2. Giữ nguyên câu chữ của nhà nhập khẩu — đó là bằng chứng, không được viết lại.
 *  3. Mỗi mục có nguồn (trang hay file PDF đã thấy nó).
 *  4. Chứng nhận của chính nhà nhập khẩu ("chúng tôi đạt BRCGS") không bị đọc
 *     thành yêu cầu đối với nhà cung cấp.
 *  5. Gạch đầu dòng nằm dưới tiêu đề "Supplier requirements" vẫn được tính, dù
 *     bản thân dòng đó không có chữ "must/required".
 *
 * Chạy: npm run requirements:test
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const workDir = path.join(root, ".requirements-test");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const entry = `export * from "@/lib/requirements";\nexport { extractFromPage, extractFromLines } from "@/lib/connector/extract";\nexport { resultToRequirements } from "@/lib/connector/to-report";\n`;
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const bundlePath = path.join(workDir, "bundle.mjs");
await writeFile(path.join(workDir, "entry.ts"), entry, "utf8");

const build = spawnSync(
  "npx",
  ["--no-install", "esbuild", path.join(workDir, "entry.ts"), "--bundle", "--platform=node", "--format=esm", "--alias:@=./src", `--outfile=${bundlePath}`, "--log-level=warning"],
  { cwd: root, encoding: "utf8" },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}

const api = await import(pathToFileURL(bundlePath).href);

// ---------------------------------------------------------------------------
// Nguồn thử: một trang "Supplier requirements" điển hình của nhà nhập khẩu Mỹ.
// ---------------------------------------------------------------------------
const supplierPage = `<!doctype html><html><body>
<h1>Become a supplier</h1>
<p>We are BRCGS certified and proud of our own food safety record.</p>
<h2>Supplier requirements</h2>
<ul>
  <li>BRCGS certification, grade A or above</li>
  <li>HACCP plan and a current certificate of analysis for every lot</li>
  <li>Product liability insurance of at least 1 million USD</li>
</ul>
<p>All suppliers must comply with our allergen labelling policy and provide a certificate of origin with each shipment.</p>
<p>A third-party audit may be required before approval.</p>
<p>Our minimum order quantity is one container and payment terms are net 30 days.</p>
<p>We love dried fruit and have been in business since 1906.</p>
<p>Contact our procurement team at procurement@example.com.</p>
</body></html>`;

// ---------------------------------------------------------------------------
section("Chỉ lấy câu thật sự là yêu cầu");
const page = api.extractFromPage({ url: "https://buyer.test/suppliers", html: supplierPage });
const labels = page.requirements.map((item) => item.label);

check("lấy được gạch đầu dòng dưới tiêu đề 'Supplier requirements'", labels.includes("Chứng nhận BRCGS") && labels.includes("HACCP"), labels.join(", "));
check("lấy được câu có 'must ... provide'", labels.includes("Yêu cầu nhãn mác") && labels.includes("Giấy chứng nhận xuất xứ (COO)"), labels.join(", "));
check("lấy được giấy tờ theo lô hàng (COA)", labels.includes("Giấy phân tích chất lượng (COA)"));
check("lấy được bảo hiểm trách nhiệm sản phẩm", labels.includes("Bảo hiểm trách nhiệm sản phẩm"));
check("lấy được audit bên thứ ba", labels.includes("Chịu kiểm tra của bên thứ ba"));
check("lấy được điều khoản thương mại (MOQ, thanh toán)", labels.includes("Số lượng đặt tối thiểu (MOQ)") && labels.includes("Điều khoản thanh toán"));
check("KHÔNG lấy câu giới thiệu chung", !page.requirements.some((item) => item.detail.includes("We love dried fruit")));
check("KHÔNG lấy dòng liên hệ", !page.requirements.some((item) => item.detail.includes("procurement@example.com")));

section("Chứng nhận của chính nhà nhập khẩu không thành yêu cầu");
const ownCert = api.findRequirements({
  url: "https://buyer.test/about",
  lines: ["We are BRCGS certified since 1998.", "Our plant holds ISO 9001 and SQF certificates."],
});
check("câu 'chúng tôi đạt X' bị bỏ qua", ownCert.length === 0, ownCert.map((item) => item.detail).join(" / "));
const ownCertWithCue = api.findRequirements({
  url: "https://buyer.test/about",
  lines: ["Our own facility is audited to BRCGS standard."],
});
check("câu có chữ 'audited' nhưng nói về chính họ vẫn không phải yêu cầu nhà cung cấp", ownCertWithCue.length === 0, ownCertWithCue.map((item) => item.label).join(", "));

section("Bằng chứng và nguồn");
check("nguyên văn câu của nhà nhập khẩu được giữ", page.requirements.some((item) => item.detail === "All suppliers must comply with our allergen labelling policy and provide a certificate of origin with each shipment."));
check("mọi mục đều có URL nguồn", page.requirements.every((item) => item.sourceUrl === "https://buyer.test/suppliers"));
check("mọi mục đều ghi rõ nguồn là trang hay PDF", page.requirements.every((item) => item.kind === "html"));
check("mọi mục đều có nhãn tin cậy 'confirmed'", page.requirements.every((item) => item.certainty === "confirmed"));
check("câu trong bằng chứng là câu thật của trang", page.requirements.every((item) => supplierPage.includes(item.detail.replace(/…$/, ""))));
check("không mục nào rỗng hay chỉ có nhãn", page.requirements.every((item) => item.detail.length > 10 && item.label.length > 2));

section("Từ PDF cũng đọc được");
const pdfLines = [
  "Supplier Requirements",
  "- BRCGS Food Safety certification, unannounced audit scheme",
  "- GlobalG.A.P. or equivalent for fresh produce",
  "Suppliers must submit a phytosanitary certificate with every shipment.",
];
const fromPdf = api.findRequirements({ url: "https://buyer.test/docs/supplier-guide.pdf", lines: pdfLines, kind: "pdf" });
const pdfLabels = fromPdf.map((item) => item.label);
check("đọc yêu cầu trong PDF", pdfLabels.includes("Chứng nhận BRCGS") && pdfLabels.includes("GlobalG.A.P."), pdfLabels.join(", "));
check("ghi rõ nguồn là PDF", fromPdf.every((item) => item.kind === "pdf" && item.sourceUrl.endsWith(".pdf")));
check("câu yêu cầu đầy đủ trong PDF vẫn được lấy", pdfLabels.includes("Giấy kiểm dịch thực vật"));

section("Không có yêu cầu thì không có mục nào");
const clean = api.findRequirements({
  url: "https://buyer.test/",
  lines: ["Welcome to our shop.", "We sell dried fruit and nuts across the country.", "Email us any time."],
});
check("trang không có yêu cầu → 0 mục", clean.length === 0);
const headingsOnly = api.findRequirements({ url: "https://buyer.test/", lines: ["Supplier requirements", "We look forward to working with you."] });
check("chỉ có tiêu đề mà không có nội dung → 0 mục", headingsOnly.length === 0, headingsOnly.map((i) => i.label).join(", "));

section("Gộp và sắp xếp");
const merged = api.mergeRequirements(
  [{ id: "a", category: "certification", label: "Chứng nhận BRCGS", detail: "BRCGS required", sourceUrl: "https://x.test/a", kind: "html", certainty: "confirmed" }],
  [
    { id: "a", category: "certification", label: "Chứng nhận BRCGS", detail: "BRCGS required", sourceUrl: "https://x.test/a", kind: "html", certainty: "confirmed" },
    { id: "b", category: "terms", label: "Điều khoản thanh toán", detail: "Net 30", sourceUrl: "https://x.test/b", kind: "html", certainty: "confirmed" },
  ],
);
check("cùng câu + cùng nhãn thì không lặp", merged.length === 2, String(merged.length));
const sorted = api.sortRequirements([
  { id: "1", category: "terms", label: "Điều khoản thanh toán", detail: "Net 30", sourceUrl: "u", kind: "html", certainty: "confirmed" },
  { id: "2", category: "certification", label: "Chứng nhận BRCGS", detail: "BRCGS required", sourceUrl: "u", kind: "html", certainty: "confirmed" },
  { id: "3", category: "document", label: "Giấy phân tích chất lượng (COA)", detail: "COA required", sourceUrl: "u", kind: "html", certainty: "confirmed" },
]);
check("chứng nhận xếp trước, điều khoản xếp sau", sorted[0].label === "Chứng nhận BRCGS" && sorted[sorted.length - 1].label === "Điều khoản thanh toán", sorted.map((i) => i.label).join(" → "));

section("Không có lời khuyên trong dữ liệu");
const adviceWords = ["nên ", "khuyến nghị", "hạng A", "ưu tiên", "gợi ý", "should contact", "we recommend you"];
check("không mục nào chứa lời khuyên", page.requirements.every((item) => !adviceWords.some((word) => `${item.label} ${item.detail}`.toLowerCase().includes(word))));

await rm(workDir, { recursive: true, force: true });
console.log(`\n${passed} check pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
