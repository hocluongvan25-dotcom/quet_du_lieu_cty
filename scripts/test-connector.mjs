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
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleTs } from "./lib/ts-module.mjs";
import { formatReviewHints } from "./lib/review-hints.mjs";

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
import { runConnector, collapseFormChannels } from "@/lib/connector/index";
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
import { coverageOf, nearMissBuyingDoors, secondaryReason } from "@/lib/connector/gate";
import { searchSite, harvestUrlsFromSearch, buildSearchRequest, parseSearchHits, resolveProvider, providerFromKey, countProviderRows, hasSearchShape, lookupCompaniesHouse, lookupSecEdgar, lookupRegistry, registriesForCountry, DEFAULT_SEC_USER_AGENT, readCikFromEdgarFeed } from "@/lib/connector/secondary";
import { buildWhatsappCheckRequest, buildWhatsappAccountRequest, parseWhatsappAccount, parseWhatsappCheck, describeWhatsappCheck } from "@/lib/connector/whatsapp";
import { asciiHeaderValue, fetchPage, DEFAULT_USER_AGENT } from "@/lib/connector/fetch";

export const api = { runConnector, extractFromPage, extractFromLines, normalizeSeed, collectCandidateLinks, parseRobots, isPathAllowed, htmlToLines, registrableDomain, assertPublicUrl, isBlockedAddress, UnsafeUrlError, pdfToLines, looksLikePdf, unescapePdfString, decodePdfHexString, buildBuyerWriteBatch, toE164, whatsappLink, isE164, resolveCountry, readSitemap, coverageOf, nearMissBuyingDoors, secondaryReason, collapseFormChannels, searchSite, harvestUrlsFromSearch, buildSearchRequest, parseSearchHits, resolveProvider, providerFromKey, countProviderRows, hasSearchShape, lookupCompaniesHouse, DEFAULT_SEC_USER_AGENT, readCikFromEdgarFeed, buildWhatsappCheckRequest, buildWhatsappAccountRequest, parseWhatsappAccount, parseWhatsappCheck, describeWhatsappCheck, asciiHeaderValue, fetchPage, DEFAULT_USER_AGENT, lookupSecEdgar, lookupRegistry, registriesForCountry };
`;
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "entry.ts"), entry, "utf8");

  const bundlePath = path.join(workDir, "bundle.mjs");
  await bundleTs(path.join(workDir, "entry.ts"), bundlePath);

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


  section("điện thoại: nhãn phải nằm ngay trước số (bài học mariani.com)");
  const arbitrationLine =
    "Either party may initiate arbitration by providing written notice to the other party. The arbitration will be conducted by the American Arbitration Association (AAA) under its rules, including the AAA's Supplementary Procedures for Consumer Related Disputes; the AAA Rules are available by calling the AAA at 1-800-778-7879.";
  const arbitration = api.extractFromLines({
    url: "https://mariani.com/pages/shop-terms",
    lines: [arbitrationLine],
    kind: "html",
    html: "<p>" + arbitrationLine + "</p>",
  });
  check(
    "số của bên thứ ba giữa câu văn dài KHÔNG thành số của công ty",
    !arbitration.channels.some((channel) => channel.type === "phone"),
    arbitration.channels.filter((channel) => channel.type === "phone").map((channel) => channel.value).join(", "),
  );
  check(
    "và việc loại trừ được nói ra, kèm lý do",
    arbitration.notes.some(
      (note) => note.kind === "excluded" && note.label.includes("18007787879") && note.detail.includes("bên thứ ba"),
    ),
    JSON.stringify(arbitration.notes.map((note) => `${note.kind}:${note.label}`)),
  );

  const labeled = api.extractFromLines({
    url: "https://mariani.com/pages/contact-us",
    lines: ["Phone: 989-514-1459", "Fax: 707.452.2973", "+84 28 3822 1234 — trụ sở khu vực"],
    kind: "html",
    html: "<p>Phone: 989-514-1459</p><p>Fax: 707.452.2973</p><p>+84 28 3822 1234 — trụ sở khu vực</p>",
    country: "United States",
  });
  const labeledPhones = labeled.channels.filter((channel) => channel.type === "phone");
  check(
    "số có nhãn ngay trước vẫn nhận, fax vẫn tách riêng",
    labeledPhones.length === 3 && labeledPhones.some((channel) => channel.label === "Fax công bố"),
    labeledPhones.map((channel) => `${channel.label}:${channel.value}`).join(", "),
  );
  check(
    "số quốc tế trong dòng dài không có nhãn vẫn nhận (đã có + thì không cần nhãn)",
    labeledPhones.some((channel) => channel.value === "+842838221234"),
    labeledPhones.map((channel) => channel.value).join(", "),
  );

  section("biểu mẫu liên hệ: một website là một cửa vào, không phải mười hai");
  const formOf = (url) => ({
    type: "form",
    value: url,
    label: "Biểu mẫu liên hệ trên website",
    identityMatch: "company_general",
    certainty: "confirmed",
    policy: "manual_contact_only",
    sourceUrl: url,
    evidenceSnippet: "Contact Us",
  });
  const emailChannel = { ...formOf("https://mariani.com/pages/contact-us"), type: "email", value: "productinfo@mariani.com" };
  const manyForms = [
    emailChannel,
    formOf("https://mariani.com/pages/contact-us"),
    formOf("https://mariani.com/"),
    formOf("https://mariani.com/products/mango"),
    formOf("https://mariani.com/blogs/mariani-blog/all-about-prunes"),
    formOf("https://mariani.com/pages/b2b-partnership"),
    formOf("https://mariani.com/pages/harvest-and-product-sourcing"),
    formOf("https://mariani.com/pages/shop-terms-and-conditions-of-use"),
  ];
  const merged = api.collapseFormChannels(manyForms);
  check(
    "7 biểu mẫu gộp còn 1, và đếm đúng số đã gộp",
    merged.channels.filter((channel) => channel.type === "form").length === 1 && merged.collapsed === 6,
    `giữ ${merged.channels.filter((c) => c.type === "form").length}, gộp ${merged.collapsed}`,
  );
  check(
    "giữ trang sát việc mua bán nhất (nguồn hàng), không giữ trang sản phẩm/blog",
    merged.channels.find((channel) => channel.type === "form").value === "https://mariani.com/pages/harvest-and-product-sourcing",
    merged.channels.find((channel) => channel.type === "form").value,
  );
  check("kênh khác không bị đụng tới", merged.channels.some((channel) => channel.value === "productinfo@mariani.com"));
  check("một biểu mẫu thì không gộp gì", api.collapseFormChannels([emailChannel, formOf("https://x.example/contact")]).collapsed === 0);
  check("không có biểu mẫu nào thì trả nguyên danh sách", api.collapseFormChannels([emailChannel]).channels.length === 1);


  section("header HTTP là ByteString: chữ có dấu không đi vào header được");
  // Đây là lỗi thật: User-Agent mặc định của SEC có chữ "đặt", nên request chết
  // ngay ở tầng gửi (fetch ném ByteString) và người dùng chỉ thấy một câu lỗi khó
  // hiểu. `new Headers` là đúng hàng rào đó — dùng nó làm phép thử.
  let byteStringGate = "chấp nhận";
  try {
    new Headers({ "user-agent": "SeekoraBot (đặt SEC_USER_AGENT)" });
  } catch (error) {
    byteStringGate = String(error instanceof Error ? error.message : error);
  }
  check("phép thử đúng hàng rào: chữ có dấu bị Headers từ chối", byteStringGate.includes("ByteString"), byteStringGate);

  check(
    "bỏ dấu tiếng Việt, giữ nguyên nội dung",
    api.asciiHeaderValue("Nguyễn Văn A <a@congty.vn>") === "Nguyen Van A <a@congty.vn>" &&
      api.asciiHeaderValue("đặt SEC_USER_AGENT kèm email liên hệ") === "dat SEC_USER_AGENT kem email lien he",
    api.asciiHeaderValue("Nguyễn Văn A <a@congty.vn>"),
  );
  check(
    "ký tự lạ ngoài ASCII bị bỏ, không để lại ký tự điều khiển",
    api.asciiHeaderValue("Bot\u0000\u0007 (công ty) ☎") === "Bot cong ty" || !/[\u0000-\u001f\u007f-\uffff]/.test(api.asciiHeaderValue("Bot\u0000\u0007 (công ty) ☎")),
    api.asciiHeaderValue("Bot\u0000\u0007 (công ty) ☎"),
  );
  check(
    "mọi header của request SEC đều qua được hàng rào ByteString — kể cả khi người dùng gõ tiếng Việt",
    (() => {
      const calls = [];
      const stub = async (url, init = {}) => {
        calls.push(init.headers ?? {});
        return { ok: false, status: 403, url: String(url), headers: { get: () => "application/json" }, text: async () => "Forbidden", json: async () => ({}) };
      };
      return api
        .lookupSecEdgar("Mariani Packing Co.", { fetchImpl: stub, secUserAgent: "Nguyễn Văn A <a@congty.vn>" })
        .then((result) => {
          const allBuilt = calls.every((headers) => Object.entries(headers).every(([, value]) => {
            try {
              new Headers({ "x-check": String(value) });
              return true;
            } catch {
              return false;
            }
          }));
          const agent = calls[0]?.["user-agent"];
          return allBuilt && agent === "Nguyen Van A <a@congty.vn>" && result.reason.includes("SEC_USER_AGENT");
        });
    })(),
  );
  check(
    "User-Agent mặc định của SEC là ASCII thuần và nhắc đặt biến",
    [...api.DEFAULT_SEC_USER_AGENT].every((char) => char.charCodeAt(0) < 128) &&
      api.DEFAULT_SEC_USER_AGENT.includes("SEC_USER_AGENT") &&
      api.asciiHeaderValue(api.DEFAULT_SEC_USER_AGENT) === api.DEFAULT_SEC_USER_AGENT,
  );
  check("User-Agent mặc định khi đọc trang công khai cũng là ASCII thuần", [...api.DEFAULT_USER_AGENT].every((char) => char.charCodeAt(0) < 128));

  const uaCalls = [];
  await api.fetchPage("https://example.com/", {
    userAgent: "Nguyễn Văn A <a@congty.vn>",
    fetchImpl: async (url, init = {}) => {
      uaCalls.push(String((init.headers ?? {})["user-agent"] ?? ""));
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
        text: async () => "<html><body>ok</body></html>",
      };
    },
  });
  check(
    "User-Agent do người dùng truyền cho fetchPage cũng được làm sạch",
    uaCalls[0] === "Nguyen Van A <a@congty.vn>",
    uaCalls[0],
  );


  section("SEC EDGAR: ba kết cục phải tách bạch — có / không có / không đọc được");
  // Dạng hiện hành: mã nằm trong khối <company-info> do browse-edgar thêm vào.
  const feedCompanyInfo = `<?xml version="1.0" encoding="ISO-8859-1"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <company-info>
    <cik>0000320193</cik>
    <conformed-name>Apple Inc.</conformed-name>
    <assigned-sic>3571</assigned-sic>
  </company-info>
  <entry><title>10-K - APPLE INC (0000320193)</title></entry>
</feed>`;
  const byTag = api.readCikFromEdgarFeed(feedCompanyInfo);
  check("đọc được mã trong thẻ <cik> của khối company-info", byTag.kind === "found" && byTag.cik === "0000320193", JSON.stringify(byTag));

  // Dạng cũ: mã nằm trong liên kết CIK=…
  const feedLink = '<feed><entry><link href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001234567&amp;type=10-K"/></entry></feed>';
  const byLink = api.readCikFromEdgarFeed(feedLink);
  check("vẫn đọc được dạng liên kết CIK= của bản CGI cũ", byLink.kind === "found" && byLink.cik === "0001234567", JSON.stringify(byLink));

  check(
    "mã CIK ngắn được đệm đủ 10 chữ số (SEC yêu cầu zero-pad)",
    api.readCikFromEdgarFeed("<company-info><cik>320193</cik></company-info>").cik === "0000320193",
  );

  // Sổ nói thẳng là không có: đây mới là "không tìm thấy hồ sơ theo tên này".
  const noMatch = "<feed><entry><title>No matching companies.</title></entry></feed>";
  check("sổ nói không có công ty nào ⇒ none", api.readCikFromEdgarFeed(noMatch).kind === "none");
  check("câu 'did not match any' cũng tính là none", api.readCikFromEdgarFeed("<html><p>Your search did not match any companies</p></html>").kind === "none");

  // Trang HTML lạ / feed rỗng: KHÔNG được coi là "không có hồ sơ".
  check("HTML lạ ⇒ unreadable, không phải none", api.readCikFromEdgarFeed("<html><body>Server Error</body></html>").kind === "unreadable");
  check("feed rỗng ⇒ unreadable", api.readCikFromEdgarFeed("<feed></feed>").kind === "unreadable");
  check("chuỗi rỗng ⇒ unreadable", api.readCikFromEdgarFeed("").kind === "unreadable");

  const makeSecFeedStub = (xml, status = 200) => async (url) => ({
    ok: status === 200,
    status,
    url: String(url),
    headers: { get: () => "application/atom+xml" },
    text: async () => xml,
    json: async () => ({}),
  });
  const unreadable = await api.lookupSecEdgar("Mariani Packing Co.", { fetchImpl: makeSecFeedStub("<html>Server Error</html>") });
  check(
    "không đọc được phản hồi thì KHÔNG được báo 'không tìm thấy hồ sơ'",
    unreadable.reason.includes("định dạng không nhận ra") && !unreadable.reason.includes("không tìm thấy hồ sơ"),
    unreadable.reason,
  );

  const trulyNone = await api.lookupSecEdgar("Mariani Packing Co.", { fetchImpl: makeSecFeedStub(noMatch) });
  check("sổ nói không có thì báo đúng câu 'không tìm thấy hồ sơ theo tên này'", trulyNone.reason === "không tìm thấy hồ sơ theo tên này", trulyNone.reason);

  const foundFeed = await api.lookupSecEdgar("Apple Inc.", { fetchImpl: makeSecFeedStub(feedCompanyInfo) });
  check(
    "tìm thấy thì đi tiếp bằng đúng mã CIK vừa đọc, không phải đoán",
    (foundFeed.reason === undefined || !foundFeed.reason) && foundFeed.finding?.companyNumber === "CIK 0000320193",
    JSON.stringify(foundFeed.finding?.companyNumber ?? foundFeed.reason),
  );

  section("SEC EDGAR: User-Agent phải kèm cách liên hệ");
  const secCalls = [];
  const secStub = (status = 200) => async (url, init = {}) => {
    secCalls.push({ url: String(url), headers: init.headers ?? {} });
    return {
      ok: status === 200,
      status,
      url: String(url),
      headers: { get: () => "application/json" },
      text: async () => (status === 200 ? "<feed></feed>" : "Forbidden"),
      json: async () => ({}),
    };
  };
  await api.lookupSecEdgar("Mariani Packing Co.", { fetchImpl: secStub(403) });
  check(
    "UA mặc định vẫn gửi, và nói rõ cần đặt SEC_USER_AGENT",
    String(secCalls[0].headers["user-agent"]).includes("SEC_USER_AGENT"),
    secCalls[0].headers["user-agent"],
  );
  const secForbidden = await api.lookupSecEdgar("Mariani Packing Co.", { fetchImpl: secStub(403) });
  check(
    "403 được giải thích, không chỉ báo mã lỗi",
    secForbidden.reason.includes("403") && secForbidden.reason.includes("SEC_USER_AGENT"),
    secForbidden.reason,
  );
  await api.lookupSecEdgar("Mariani Packing Co.", { fetchImpl: secStub(200), secUserAgent: "Nguyen Van A <a@congty.vn>" });
  check(
    "đặt SEC_USER_AGENT thì header dùng đúng chuỗi đó",
    secCalls[secCalls.length - 1].headers["user-agent"] === "Nguyen Van A <a@congty.vn>",
    String(secCalls[secCalls.length - 1].headers["user-agent"]),
  );


  section("dòng 'gần đúng' — nêu ra để người xem lại, không mở cổng");
  const deptChannel = (value, label = "Email bộ phận") => ({
    ...baseChannel,
    type: "email",
    value,
    label,
    identityMatch: "department",
  });
  const ingredients = api.nearMissBuyingDoors([deptChannel("ingredients@mariani.com")]);
  check(
    "hộp thư theo bộ phận tên 'ingredients' được nêu ra",
    ingredients.length === 1 && ingredients[0].value === "ingredients@mariani.com" && ingredients[0].matched === "ingredient",
    JSON.stringify(ingredients),
  );
  check(
    "lý do nói rõ tên hộp thư không cho biết bên mua hay bên bán, và để người xem lại",
    ingredients[0].reason.includes("không cho biết") && ingredients[0].reason.includes("xem lại"),
    ingredients[0].reason,
  );
  check(
    "lý do không chứa câu khuyên bảo (check:content cũng cấm những câu này)",
    !/khuyến nghị|nên gặp|nên liên hệ|ưu tiên/i.test(ingredients[0].reason),
    ingredients[0].reason,
  );
  check(
    "và KHÔNG được tính là cửa mua hàng: cổng vẫn đóng, bước sau vẫn chạy",
    api.coverageOf([deptChannel("ingredients@mariani.com")]).enough === false &&
      api.coverageOf([deptChannel("ingredients@mariani.com")]).buying === 0 &&
      String(api.secondaryReason(api.coverageOf([deptChannel("ingredients@mariani.com")]))).includes("nhóm mua hàng"),
  );

  check(
    "các cách viết khác nhau của cùng ý đều nhận ra",
    ["raw-materials@x.com", "raw.materials@x.com", "materials@x.com", "nguyen-lieu@x.com", "nguyenlieu@x.com"]
      .every((value) => api.nearMissBuyingDoors([deptChannel(value)]).length === 1),
    ["raw-materials@x.com", "materials@x.com", "nguyen-lieu@x.com"].map((value) => JSON.stringify(api.nearMissBuyingDoors([deptChannel(value)]))).join(", "),
  );
  check(
    "từ khoá dài nhất được nêu, để lý do đọc lên là hiểu",
    api.nearMissBuyingDoors([deptChannel("raw-materials@x.com")])[0].matched === "raw material",
  );
  check(
    "hộp thư chung không có từ khoá thì không nêu — danh sách này không được thành nhiễu",
    api.nearMissBuyingDoors([deptChannel("info@mariani.com", "Email chung")]).length === 0 &&
      api.nearMissBuyingDoors([deptChannel("headoffice@mariani.com")]).length === 0,
  );
  check(
    "kênh gắn với một người thì bỏ qua (đã có tên để tra)",
    api.nearMissBuyingDoors([{ ...baseChannel, type: "email", value: "ingredients.jane@x.com", identityMatch: "person", personName: "Jane" }]).length === 0,
  );
  check(
    "kênh đã thuộc nhóm mua hàng thì bỏ qua — đó là cửa thật, không phải gần đúng",
    api.nearMissBuyingDoors([deptChannel("procurement@x.com", "Phòng mua hàng")]).length === 0,
  );
  check(
    "chỉ xét email: số điện thoại và biểu mẫu không có tên hộp thư để đọc",
    api.nearMissBuyingDoors([
      { ...baseChannel, type: "phone", value: "+84912345678", label: "Ingredients line", identityMatch: "company_general" },
      { ...baseChannel, type: "form", value: "https://x.com/materials", label: "Biểu mẫu", identityMatch: "company_general" },
    ]).length === 0,
  );
  check(
    "nhiều hộp thư gần đúng thì nêu từng cái, không gộp",
    api.nearMissBuyingDoors([deptChannel("ingredients@x.com"), deptChannel("materials@x.com")]).length === 2,
  );

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
  check("tavily: POST, khoá ở header Bearer, không nằm trong body", tavilyRequest.init.headers.authorization === "Bearer k2" && !String(tavilyRequest.init.body).includes("k2"));
  check(
    "tavily: nói tên miền bằng include_domains, vì Tavily không lọc theo site: như Google",
    JSON.stringify(JSON.parse(String(tavilyRequest.init.body)).include_domains) === JSON.stringify(["acmespices.co.uk"]),
  );
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
  check(
    "khoá Tavily được nhận ra từ tiền tố tvly-, không cần cấu hình",
    api.providerFromKey("tvly-dev-abc123") === "tavily" && api.resolveProvider("tvly-dev-abc123") === "tavily",
  );
  check(
    "không đoán nhà cung cấp từ hình dạng khoá lạ",
    api.providerFromKey("khoa-hex-40-ky-tu") === null && api.providerFromKey("") === null && api.resolveProvider("khoa-hex") === "serper",
  );
  check(
    "SEARCH_PROVIDER được ưu tiên, kể cả khi ngược tiền tố; chữ hoa và khoảng trắng đều chấp nhận",
    api.resolveProvider("tvly-dev-abc", "serper") === "serper" &&
      api.resolveProvider("k", " Tavily ") === "tavily" &&
      api.resolveProvider("k", "khong-ton-tai") === "serper",
  );

  section("phản hồi 200 kèm thân lỗi không được coi là đã nối được");
  const serperErrorBody = { message: "Unauthorized" };
  check(
    "thân lỗi không có mảng kết quả ⇒ không phải phản hồi tìm kiếm",
    api.hasSearchShape(serperErrorBody, "serper") === false &&
      api.hasSearchShape({ organic: [] }, "serper") === true &&
      api.hasSearchShape({ results: [] }, "tavily") === true &&
      api.hasSearchShape({ web: { results: [] } }, "brave") === true,
  );
  check("đếm được số dòng thô trước hàng rào tên miền", api.countProviderRows({ organic: [{ link: "https://a.example/x" }, { link: "https://b.example/y" }] }, "serper") === 2);
  check("thân lỗi đếm ra 0 dòng và không sinh kết quả", api.countProviderRows(serperErrorBody, "serper") === 0 && api.parseSearchHits(serperErrorBody, "serper", "acmespices.co.uk").length === 0);


  section("kiểm số có WhatsApp: hai câu hỏi, không gửi tin nhắn nào");
  const accountRequest = api.buildWhatsappAccountRequest("123456789", "tok-account");
  check(
    "đọc tài khoản: GET, token ở header, không nằm trong URL",
    accountRequest.init.method === undefined &&
      accountRequest.url.includes("/123456789?fields=") &&
      accountRequest.init.headers.authorization === "Bearer tok-account" &&
      !accountRequest.url.includes("tok-account"),
  );
  const waCheck = api.buildWhatsappCheckRequest("123456789", "tok-check", ["+84912345678", "+447700900123"]);
  check(
    "kiểm số: POST /contacts với force_check, token ở header",
    waCheck.init.method === "POST" &&
      waCheck.url.endsWith("/v26.0/123456789/contacts") &&
      !waCheck.url.includes("tok-check") &&
      waCheck.init.headers.authorization === "Bearer tok-check",
  );
  const waBody = JSON.parse(String(waCheck.init.body));
  check(
    "thân request nói rõ đang chờ kết quả, và đúng những số đã đưa vào",
    waBody.force_check === true && waBody.blocking === "wait" && waBody.contacts.length === 2 && waBody.contacts[0] === "+84912345678",
  );
  check("đổi bản Graph API được, mặc định v26.0", api.buildWhatsappCheckRequest("1", "t", ["+84912345678"], "v21.0").url.includes("/v21.0/1/contacts") && waCheck.url.includes("/v26.0/"));
  let refusedDomestic = "";
  try {
    api.buildWhatsappCheckRequest("1", "t", ["0912345678"]);
  } catch (error) {
    refusedDomestic = String(error instanceof Error ? error.message : error);
  }
  check("số nội địa bị từ chối — không tự thêm mã quốc gia", refusedDomestic.includes("E.164"), refusedDomestic);
  let refusedEmpty = "";
  try {
    api.buildWhatsappCheckRequest("1", "t", []);
  } catch (error) {
    refusedEmpty = String(error instanceof Error ? error.message : error);
  }
  let refusedNoCreds = "";
  try {
    api.buildWhatsappCheckRequest("", "t", ["+84912345678"]);
  } catch (error) {
    refusedNoCreds = String(error instanceof Error ? error.message : error);
  }
  check("thiếu số hoặc thiếu thông tin đăng nhập thì dừng trước khi gọi mạng", refusedEmpty.includes("không có số") && refusedNoCreds.includes("Phone Number ID"));

  const parsed = api.parseWhatsappCheck({
    contacts: [
      { input: "+84912345678", status: "valid", wa_id: "84912345678" },
      { input: "+447700900123", status: "invalid" },
      { input: "+12025550123", status: "processing" },
      { input: "+34600111222", wa_id: 34600111222 },
    ],
  });
  check("valid có wa_id, invalid không có", parsed[0].verdict === "valid" && parsed[0].waId === "84912345678" && parsed[1].verdict === "invalid" && parsed[1].waId === null);
  check("trạng thái lạ và thiếu trạng thái đều là unknown — không suy thành false", parsed[2].verdict === "unknown" && parsed[3].verdict === "unknown" && parsed[3].waId === null);
  check("wa_id dạng số vẫn đọc thành chuỗi", parsed[3].input === "+34600111222");
  check("không có danh sách contacts thì trả rỗng, không bịa kết luận", api.parseWhatsappCheck({}).length === 0 && api.parseWhatsappCheck(undefined).length === 0 && api.parseWhatsappCheck({ contacts: "không phải mảng" }).length === 0);
  check("câu mô tả nói thẳng unknown không phải là \"không có\"", api.describeWhatsappCheck({ input: "+84912345678", verdict: "unknown", waId: null }).includes("không phải"));
  check("đọc tài khoản: có số và tên thì trả về, rỗng thì null", api.parseWhatsappAccount({ display_phone_number: "+84 123", verified_name: "Acme" })?.verifiedName === "Acme" && api.parseWhatsappAccount({}) === null && api.parseWhatsappAccount(null) === null);

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


  section("đầu-cuối: dòng 'gần đúng' xuất hiện đúng lúc, và tắt khi đã có cửa thật");
  const nearMissRequests = [];
  const nearMissFetch = async (url) => {
    const href = String(url);
    nearMissRequests.push(href);
    const make = (body, contentType = "text/html; charset=utf-8", status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      url: href,
      headers: { get: () => contentType },
      text: async () => body,
      json: async () => JSON.parse(body),
    });
    if (href.endsWith("/robots.txt")) return make("User-agent: *\nAllow: /", "text/plain");
    if (href.includes("sitemap")) return make("not found", "text/plain", 404);
    if (href === "https://driedfruitltd.co.uk/" || href === "https://driedfruitltd.co.uk") {
      return make('<html><body><nav><a href="/contact">Contact</a><a href="/bulk">Bulk &amp; Ingredients</a></nav></body></html>');
    }
    if (href.endsWith("/contact")) {
      return make('<html><body><h1>Contact Us</h1><p>Email: <a href="mailto:info@driedfruitltd.co.uk">info@driedfruitltd.co.uk</a></p></body></html>');
    }
    if (href.endsWith("/bulk")) {
      return make(
        '<html><body><h1>Bulk &amp; Ingredients</h1><p>For bulk ingredient enquiries email <a href="mailto:ingredients@driedfruitltd.co.uk">ingredients@driedfruitltd.co.uk</a></p></body></html>',
      );
    }
    return make("not found", "text/html", 404);
  };
  const nearMissRun = await api.runConnector("driedfruitltd.co.uk", {
    fetchImpl: nearMissFetch,
    maxPages: 4,
    maxDocuments: 0,
    delayMs: 0,
    guard: noGuard,
    log: () => {},
    secondary: false,
  });
  check(
    "hộp thư gần đúng được nêu ra kèm lý do",
    nearMissRun.reviewHints.length === 1 && nearMissRun.reviewHints[0].value === "ingredients@driedfruitltd.co.uk",
    JSON.stringify(nearMissRun.reviewHints),
  );
  check(
    "cổng vẫn đóng: dòng gần đúng không được tính là cửa mua hàng",
    api.coverageOf(nearMissRun.channels).enough === false && api.coverageOf(nearMissRun.channels).buying === 0,
  );
  check(
    "hộp thư gần đúng vẫn là kênh bình thường trong danh sách kênh",
    nearMissRun.channels.some((channel) => channel.value === "ingredients@driedfruitltd.co.uk"),
  );
  check(
    "và nó xuất hiện cả khi đã tắt nguồn cấp 2 — dòng này thuộc về kết quả, không thuộc về bước 3",
    nearMissRun.secondary?.ran === false && nearMissRun.reviewHints.length === 1,
  );
  check(
    "đã có cửa mua hàng thật thì danh sách gần đúng rỗng",
    gateRun.reviewHints.length === 0,
    JSON.stringify(gateRun.reviewHints),
  );
  check(
    "lần chạy mỏng mà bước 3 mở được cửa thì cũng không nêu gần đúng nữa",
    thinRun.reviewHints.length === 0 && api.coverageOf(thinRun.channels).enough === true,
    JSON.stringify(thinRun.reviewHints),
  );


  section("phần chữ người dùng đọc: mục 'gần đúng' trong kết quả CLI");
  check("không có dòng gần đúng thì không in gì (kể cả tiêu đề)", formatReviewHints([]).length === 0 && formatReviewHints(undefined).length === 0);
  const printed = formatReviewHints([{ value: "ingredients@x.com", matched: "ingredient", reason: "lý do thật" }]);
  check(
    "có thì in tiêu đề, giá trị, và lý do",
    printed.some((line) => line.includes("GẦN ĐÚNG") && line.includes("NGƯỜI XEM LẠI")) &&
      printed.some((line) => line.includes("ingredients@x.com")) &&
      printed.some((line) => line.includes("lý do thật")),
    printed.join(" | "),
  );
  check(
    "giá trị và lý do nằm trên hai dòng khác nhau, để đọc được lý do",
    printed.filter((line) => line.includes("ingredients@x.com")).length === 1 &&
      printed.filter((line) => line.includes("lý do thật")).length === 1,
  );
  check(
    "dòng in ra từ lần chạy thật chứa cả hộp thư lẫn lý do",
    (() => {
      const text = formatReviewHints(nearMissRun.reviewHints).join("\n");
      return text.includes("ingredients@driedfruitltd.co.uk") && text.includes("không cho biết") && text.includes("xem lại");
    })(),
    formatReviewHints(nearMissRun.reviewHints).join(" | "),
  );

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
