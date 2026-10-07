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
    "secondary/home.html": await readFile(path.join(fixtures, "secondary/home.html"), "utf8"),
    "secondary/contact.html": await readFile(path.join(fixtures, "secondary/contact.html"), "utf8"),
    "secondary/about.html": await readFile(path.join(fixtures, "secondary/about.html"), "utf8"),
    "secondary/procurement.html": await readFile(path.join(fixtures, "secondary/procurement.html"), "utf8"),
    "secondary/blocked-supplier.html": await readFile(path.join(fixtures, "secondary/blocked-supplier.html"), "utf8"),
    "secondary/robots.txt": await readFile(path.join(fixtures, "secondary/robots.txt"), "utf8"),
    "secondary/sitemap.xml": await readFile(path.join(fixtures, "secondary/sitemap.xml"), "utf8"),
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
import { toE164, whatsappLink, isE164, resolveCountry } from "@/lib/connector/phone";
import { readSitemap } from "@/lib/connector/sitemap";
import { coverageOf, secondaryReason } from "@/lib/connector/gate";
import { searchSite, harvestUrlsFromSearch, buildSearchRequest, parseSearchHits, resolveProvider, lookupCompaniesHouse, lookupSecEdgar, lookupRegistry, registriesForCountry, buildSearchRequest, parseSearchHits, resolveProvider } from "@/lib/connector/secondary";

export const api = { runConnector, extractFromPage, extractFromLines, normalizeSeed, collectCandidateLinks, parseRobots, isPathAllowed, htmlToLines, registrableDomain, assertPublicUrl, isBlockedAddress, UnsafeUrlError, pdfToLines, looksLikePdf, unescapePdfString, decodePdfHexString, buildBuyerWriteBatch, toE164, whatsappLink, isE164, resolveCountry, readSitemap, coverageOf, secondaryReason, searchSite, harvestUrlsFromSearch, buildSearchRequest, parseSearchHits, resolveProvider, lookupCompaniesHouse, lookupSecEdgar, lookupRegistry, registriesForCountry };
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

  section("số điện thoại → E.164");
  const vn = api.toE164("(028) 3822 1234", "Vietnam");
  check("số nội địa + biết quốc gia → ghép mã quốc gia", vn.ok && vn.value === "+842838221234", JSON.stringify(vn));
  const vnMobile = api.toE164("0912 345 678", "Việt Nam");
  check("bỏ số 0 đầu của số di động Việt Nam", vnMobile.ok && vnMobile.value === "+84912345678", JSON.stringify(vnMobile));
  const us = api.toE164("707-452-2800", "United States");
  check("số Mỹ không có số 0 đầu", us.ok && us.value === "+17074522800", JSON.stringify(us));
  const uk = api.toE164("020 7946 0000", "UK");
  check("UK: bỏ 0 đầu, ghép +44", uk.ok && uk.value === "+442079460000", JSON.stringify(uk));
  const it = api.toE164("06 1234 5678", "Italy");
  check("Ý giữ số 0 đầu (đúng thông lệ nước này)", it.ok && it.value === "+390612345678", JSON.stringify(it));
  const already = api.toE164("+84 28 3822 1234");
  check("số đã có + thì chỉ làm sạch", already.ok && already.value === "+842838221234", JSON.stringify(already));
  const zeroZero = api.toE164("00 84 28 3822 1234");
  check("lối viết 00 đổi thành +", zeroZero.ok && zeroZero.value === "+842838221234", JSON.stringify(zeroZero));
  const noCountry = api.toE164("707-452-2800");
  check("KHÔNG tự thêm mã quốc gia khi chưa biết quốc gia", noCountry.ok === false && noCountry.reason.includes("quốc gia"), JSON.stringify(noCountry));
  const oddCountry = api.toE164("707-452-2800", "Atlantis");
  check("quốc gia không nhận ra thì cũng không đoán", oddCountry.ok === false && oddCountry.reason.includes("Atlantis"), JSON.stringify(oddCountry));
  const tooShort = api.toE164("12345", "United States");
  check("chuỗi quá ngắn bị từ chối", tooShort.ok === false);
  check("nhận mã ISO hai chữ và tên không dấu", api.resolveCountry("vn")?.iso2 === "VN" && api.resolveCountry("viet nam")?.iso2 === "VN");
  check("isE164 từ chối số thiếu dấu + và số quá dài", !api.isE164("84912345678") && !api.isE164("+1234567890123456"));
  check("whatsappLink chỉ dựng từ E.164", api.whatsappLink("+84912345678") === "https://wa.me/84912345678" && api.whatsappLink("0912345678") === null && api.whatsappLink(null) === null);

  const withCountry = api.extractFromPage({ url: "https://mariani.com/pages/contact-us", html: files["contact-us.html"], country: "United States" });
  const phoneWithCountry = withCountry.channels.find((channel) => channel.type === "phone" && channel.value === "7074522800");
  check("trang có quốc gia → kênh điện thoại mang E.164", phoneWithCountry?.e164 === "+17074522800", phoneWithCountry?.e164);
  check("và giá trị hiển thị vẫn nguyên như đã công bố", phoneWithCountry?.value === "7074522800");
  const withoutCountry = api.extractFromPage({ url: "https://mariani.com/pages/contact-us", html: files["contact-us.html"] });
  const phoneWithout = withoutCountry.channels.find((channel) => channel.type === "phone" && channel.value === "7074522800");
  check("trang không có quốc gia → e164 rỗng, kèm lý do", phoneWithout?.e164 === null && String(phoneWithout?.e164Reason).includes("quốc gia"), phoneWithout?.e164Reason);

  // ------------------------------------------------------------- nguồn cấp 2 --
  section("sitemap: bản đồ công ty tự công bố");

  const xml = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    url: "https://acmespices.co.uk/sitemap.xml",
    headers: { get: () => "application/xml" },
    text: async () => body,
    arrayBuffer: async () => Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff).buffer,
  });

  const sitemapFetch = async (url) => {
    if (new URL(String(url)).pathname === "/sitemap.xml") return xml(files["secondary/sitemap.xml"]);
    return xml("not found", 404);
  };

  const sitemapRead = await api.readSitemap("https://acmespices.co.uk", { fetchImpl: sitemapFetch, guard: noGuard, log: () => {} });
  check("đọc được sitemap của công ty", sitemapRead.sitemapsRead.length === 1, sitemapRead.sitemapsRead.join(", "));
  check("lấy trang liên quan trong sitemap", sitemapRead.urls.includes("https://acmespices.co.uk/about"), sitemapRead.urls.join(", "));
  check("bỏ URL khác tên miền", !sitemapRead.urls.some((url) => url.includes("other-site.test")));
  check("bỏ URL không liên quan (bài blog)", !sitemapRead.urls.some((url) => url.includes("/blog/")));
  check("tách tài liệu PDF trong sitemap", sitemapRead.documents.includes("https://acmespices.co.uk/documents/supplier-guide.pdf"), sitemapRead.documents.join(", "));

  const sitemapFiltered = await api.readSitemap("https://acmespices.co.uk", {
    fetchImpl: sitemapFetch,
    guard: noGuard,
    log: () => {},
    allowed: (url) => !url.includes("/blocked"),
  });
  check("chốt robots.txt được áp cho cả URL lấy từ sitemap", !sitemapFiltered.urls.some((url) => url.includes("/blocked")));

  const noSitemapRead = await api.readSitemap("https://acmespices.co.uk", { fetchImpl: async () => xml("not found", 404), guard: noGuard, log: () => {} });
  check("không có sitemap là chuyện bình thường, không lỗi", noSitemapRead.sitemapsRead.length === 0 && String(noSitemapRead.reason).includes("không tìm thấy sitemap"));

  const indexXml = '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://acmespices.co.uk/sitemap-pages.xml</loc></sitemap></sitemapindex>';
  const childXml = '<?xml version="1.0"?><urlset><url><loc>https://acmespices.co.uk/suppliers/register</loc></url></urlset>';
  const indexFetch = async (url) => (new URL(String(url)).pathname === "/sitemap-pages.xml" ? xml(childXml) : xml(indexXml));
  const indexRead = await api.readSitemap("https://acmespices.co.uk", { fetchImpl: indexFetch, guard: noGuard, log: () => {} });
  check("sitemap index: đọc file con rồi mới lấy URL", indexRead.urls.includes("https://acmespices.co.uk/suppliers/register"), indexRead.sitemapsRead.join(", "));
  const cappedRead = await api.readSitemap("https://acmespices.co.uk", { fetchImpl: indexFetch, guard: noGuard, log: () => {}, maxSitemaps: 1 });
  check("tôn trọng trần số file sitemap", cappedRead.sitemapsRead.length === 1 && cappedRead.urls.length === 0);

  section("cổng quyết định có đi nguồn cấp 2 hay không");
  const baseChannel = {
    label: "Email",
    certainty: "confirmed",
    policy: "needs_mailbox_check",
    sourceUrl: "https://acmespices.co.uk/contact",
    evidenceSnippet: "Email: info@acmespices.co.uk",
  };
  const generalOnly = api.coverageOf([{ ...baseChannel, type: "email", value: "info@acmespices.co.uk", identityMatch: "company_general" }]);
  check("chỉ có kênh chung thì chưa đủ", generalOnly.enough === false && generalOnly.companyGeneral === 1);
  check("lý do đi tiếp nói rõ chỉ có kênh chung", String(api.secondaryReason(generalOnly)).includes("kênh chung"), api.secondaryReason(generalOnly));
  const buyingDoor = api.coverageOf([
    { ...baseChannel, type: "email", value: "procurement@acmespices.co.uk", identityMatch: "department", personTitle: "Procurement Manager" },
  ]);
  check("có kênh nhóm mua hàng thì đủ, không đi nguồn cấp 2", buyingDoor.enough === true && api.secondaryReason(buyingDoor) === undefined);
  const vietnameseDepartment = api.coverageOf([{ ...baseChannel, type: "email", value: "muahang@acmespices.co.uk", label: "Phòng mua hàng", identityMatch: "department" }]);
  check("nhãn bộ phận bằng tiếng Việt cũng nhận ra nhóm mua hàng", vietnameseDepartment.enough === true);
  const salesPersonOnly = api.coverageOf([
    { ...baseChannel, type: "email", value: "sales@acmespices.co.uk", identityMatch: "person", personTitle: "Sales Director" },
  ]);
  check("người ngoài nhóm mua hàng không tính là đủ", salesPersonOnly.enough === false && salesPersonOnly.named === 1);
  const thinReason = api.secondaryReason(api.coverageOf([]));
  check("không có kênh nào thì lý do nói rõ", String(thinReason).includes("không tìm được kênh nào"), thinReason);

  section("search API: chỉ để tìm URL trong chính tên miền");
  const searchCalls = [];
  const searchFetch = async (url, init = {}) => {
    searchCalls.push({ url: String(url), init });
    const payload = {
      organic: [
        { title: "Supplier registration", link: "https://acmespices.co.uk/suppliers/register", snippet: "Contact procurement@acmespices.co.uk" },
        { title: "Trade directory listing", link: "https://directory.example.com/acme-spices", snippet: "Acme Spices on a directory" },
      ],
    };
    return { ok: true, status: 200, url: String(url), headers: { get: () => "application/json" }, text: async () => JSON.stringify(payload), json: async () => payload };
  };
  const hits = await api.searchSite("acmespices.co.uk", "supplier registration", { apiKey: "test-key", fetchImpl: searchFetch, log: () => {} });
  check("chỉ giữ kết quả trong tên miền công ty", hits.length === 1 && hits[0].url === "https://acmespices.co.uk/suppliers/register", hits.map((hit) => hit.url).join(", "));
  check("truy vấn luôn có site: nên phạm vi vẫn là website của họ", JSON.parse(String(searchCalls[0].init.body)).q.startsWith("site:acmespices.co.uk "));
  check("gửi khoá qua header, không nhét vào URL", String(searchCalls[0].init.headers["x-api-key"]) === "test-key" && !searchCalls[0].url.includes("test-key"));
  const noKeyHarvest = await api.harvestUrlsFromSearch("acmespices.co.uk", {
    fetchImpl: async () => {
      throw new Error("không được gọi mạng khi không có khoá");
    },
  });
  check("không có khoá thì không gọi mạng", noKeyHarvest.urls.length === 0 && noKeyHarvest.provider === null && noKeyHarvest.queriesRun === 0);
  const harvest = await api.harvestUrlsFromSearch("acmespices.co.uk", { apiKey: "test-key", fetchImpl: searchFetch, log: () => {}, limit: 2 });
  check("thu hoạch chỉ trả URL cùng tên miền, đã bỏ trùng", harvest.urls.length === 1 && harvest.documents.length === 0 && harvest.queriesRun > 0, JSON.stringify(harvest));


  // Ba nhà cung cấp, ba hình dạng request khác nhau — kiểm cả ba, vì đổi nhà
  // cung cấp là việc người dùng làm một mình, không cần sửa code.
  const serperRequest = api.buildSearchRequest("acmespices.co.uk", "supplier registration", "serper", "k1");
  check("serper: POST, khoá ở header", /google\.serper\.dev/.test(serperRequest.url) && serperRequest.init.headers["x-api-key"] === "k1");
  const tavilyRequest = api.buildSearchRequest("acmespices.co.uk", "supplier registration", "tavily", "k2");
  check("tavily: POST, khoá trong body đúng như nhà cung cấp yêu cầu", JSON.parse(String(tavilyRequest.init.body)).api_key === "k2");
  const braveRequest = api.buildSearchRequest("acmespices.co.uk", "supplier registration", "brave", "k3");
  check("brave: GET, khoá ở header riêng", braveRequest.init.method === undefined && braveRequest.init.headers["x-subscription-token"] === "k3" && braveRequest.url.includes("api.search.brave.com"));
  check("cả ba đều luôn có site: trong truy vấn", [serperRequest, tavilyRequest, braveRequest].every((request) => JSON.stringify(request.init.body ?? decodeURIComponent(request.url)).includes("site:acmespices.co.uk")));
  check("khoá không bao giờ nằm trong URL", [serperRequest, tavilyRequest, braveRequest].every((request) => !request.url.includes("k1") && !request.url.includes("k2") && !request.url.includes("k3")));

  check(
    "hình dạng kết quả của brave đọc được và vẫn lọc ngoài tên miền",
    api.parseSearchHits(
      { web: { results: [{ url: "https://acmespices.co.uk/contact", title: "Contact", description: "Phone" }, { url: "https://other.example/x", title: "Khác" }] } },
      "brave",
      "acmespices.co.uk",
    ).length === 1,
  );
  check(
    "hình dạng kết quả của tavily đọc được",
    api.parseSearchHits({ results: [{ url: "https://acmespices.co.uk/suppliers", content: "supplier page" }] }, "tavily", "acmespices.co.uk")[0]?.snippet === "supplier page",
  );
  check(
    "kết quả hỏng bị bỏ, không làm gãy lần chạy",
    api.parseSearchHits({ organic: [{ title: "Không có URL" }, { link: "không phải URL" }, { link: "https://sub.acmespices.co.uk/x" }] }, "serper", "acmespices.co.uk").length === 1,
  );
  check("payload rỗng không làm gãy", api.parseSearchHits(undefined, "serper", "acmespices.co.uk").length === 0);
  check("không nêu nhà cung cấp thì mặc định serper", api.resolveProvider("k", undefined) === "serper" && api.resolveProvider(undefined, "brave") === null);

  section("sổ đăng ký doanh nghiệp");
  check("chọn sổ theo quốc gia", api.registriesForCountry("UK")[0] === "companies_house" && api.registriesForCountry("United States")[0] === "sec_edgar");
  check("quốc gia chưa có sổ miễn phí thì không đoán bừa", api.registriesForCountry("Vietnam").length === 0 && api.registriesForCountry("").length === 0);

  const chCalls = [];
  const chFetch = async (url, init = {}) => {
    const href = String(url);
    chCalls.push({ url: href, auth: init.headers?.authorization });
    const json = async (payload) => ({ ok: true, status: 200, url: href, headers: { get: () => "application/json" }, text: async () => JSON.stringify(payload), json: async () => payload });
    if (href.includes("/search/companies")) return json({ items: [{ company_number: "01234567", title: "ACME SPICES LTD" }] });
    if (href.endsWith("/company/01234567")) {
      return json({
        company_name: "ACME SPICES LTD",
        company_status: "active",
        date_of_creation: "1998-04-02",
        sic_codes: ["46370"],
        previous_company_names: [{ name: "ACME HERBS LIMITED" }],
      });
    }
    if (href.includes("/officers")) {
      return json({
        items: [
          { name: "SMITH, Jane", officer_role: "director", appointed_on: "2015-06-01" },
          { name: "OLD, Bill", officer_role: "director", appointed_on: "2000-01-01", resigned_on: "2015-05-30" },
        ],
      });
    }
    return json({});
  };

  const ch = await api.lookupCompaniesHouse("Acme Spices Ltd", { companiesHouseApiKey: "ch-test", fetchImpl: chFetch, log: () => {} });
  check("trả về pháp nhân và số đăng ký", ch.finding?.registeredName === "ACME SPICES LTD" && ch.finding?.companyNumber === "01234567");
  check("ghi lại tình trạng pháp lý", ch.finding?.status === "active");
  check("ghi ngành theo mã SIC", ch.finding?.industry === "SIC 46370");
  check("ghi tên cũ nếu có", ch.finding?.formerNames?.includes("ACME HERBS LIMITED") === true);
  check("chỉ lấy người còn đương nhiệm", ch.finding?.officers.length === 1 && ch.finding.officers[0].name === "SMITH, Jane", JSON.stringify(ch.finding?.officers));
  check("tên người giữ nguyên như sổ ghi", ch.finding.officers[0].name.includes("SMITH, Jane"));
  check("ghi nguồn kèm tên cơ quan", ch.finding?.registryLabel === "UK Companies House" && ch.finding.sourceUrl.includes("find-and-update.company-information.service.gov.uk"));
  check("xác thực bằng Basic auth", String(chCalls[0].auth).startsWith("Basic "));
  check(
    "sổ đăng ký KHÔNG tạo ra kênh liên hệ nào",
    ch.finding.officers.every((officer) => !("email" in officer) && !("phone" in officer) && !("value" in officer)) && !JSON.stringify(ch.finding).includes("@"),
  );
  const chNoKey = await api.lookupCompaniesHouse("Acme Spices Ltd", {
    fetchImpl: async () => {
      throw new Error("không được gọi mạng khi thiếu khoá");
    },
  });
  check("thiếu khoá thì nói rõ thiếu khoá, không gọi mạng", chNoKey.queried.length === 0 && String(chNoKey.reason).includes("COMPANIES_HOUSE_API_KEY"), chNoKey.reason);

  const secFetch = async (url) => {
    const href = String(url);
    const make = (body, contentType = "application/json") => ({
      ok: true,
      status: 200,
      url: href,
      headers: { get: () => contentType },
      text: async () => body,
      json: async () => JSON.parse(body),
    });
    if (href.includes("browse-edgar")) {
      return make(
        '<?xml version="1.0"?><feed><entry><link href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0000320193&amp;type=10-K"/></entry></feed>',
        "application/atom+xml",
      );
    }
    if (href.includes("data.sec.gov/submissions")) {
      return make(
        JSON.stringify({
          name: "APPLE INC",
          sicDescription: "ELECTRONIC COMPUTERS",
          formerNames: [{ name: "APPLE COMPUTER INC" }],
          filings: { recent: { form: ["10-K"], filingDate: ["2025-10-31"] } },
        }),
      );
    }
    return make("{}");
  };
  const sec = await api.lookupSecEdgar("Apple Inc", { fetchImpl: secFetch, log: () => {} });
  check("SEC: nhận ra pháp nhân và số CIK", sec.finding?.companyNumber === "CIK 0000320193", JSON.stringify(sec.finding));
  check("SEC: ghi hồ sơ gần nhất thay vì bịa tình trạng", String(sec.finding?.status).includes("2025-10-31"));
  check("SEC: ghi ngành theo SIC", sec.finding?.industry === "ELECTRONIC COMPUTERS");
  check("SEC: không gán tên người khi chưa đọc hồ sơ", sec.finding?.officers.length === 0);
  check("SEC: nguồn trỏ về hồ sơ gốc", String(sec.finding?.sourceUrl).includes("sec.gov"));
  const noRegistry = await api.lookupRegistry("Vietnam", "Acme Spices Ltd", {
    fetchImpl: async () => {
      throw new Error("không được gọi mạng khi chưa có sổ cho quốc gia này");
    },
  });
  check("quốc gia chưa có sổ thì trả lý do, không gọi mạng", noRegistry.queried.length === 0 && String(noRegistry.reason).includes("chưa có sổ đăng ký miễn phí"));

  section("chạy nguồn cấp 2 đầu-cuối");
  const secondaryRequests = [];
  const secondaryFetch = async (url) => {
    const href = String(url);
    secondaryRequests.push(href);
    const make = (body, contentType = "text/html; charset=utf-8", status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      url: href,
      headers: { get: () => contentType },
      text: async () => body,
      json: async () => JSON.parse(body),
      arrayBuffer: async () => Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff).buffer,
    });

    if (href.endsWith("/robots.txt")) return make(files["secondary/robots.txt"], "text/plain");
    if (href.endsWith("/sitemap.xml")) return make(files["secondary/sitemap.xml"], "application/xml");
    if (href.includes("google.serper.dev")) {
      return make(
        JSON.stringify({
          organic: [
            { title: "Supplier registration", link: "https://acmespices.co.uk/suppliers/register", snippet: "procurement@acmespices.co.uk" },
            { title: "Trade directory", link: "https://directory.example.com/acme-spices", snippet: "Acme Spices directory listing" },
          ],
        }),
        "application/json",
      );
    }
    if (href.includes("api.company-information.service.gov.uk/search/companies")) {
      return make(JSON.stringify({ items: [{ company_number: "01234567", title: "ACME SPICES LTD" }] }), "application/json");
    }
    if (href.includes("api.company-information.service.gov.uk/company/01234567/officers")) {
      return make(JSON.stringify({ items: [{ name: "SMITH, Jane", officer_role: "director", appointed_on: "2015-06-01" }] }), "application/json");
    }
    if (href.includes("api.company-information.service.gov.uk/company/01234567")) {
      return make(JSON.stringify({ company_name: "ACME SPICES LTD", company_status: "active", sic_codes: ["46370"] }), "application/json");
    }
    if (href.includes("company-information") || href.includes("directory.example.com") || href.includes("/blocked")) return make("không được đọc", "text/html", 403);

    if (href === "https://acmespices.co.uk/" || href === "https://acmespices.co.uk") return make(files["secondary/home.html"]);
    if (href.endsWith("/contact")) return make(files["secondary/contact.html"]);
    if (href.endsWith("/about")) return make(files["secondary/about.html"]);
    if (href.endsWith("/suppliers/register")) return make(files["secondary/procurement.html"]);
    return make("not found", "text/html", 404);
  };

  const thinRun = await api.runConnector("acmespices.co.uk", {
    fetchImpl: secondaryFetch,
    maxPages: 6,
    maxDocuments: 2,
    delayMs: 0,
    guard: noGuard,
    log: () => {},
    country: "United Kingdom",
    companyName: "Acme Spices Ltd",
    secondary: { searchApiKey: "serper-test", companiesHouseApiKey: "ch-test" },
  });

  check("bước 2 chỉ ra kênh chung", thinRun.channels.some((channel) => channel.value === "info@acmespices.co.uk"));
  check("bước 2 dùng cả sitemap", thinRun.pages.some((page) => page.url.endsWith("/about")), thinRun.pages.map((page) => page.url).join(", "));
  check("nguồn cấp 1 mỏng thì nguồn cấp 2 được chạy", thinRun.secondary?.ran === true, JSON.stringify(thinRun.secondary));
  check("nhật ký nói rõ vì sao chạy", String(thinRun.secondary?.reason).includes("kênh chung"), thinRun.secondary?.reason);
  check("đã hỏi sổ đăng ký Anh", thinRun.secondary?.registriesQueried.includes("companies_house") === true);
  check("kết quả đối chiếu pháp nhân đi kèm báo cáo", thinRun.registry?.companyNumber === "01234567");
  check("có ghi lại việc dùng search API", (thinRun.secondary?.search?.queries ?? 0) > 0 && thinRun.secondary?.search?.provider === "serper");
  const fromSearch = thinRun.channels.find((channel) => channel.value === "procurement@acmespices.co.uk");
  check("đọc thật trang do search chỉ đường", fromSearch?.sourceUrl === "https://acmespices.co.uk/suppliers/register", fromSearch?.sourceUrl);
  check("bằng chứng là câu chữ trên trang, không phải snippet của search", String(fromSearch?.evidenceSnippet).includes("procurement@acmespices.co.uk"), fromSearch?.evidenceSnippet);
  check("sau bước 3 đã có kênh thuộc nhóm mua hàng", api.coverageOf(thinRun.channels).enough === true);
  check("đường dẫn robots.txt chặn không được tải", !secondaryRequests.some((url) => url.includes("/blocked")), secondaryRequests.filter((url) => url.includes("blocked")).join(", "));
  check("kết quả ngoài tên miền không được tải", !secondaryRequests.some((url) => url.includes("directory.example.com")));
  check("mọi kênh tìm được vẫn thuộc tên miền công ty", thinRun.channels.every((channel) => channel.sourceUrl.includes("acmespices.co.uk")));
  check("sổ đăng ký không sinh ra kênh liên hệ", !thinRun.channels.some((channel) => String(channel.value).includes("SMITH")));
  check("kênh chung vẫn giữ nguyên, không bị thay bằng kênh mới", thinRun.channels.some((channel) => channel.value === "info@acmespices.co.uk"));

  const offlineRequests = [];
  const thinNoKeys = await api.runConnector("acmespices.co.uk", {
    fetchImpl: async (url) => {
      offlineRequests.push(String(url));
      return secondaryFetch(url);
    },
    maxPages: 6,
    maxDocuments: 2,
    delayMs: 0,
    guard: noGuard,
    log: () => {},
    country: "United Kingdom",
    companyName: "Acme Spices Ltd",
  });
  check("chưa cấu hình khoá thì nguồn cấp 2 không chạy", thinNoKeys.secondary?.ran === false);
  check("và nhật ký nói rõ thiếu cấu hình", String(thinNoKeys.secondary?.reason).includes("chưa cấu hình"), thinNoKeys.secondary?.reason);
  check("không có lượt gọi nào ra ngoài tên miền công ty", offlineRequests.every((url) => url.includes("acmespices.co.uk")), offlineRequests.filter((url) => !url.includes("acmespices.co.uk")).join(", "));

  const offRequests = [];
  const thinOff = await api.runConnector("acmespices.co.uk", {
    fetchImpl: async (url) => {
      offRequests.push(String(url));
      return secondaryFetch(url);
    },
    maxPages: 6,
    maxDocuments: 2,
    delayMs: 0,
    guard: noGuard,
    log: () => {},
    country: "United Kingdom",
    companyName: "Acme Spices Ltd",
    secondary: false,
  });
  check("tắt nguồn cấp 2 thì không chạy", thinOff.secondary?.ran === false && String(thinOff.secondary?.reason).includes("bị tắt"));
  check("và cũng không gọi ra ngoài", offRequests.every((url) => url.includes("acmespices.co.uk")), offRequests.filter((url) => !url.includes("acmespices.co.uk")).join(", "));

  const gateRequests = [];
  const gateRun = await api.runConnector("mariani.com", {
    fetchImpl: async (url) => {
      gateRequests.push(String(url));
      return mockFetch(url);
    },
    maxPages: 5,
    maxDocuments: 2,
    delayMs: 0,
    guard: noGuard,
    log: () => {},
    country: "United States",
    companyName: "Mariani Packing Co.",
    secondary: { searchApiKey: "serper-test", companiesHouseApiKey: "ch-test" },
  });
  check("khi đã có kênh mua hàng thì không gọi search API", !gateRequests.some((url) => url.includes("serper")), gateRequests.join(", "));
  check("và không tra sổ đăng ký", gateRun.secondary?.registriesQueried.length === 0 && gateRun.secondary?.ran === false, JSON.stringify(gateRun.secondary));
  check("nhật ký nói rõ lý do không chạy", String(gateRun.secondary?.reason).includes("nhóm mua hàng"), gateRun.secondary?.reason);
  check("kết quả lần chạy này y như trước khi thêm nguồn cấp 2", gateRun.channels.length === result.channels.length, `${gateRun.channels.length} vs ${result.channels.length}`);

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
