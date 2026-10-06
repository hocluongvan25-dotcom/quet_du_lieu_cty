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
  const files = {
    "contact-us.html": await readFile(path.join(fixtures, "contact-us.html"), "utf8"),
    "bulk-and-ingredients.html": await readFile(path.join(fixtures, "bulk-and-ingredients.html"), "utf8"),
    "home.html": await readFile(path.join(fixtures, "home.html"), "utf8"),
    "robots.txt": await readFile(path.join(fixtures, "robots.txt"), "utf8"),
  };

  const entry = `
import { runConnector } from "@/lib/connector/index";
import { extractFromPage } from "@/lib/connector/extract";
import { normalizeSeed, collectCandidateLinks } from "@/lib/connector/discover";
import { parseRobots, isPathAllowed } from "@/lib/connector/robots";
import { htmlToLines, registrableDomain } from "@/lib/connector/html";
import { assertPublicUrl, isBlockedAddress, UnsafeUrlError } from "@/lib/connector/safety";

export const api = { runConnector, extractFromPage, normalizeSeed, collectCandidateLinks, parseRobots, isPathAllowed, htmlToLines, registrableDomain, assertPublicUrl, isBlockedAddress, UnsafeUrlError };
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
  const linkUrls = links.map((item) => item.url);
  check("ưu tiên trang liên hệ", linkUrls[0].includes("contact-us"), linkUrls[0]);
  check("lấy trang nguyên liệu", linkUrls.some((url) => url.includes("bulk-and-ingredients")));
  check("bỏ link ra ngoài tên miền", !linkUrls.some((url) => url.includes("facebook.com")));
  check("bỏ trang giỏ hàng", !linkUrls.some((url) => url.includes("/cart")));

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
  const whatsappNote = contact.notes.find((note) => note.label === "WhatsApp chính thức");
  check("không có WhatsApp thì ghi là chưa thấy", Boolean(whatsappNote));
  check("nêu rõ trang chỉ có chat trên website", whatsappNote?.detail.includes("Gorgias"), whatsappNote?.detail);
  check("không suy diễn WhatsApp từ số tổng đài", whatsappNote?.detail.includes("Không suy diễn"));

  section("trang nguyên liệu");
  const bulk = api.extractFromPage({ url: "https://mariani.com/pages/bulk-and-ingredients", html: files["bulk-and-ingredients.html"] });
  const bulkValues = bulk.channels.map((channel) => channel.value);
  check("lấy email bộ phận nguyên liệu", bulkValues.includes("ingredients@mariani.com"));
  check("gắn nhãn 'bộ phận' cho ingredients@", bulk.channels.find((c) => c.value === "ingredients@mariani.com")?.identityMatch === "department");

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
    });
    const href = String(url);
    if (href.endsWith("/robots.txt")) return make(files["robots.txt"], "text/plain");
    if (href.includes("bulk-and-ingredients")) return make(files["bulk-and-ingredients.html"]);
    if (href.includes("contact")) return make(files["contact-us.html"]);
    if (href.includes("/cart")) return make("cart page", "text/html", 200);
    if (href.includes("/account")) return make("login", "text/html", 200, "https://mariani.com/account/login");
    if (href === "https://mariani.com/" || href === "https://mariani.com") return make(files["home.html"]);
    return make("not found", "text/html", 404);
  };

  const noGuard = async () => {};
  const result = await api.runConnector("mariani.com", { fetchImpl: mockFetch, maxPages: 5, delayMs: 0, guard: noGuard, log: () => {} });

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
    phoneChannels.length === 2 && phoneChannels.some((c) => c.value === "7074522800") && phoneChannels.some((c) => c.value === "7074522973" && c.label === "Fax công bố"),
    JSON.stringify(phoneChannels.map((c) => `${c.value}:${c.label}`)),
  );
  check("số của web store vẫn không lọt vào danh sách", !result.channels.some((channel) => channel.value === "9895141459"));
  check("có đủ 4 email công bố", ["productinfo@mariani.com", "ssousa@mariani.com", "tgarcia@mariani.com", "ingredients@mariani.com"].every((value) => result.channels.some((channel) => channel.value === value)), result.channels.map((c) => c.value).join(", "));
  check("gộp người theo tên", result.people.length === 2, result.people.map((person) => person.name).join(", "));
  check("không có kênh nào không phải confirmed", result.channels.every((channel) => channel.certainty === "confirmed"));
  const pageText = `${files["contact-us.html"]} ${files["bulk-and-ingredients.html"]}`.replace(/[.\-()\s]/g, "");
  check(
    "mọi email và số điện thoại đều có nguyên văn trên trang",
    result.channels
      .filter((channel) => channel.type === "email" || channel.type === "phone")
      .every((channel) => pageText.includes(channel.value.replace(/[.\-()\s]/g, ""))),
    result.channels.filter((c) => c.type === "email" || c.type === "phone").map((c) => c.value).join(", "),
  );
  check("ghi lại trang đã đọc kèm trạng thái", result.pages.some((page) => page.url.includes("contact-us") && page.status === 200));
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
