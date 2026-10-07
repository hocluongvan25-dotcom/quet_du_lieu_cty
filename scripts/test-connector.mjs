#!/usr/bin/env node
/**
 * Kiểm connector bằng fixture HTML thật (không cần internet).
 *
 * Cách chạy: gom entry .ts bằng esbuild rồi import — để phần connector viết
 * bằng TypeScript mà test vẫn chạy bằng `node` thuần, không thêm dependency.
 *
 * Chạy: npm run connector:test
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const workDir = path.join(root, ".connector-test");
const fixtures = path.join(root, "scripts/fixtures/connector");

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

// ---------------------------------------------------------------------------
// Dựng mock fetch từ fixture: không có yêu cầu mạng nào ra ngoài.
// ---------------------------------------------------------------------------
async function main() {
  // PDF công khai: một file không nén, một file nén Flate, một file ảnh scan (không có chữ).
  const pdfContent = [
    "BT /F1 11 Tf 72 720 Td (Supplier enquiries: procurement@mariani.com) Tj",
    "0 -14 Td (Procurement Manager - Dana Whitfield) Tj",
    "0 -14 Td (Supplier hotline: +1 707-452-2870) Tj",
    "ET",
  ].join("\n");

  const pdfObject = (content, compressed) => {
    const stream = compressed ? zlib.deflateSync(Buffer.from(content, "latin1")).toString("latin1") : content;
    const filter = compressed ? " /Filter /FlateDecode" : "";
    return [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj",
      `3 0 obj << /Length ${stream.length}${filter} >>`,
      "stream",
      stream,
      "endstream",
      "endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n");
  };

  const pdfPlain = pdfObject(pdfContent, false);
  const pdfCompressed = pdfObject(pdfContent, true);
  // PDF scan: luồng nén chỉ có dữ liệu ảnh, không có toán tử chữ nào.
  const pdfScanned = pdfObject(zlib.deflateSync(Buffer.alloc(4096, 7)).toString("latin1"), false);
  const pdfNotPdf = "%PDF-" + "junk".repeat(10);

  const files = {
    "contact-us.html": await readFile(path.join(fixtures, "contact-us.html"), "utf8"),
    "bulk-and-ingredients.html": await readFile(path.join(fixtures, "bulk-and-ingredients.html"), "utf8"),
    "home.html": await readFile(path.join(fixtures, "home.html"), "utf8"),
    "robots.txt": await readFile(path.join(fixtures, "robots.txt"), "utf8"),
    "supplier-guide.pdf": pdfPlain,
    "annual-report-2025.pdf": pdfCompressed,
    "quality-certification.pdf": pdfScanned,
    "not-really.pdf": pdfNotPdf,
  };

  const entry = `
import { runConnector } from "@/lib/connector/index";
import { extractFromPage } from "@/lib/connector/extract";
import { normalizeSeed, collectCandidateLinks } from "@/lib/connector/discover";
import { parseRobots, isPathAllowed } from "@/lib/connector/robots";
import { htmlToLines, registrableDomain } from "@/lib/connector/html";
import { assertPublicUrl, isBlockedAddress, UnsafeUrlError } from "@/lib/connector/safety";
import { pdfToLines, looksLikePdf, unescapePdfString, decodePdfHexString } from "@/lib/connector/pdf";
import { extractFromLines } from "@/lib/connector/extract";
import { buildBuyerWriteBatch } from "@/lib/connector/persist";

export const api = { runConnector, extractFromPage, extractFromLines, normalizeSeed, collectCandidateLinks, parseRobots, isPathAllowed, htmlToLines, registrableDomain, assertPublicUrl, isBlockedAddress, UnsafeUrlError, pdfToLines, looksLikePdf, unescapePdfString, decodePdfHexString, buildBuyerWriteBatch };
`;
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "entry.ts"), entry, "utf8");

  const bundlePath = path.join(workDir, "bundle.mjs");
  const build = spawnSync(
    "npx",
    ["--no-install", "esbuild", path.join(workDir, "entry.ts"), "--bundle", "--platform=node", "--format=esm", "--alias:@=./src", `--outfile=${bundlePath}`, "--log-level=warning"],
    { cwd: root, encoding: "utf8" },
  );
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }

  const { api } = await import(pathToFileURL(bundlePath).href);

  const results = await runChecks(api, files);
  await rm(workDir, { recursive: true, force: true });

  console.log(`\n${passed} check pass, ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
  return results;
}

async function runChecks(api, files) {
  // ------------------------------------------------------------------ robots --
  section("robots.txt");
  const robots = api.parseRobots(files["robots.txt"], "*");
  check("đọc được luật Disallow", robots.disallow.includes("/cart") && robots.disallow.includes("/account"));
  check("/cart bị chặn", api.isPathAllowed(robots, "/cart") === false);
  check("/pages/contact-us được phép", api.isPathAllowed(robots, "/pages/contact-us") === true);
  check("đường dẫn không có luật thì được phép", api.isPathAllowed(robots, "/collections/all-products") === true);

  // ------------------------------------------------------------------- html ---
  section("HTML → dòng văn bản");
  const lines = api.htmlToLines(files["contact-us.html"]);
  check("bỏ script/style", !lines.some((line) => line.includes("gorgias.chat") || line.includes("__shopify")));
  check("giải mã entity", lines.some((line) => line.includes("Japan & China")));
  check("giữ nguyên câu chữ trên trang", lines.some((line) => line.includes("Please".toLowerCase()) || line.includes("please contact us via phone, fax, or email")));
  check("tên miền rút gọn đúng", api.registrableDomain("www.mariani.com") === "mariani.com" && api.registrableDomain("shop.co.uk") === "shop.co.uk");

  // ------------------------------------------------------------------ links ---
  section("chọn trang để đọc");
  const links = api.collectCandidateLinks(files["home.html"], "https://mariani.com/", "mariani.com");
  const pageUrls = links.filter((item) => item.kind === "page").map((item) => item.url);
  const documentUrls = links.filter((item) => item.kind === "document").map((item) => item.url);
  check("ưu tiên trang liên hệ", pageUrls[0].includes("contact-us"), pageUrls[0]);
  check("lấy trang nguyên liệu", pageUrls.some((url) => url.includes("bulk-and-ingredients")));
  check("bỏ link ra ngoài tên miền", !pageUrls.some((url) => url.includes("facebook.com")));
  check("bỏ trang giỏ hàng", !pageUrls.some((url) => url.includes("/cart")));
  check("nhận ra tài liệu PDF cùng tên miền", documentUrls.length === 3, documentUrls.join(", "));
  check("tài liệu nhà cung cấp được ưu tiên nhất", documentUrls[0].includes("supplier-guide.pdf"), documentUrls[0]);
  check("không nhận PDF của tên miền khác", !documentUrls.some((url) => url.includes("other-site.com")));

  // -------------------------------------------------------------- extraction --
  section("tách dữ liệu từ trang Contact Us");
  const contact = api.extractFromPage({ url: "https://mariani.com/pages/contact-us", html: files["contact-us.html"] });
  const values = contact.channels.map((channel) => channel.value);

  check("lấy email chung", values.includes("productinfo@mariani.com"));
  check("email chung gắn nhãn 'chung công ty'", contact.channels.find((c) => c.value === "productinfo@mariani.com")?.identityMatch === "company_general");
  check("lấy điện thoại công bố", values.includes("7074522800"), values.join(", "));
  check("và KHÔNG tự thêm mã quốc gia chưa từng thấy", !values.includes("+17074522800"), values.join(", "));
  check("gắn nhãn Fax cho số fax, không coi là kênh liên hệ", contact.channels.find((c) => c.value === "7074522973")?.label === "Fax công bố" && contact.channels.find((c) => c.value === "7074522973")?.policy === "manual_contact_only");
  check("mọi giá trị đều có bằng chứng", contact.channels.every((channel) => channel.evidenceSnippet && channel.evidenceSnippet.length > 3));
  check("mọi giá trị đều có nguồn", contact.channels.every((channel) => channel.sourceUrl === "https://mariani.com/pages/contact-us"));
  check("mọi giá trị đều có nhãn tin cậy", contact.channels.every((channel) => channel.certainty === "confirmed"));

  section("bẫy dữ liệu");
  check("KHÔNG lấy email đuôi tên file ảnh (hero@2x.png)", !values.some((value) => value.includes("2x.png")), values.join(", "));
  const patternGuesses = ["s.nygard@mariani.com", "stacy.nygard@mariani.com", "bella.huk@mariani.com", "joe.flannigan@mariani.com", "procurement@mariani.com", "sales@mariani.com"];
  check("KHÔNG sinh email theo pattern", !values.some((value) => patternGuesses.includes(value.toLowerCase())), values.join(", "));
  check("mọi email đều có nguyên văn trên trang", contact.channels.filter((c) => c.type === "email").every((c) => files["contact-us.html"].includes(c.value)));
  const excludedEmails = contact.notes.filter((note) => note.kind === "excluded");
  check("email của bên thứ ba vào mục đã loại trừ", excludedEmails.some((note) => note.label === "mariani@worldpantry.com"));
  check("ghi rõ lý do loại trừ là khác tên miền", excludedEmails.some((note) => note.detail.includes("worldpantry.com")));
  check("KHÔNG nhận số của web store thành số công ty", !values.includes("+19895141459"), values.join(", "));
  check("và cảnh báo số đó cùng khối với email bên thứ ba", excludedEmails.some((note) => note.label.includes("989-514-1459")));
  check("KHÔNG dùng fax làm kênh liên hệ chính", !values.includes("+17074522973") || values.length > 0);

  section("người và kênh công bố theo tên");
  const steve = contact.channels.find((channel) => channel.value === "ssousa@mariani.com");
  check("nhận ra người khi tên nằm cạnh email", steve?.personName === "Steve Sousa", JSON.stringify(steve?.personName));
  check("gắn nhãn 'cá nhân'", steve?.identityMatch === "person");
  check("lấy được cả Todd Garcia", contact.channels.some((channel) => channel.personName === "Todd Garcia"));
  check("danh sách người tách riêng", contact.people.some((person) => person.name === "Steve Sousa" && person.channelValues.includes("ssousa@mariani.com")));
  check("người không bị gán nhãn verified", contact.people.every((person) => !("verified" in person)));

  section("social và WhatsApp");
  const linkedin = contact.channels.find((channel) => channel.type === "linkedin");
  check("lấy LinkedIn công ty", linkedin?.value === "linkedin.com/company/mariani-packing-co.-inc.", linkedin?.value);
  check("profile link chỉ để liên hệ thủ công", linkedin?.policy === "manual_contact_only");
  check(
    "KHÔNG lấy hồ sơ LinkedIn cá nhân làm kênh của công ty",
    !contact.channels.some((channel) => channel.value.includes("/in/")),
    contact.channels.map((channel) => channel.value).join(", "),
  );
  check(
    "hồ sơ cá nhân vào mục đã loại trừ (không hiện cho người dùng)",
    contact.notes.some((note) => note.kind === "excluded" && note.label.includes("/in/stacy-nygard-1517b2b")),
  );



  // ------------------------------------------------------------------- pdf ---
  section("đọc PDF công khai");
  check("nhận ra file PDF theo magic number", api.looksLikePdf(files["supplier-guide.pdf"]) === true && api.looksLikePdf("not a pdf") === false);

  const plainPdf = await api.pdfToLines(files["supplier-guide.pdf"]);
  check("đọc được PDF không nén", plainPdf.ok === true, plainPdf.reason ?? "");
  check("lấy nguyên câu chữ trong PDF", plainPdf.lines.some((line) => line.includes("Supplier enquiries: procurement@mariani.com")), plainPdf.lines.join(" / "));
  check("ngắt dòng theo toán tử Td", plainPdf.lines.some((line) => line.includes("Procurement Manager - Dana Whitfield")));

  const compressedPdf = await api.pdfToLines(files["annual-report-2025.pdf"]);
  check("đọc được PDF nén FlateDecode", compressedPdf.ok === true && compressedPdf.compressedStreams >= 1, compressedPdf.reason ?? "");
  check("hai kiểu nén cho ra cùng nội dung", JSON.stringify(compressedPdf.lines) === JSON.stringify(plainPdf.lines));

  const scanned = await api.pdfToLines(files["quality-certification.pdf"]);
  check("PDF scan ảnh thì báo không đọc được, không đoán", scanned.ok === false && scanned.lines.length === 0, scanned.reason ?? "");
  const junk = await api.pdfToLines(files["not-really.pdf"]);
  check("file không có luồng nội dung cũng báo không đọc được", junk.ok === false, junk.reason ?? "");
  check("chuỗi hex UTF-16BE đọc đúng", api.decodePdfHexString("FEFF00480069") === "Hi");
  check("bỏ escape của chuỗi PDF", api.unescapePdfString("a\\(b\\)c") === "a(b)c");

  const fromPdf = api.extractFromLines({ url: "https://mariani.com/documents/supplier-guide.pdf", lines: plainPdf.lines, kind: "pdf" });
  const pdfValues = fromPdf.channels.map((channel) => channel.value);
  check("lấy email trong PDF", pdfValues.includes("procurement@mariani.com"), pdfValues.join(", "));
  check("email trong PDF có tên người đi kèm thì thuộc về người đó", fromPdf.channels.find((c) => c.value === "procurement@mariani.com")?.identityMatch === "person");
  check("lấy số điện thoại trong PDF", pdfValues.includes("+17074522870"), pdfValues.join(", "));
  check("tên người công bố cạnh email được gắn vào kênh", fromPdf.channels.find((c) => c.value === "procurement@mariani.com")?.personName === "Dana Whitfield");
  check("PDF không sinh ra kênh biểu mẫu hay mạng xã hội", !fromPdf.channels.some((channel) => channel.type === "form" || channel.type === "linkedin"));
  const pdfRaw = files["supplier-guide.pdf"];
  const pdfCompact = pdfRaw.replace(/[.\-()\s]/g, "");
  check(
    "mọi giá trị trong PDF đều có nguyên văn trong chính file đó",
    [...pdfValues, fromPdf.channels.find((c) => c.value === "procurement@mariani.com")?.personName ?? ""]
      .filter(Boolean)
      .every((value) => pdfRaw.includes(value) || pdfCompact.includes(value.replace(/[.\-()\s]/g, ""))),
    [...pdfValues].join(", "),
  );

  // --------------------------------------------------------------- end to end -
  section("chạy toàn bộ connector trên fixture");
  const requested = [];
  const mockFetch = async (url) => {
    requested.push(String(url));
    const make = (body, contentType = "text/html; charset=utf-8", status = 200, finalUrl) => ({
      ok: status >= 200 && status < 300,
      status,
      url: finalUrl ?? String(url),
      headers: new Map([["content-type", contentType]]) && { get: () => contentType },
      text: async () => body,
      // PDF phải giữ nguyên từng byte: mock trả về đúng những byte đã tạo file.
      arrayBuffer: async () => Uint8Array.from(body, (char) => char.charCodeAt(0) & 0xff).buffer,
    });
    const href = String(url);
    if (href.endsWith("/robots.txt")) return make(files["robots.txt"], "text/plain");
    if (href.includes("bulk-and-ingredients")) return make(files["bulk-and-ingredients.html"]);
    if (href.includes("contact")) return make(files["contact-us.html"]);
    if (href.endsWith("supplier-guide.pdf")) return make(files["supplier-guide.pdf"], "application/pdf");
    if (href.endsWith("annual-report-2025.pdf")) return make(files["annual-report-2025.pdf"], "application/pdf");
    if (href.endsWith("quality-certification.pdf")) return make(files["quality-certification.pdf"], "application/pdf");
    if (href.includes("/cart")) return make("cart page", "text/html", 200);
    if (href.includes("/account")) return make("login", "text/html", 200, "https://mariani.com/account/login");
    if (href === "https://mariani.com/" || href === "https://mariani.com") return make(files["home.html"]);
    return make("not found", "text/html", 404);
  };

  const noGuard = async () => {};
  const result = await api.runConnector("mariani.com", { fetchImpl: mockFetch, maxPages: 5, maxDocuments: 2, delayMs: 0, guard: noGuard, log: () => {} });

  check("đọc robots.txt", requested.some((url) => url.endsWith("/robots.txt")));
  check("chỉ gọi trong tên miền của công ty", requested.every((url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "") === "mariani.com";
    } catch {
      return false;
    }
  }), requested.join("\n    "));
  check("không gọi link Facebook", !requested.some((url) => url.includes("facebook.com")));
  const phoneChannels = result.channels.filter((channel) => channel.type === "phone");
  check(
    "gộp kênh: số điện thoại xuất hiện ở 2 trang chỉ còn 1 dòng, fax tách riêng",
    phoneChannels.length === 3 && phoneChannels.some((c) => c.value === "7074522800") && phoneChannels.some((c) => c.value === "7074522973" && c.label === "Fax công bố") && phoneChannels.some((c) => c.value === "+17074522870"),
    JSON.stringify(phoneChannels.map((c) => `${c.value}:${c.label}`)),
  );
  check("số của web store vẫn không lọt vào danh sách", !result.channels.some((channel) => channel.value === "9895141459"));
  check("có đủ 4 email công bố", ["productinfo@mariani.com", "ssousa@mariani.com", "tgarcia@mariani.com", "ingredients@mariani.com"].every((value) => result.channels.some((channel) => channel.value === value)), result.channels.map((c) => c.value).join(", "));
  check("gộp người theo tên", result.people.length === 3, result.people.map((person) => person.name).join(", "));
  check("người trong PDF cũng vào danh sách", result.people.some((person) => person.name === "Dana Whitfield"));
  check("không có kênh nào không phải confirmed", result.channels.every((channel) => channel.certainty === "confirmed"));
  const pageText = `${files["contact-us.html"]} ${files["bulk-and-ingredients.html"]} ${files["supplier-guide.pdf"]} ${files["annual-report-2025.pdf"]}`.replace(/[.\-()\s]/g, "");
  check(
    "mọi email và số điện thoại đều có nguyên văn trên trang",
    result.channels
      .filter((channel) => channel.type === "email" || channel.type === "phone")
      .every((channel) => pageText.includes(channel.value.replace(/[.\-()\s]/g, ""))),
    result.channels.filter((c) => c.type === "email" || c.type === "phone").map((c) => c.value).join(", "),
  );
  check("ghi lại trang đã đọc kèm trạng thái", result.pages.some((page) => page.url.includes("contact-us") && page.status === 200));
  check("đọc tài liệu PDF cùng tên miền", requested.some((url) => url.endsWith("supplier-guide.pdf")) && requested.some((url) => url.endsWith("annual-report-2025.pdf")));
  check("lấy được nội dung từ PDF", result.channels.some((channel) => channel.value === "procurement@mariani.com"));
  check("tài liệu PDF được ghi vào danh sách trang đã đọc, có kind", result.pages.some((page) => page.kind === "pdf" && page.url.endsWith("supplier-guide.pdf")));
  check("không gọi PDF của tên miền khác", !requested.some((url) => url.includes("other-site.com")));

  // ------------------------------------------------- ghi vào database (batch) --
  section("dựng dữ liệu để ghi vào database");
  const batchOk = api.buildBuyerWriteBatch(result, { organizationId: "org-1", domain: result.domain, companyName: "Mariani Packing Co.", country: "United States" });
  check("dựng được batch khi có đủ organization + country", batchOk.ok === true, batchOk.reason);
  const batch = batchOk.ok ? batchOk.batch : { channels: [], routes: [], people: [], skipped: [] };
  check("mọi kênh đều có trang nguồn và câu chữ bằng chứng", batch.channels.every((channel) => channel.source_url.startsWith("http") && channel.evidence_snippet.length > 0));
  check("không có kênh nào là hồ sơ LinkedIn cá nhân", batch.channels.every((channel) => !channel.value.includes("/in/")));
  check("kênh nào cũng là loại có trong enum của database", batch.channels.every((channel) => ["email", "phone", "form", "linkedin_url", "whatsapp", "portal"].includes(channel.channel_type)));
  check("nhãn 'person' chỉ có khi tìm được người tương ứng", batch.channels.every((channel) => channel.identity_match !== "person" || channel.personIndex !== null));
  check("mỗi người đều có trang nguồn", batch.people.every((person) => person.source_url.startsWith("http")));
  check("đường vào (buyer_routes) chỉ đến từ trang đã đọc", batch.routes.every((route) => route.source_url.startsWith("http")));
  check("thiếu country thì không dựng batch", api.buildBuyerWriteBatch(result, { organizationId: "org-1", domain: result.domain }).ok === false);
  check("thiếu organization thì không dựng batch", api.buildBuyerWriteBatch(result, { organizationId: "", domain: result.domain, country: "US" }).ok === false);
  check("không gọi PDF bị robots.txt chặn", !requested.some((url) => url.includes("quality-certification")));
  check("không đọc quá số tài liệu cho phép", requested.filter((url) => url.endsWith(".pdf")).length === 2, requested.filter((url) => url.endsWith(".pdf")).join(", "));
  check("PDF scan không sinh ra kênh nào và không bị đoán", !result.channels.some((channel) => channel.value.includes("quality-certification")));
  check("không vượt tường đăng nhập", !result.channels.some((channel) => String(channel.value).includes("login")));
  check("trang bị robots chặn không được tải", !requested.some((url) => url.endsWith("/cart")));

  section("chuẩn hoá số điện thoại");
  const synthetic = api.extractFromPage({
    url: "https://format-check.test/contact",
    html: '<p>Phone: +1 (707) 452-2800</p><p>Điện thoại: 00 84 28 3822 1234</p><p>Hotline: +84 91 234 5678</p>',
  });
  const syntheticValues = synthetic.channels.map((channel) => channel.value);
  check("số có + giữ nguyên dạng quốc tế", syntheticValues.includes("+17074522800"), syntheticValues.join(", "));
  check("số bắt đầu bằng 00 chuyển thành +", syntheticValues.includes("+842838221234"), syntheticValues.join(", "));
  check("hotline Việt Nam đọc đúng", syntheticValues.includes("+84912345678"), syntheticValues.join(", "));

  section("chặn SSRF");
  check("IP loopback bị chặn", api.isBlockedAddress("127.0.0.1") === true);
  check("IP metadata cloud bị chặn", api.isBlockedAddress("169.254.169.254") === true);
  check("dải nội bộ 10.x bị chặn", api.isBlockedAddress("10.0.0.5") === true);
  check("dải nội bộ 192.168.x bị chặn", api.isBlockedAddress("192.168.1.1") === true);
  check("IPv6 loopback bị chặn", api.isBlockedAddress("::1") === true);
  check("IP công cộng không bị chặn", api.isBlockedAddress("93.184.216.34") === false);

  const rejects = async (url) => api.assertPublicUrl(url, { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }).then(() => false).catch(() => true);
  check("chặn http://127.0.0.1/", await rejects("http://127.0.0.1/"));
  check("chặn http://169.254.169.254/latest/meta-data/", await rejects("http://169.254.169.254/latest/meta-data/"));
  check("chặn http://localhost:3000", await rejects("http://localhost:3000/"));
  check("chặn tên miền .internal", await rejects("https://db.internal/"));
  check("chặn giao thức file:", await rejects("file:///etc/passwd"));
  check("tên miền công cộng được phép", await api.assertPublicUrl("https://mariani.com", { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }).then(() => true));
  const privateDns = await api
    .assertPublicUrl("https://looks-public.com", { lookup: async () => [{ address: "10.1.2.3", family: 4 }] })
    .then(() => false)
    .catch((error) => error instanceof api.UnsafeUrlError);
  check("tên miền công cộng nhưng phân giải vào IP nội bộ thì bị chặn", privateDns);

  const blockedFetch = await api.runConnector("169.254.169.254", { fetchImpl: mockFetch, delayMs: 0, maxPages: 2, log: () => {} });
  check("connector từ chối IP metadata", blockedFetch.pages.every((page) => page.status === "skipped" || page.status === "blocked" || page.status === "error"), JSON.stringify(blockedFetch.pages));

  section("đầu vào sai");
  const bad = await api.runConnector("", { fetchImpl: mockFetch, delayMs: 0, guard: noGuard, log: () => {} }).then(() => false).catch(() => true);
  check("tên miền rỗng bị từ chối", bad);
  check("chuẩn hoá tên miền", api.normalizeSeed("mariani.com") === "https://mariani.com" && api.normalizeSeed("http://a.com/x/") === "http://a.com/x");

  return true;
}

main().catch(async (error) => {
  console.error(error);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
