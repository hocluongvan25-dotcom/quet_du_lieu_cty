#!/usr/bin/env node
/**
 * Chạy connector thật trên máy bạn (cần internet):
 *
 *   npm run connector:run mariani.com
 *   npm run connector:run https://mariani.com/pages/contact-us -- --json
 *   npm run connector:run mariani.com -- --max-pages 8 --targets email,phone,linkedin
 *
 * Connector chỉ đọc trang công khai trong cùng tên miền (kể cả PDF: báo cáo,
 * press release, tài liệu nhà cung cấp), tôn trọng robots.txt, không đăng nhập,
 * không giải CAPTCHA, và không sinh email theo pattern.
 *
 *   npm run connector:run mariani.com -- --max-documents 4
 *
 * Bước 3 (nguồn cấp 2) tự chạy khi bước 2 chưa tới được cửa mua hàng. Cấu hình
 * bằng biến môi trường, không truyền qua tham số dòng lệnh:
 *
 *   SEARCH_API_KEY=...            # Serper / Tavily / Brave (chỉ để tìm URL cùng tên miền)
 *   SEARCH_PROVIDER=serper        # tuỳ chọn: serper | tavily | brave
 *   COMPANIES_HOUSE_API_KEY=...   # sổ đăng ký Anh (miễn phí, dữ liệu mở OGL)
 *
 *   npm run connector:run acmespices.co.uk -- --company "Acme Spices Ltd" --country "United Kingdom"
 *   npm run connector:run acmespices.co.uk -- --no-secondary   # chỉ đọc website công ty
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleTs, loadEnvFile } from "./lib/ts-module.mjs";

const root = process.cwd();
const workDir = path.join(root, ".connector-test");

/**
 * Đọc `.env.local` rồi mới tới biến môi trường của shell.
 *
 * Cả `search:check` và `whatsapp:check` đều đọc file này; nếu `connector:run` chỉ
 * đọc `process.env` thì khoá đã dán vào `.env.local` sẽ **âm thầm không được
 * dùng** — lần chạy vẫn xanh, chỉ là bước 3 bị bỏ qua, và không ai biết vì sao.
 * Cùng một file, cùng một cách đọc, ở mọi lệnh.
 */
const env = { ...loadEnvFile(), ...process.env };

function parseArgs(argv) {
  const args = { seed: "", json: false, maxPages: 6, maxDocuments: 3, delayMs: 400, targets: undefined, company: "", country: "", secondary: true };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--json") args.json = true;
    else if (value === "--max-pages") args.maxPages = Number(argv[++i]) || 6;
    else if (value === "--max-documents") args.maxDocuments = Number(argv[++i]) || 3;
    else if (value === "--delay") args.delayMs = Number(argv[++i]) || 0;
    else if (value === "--targets") args.targets = String(argv[++i] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (value === "--company") args.company = String(argv[++i] ?? "");
    else if (value === "--country") args.country = String(argv[++i] ?? "");
    else if (value === "--no-secondary") args.secondary = false;
    else if (value === "--") continue;
    else if (!value.startsWith("--")) rest.push(value);
  }
  args.seed = rest[0] ?? "";
  return args;
}

const CERTAINTY_VI = { confirmed: "đã thấy công bố", probable: "chưa kiểm lại", inferred: "suy luận" };
const POLICY_VI = {
  outreach_ready: "dùng được",
  needs_mailbox_check: "cần kiểm tra mailbox",
  manual_contact_only: "liên hệ thủ công",
  requires_override: "cần xác nhận",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.seed) {
    console.error("Thiếu tên miền. Ví dụ: npm run connector:run mariani.com");
    process.exit(2);
  }

  await mkdir(workDir, { recursive: true });
  const entry = `
import { runConnector } from "@/lib/connector/index";
export const runConnectorFn = runConnector;
`;
  await writeFile(path.join(workDir, "run.ts"), entry, "utf8");
  const bundlePath = path.join(workDir, "run.mjs");

  await bundleTs(path.join(workDir, "run.ts"), bundlePath);

  const { runConnectorFn } = await import(pathToFileURL(bundlePath).href);

  if (!args.json) {
    const searchFromShell = (process.env.SEARCH_API_KEY ?? "").trim();
    const hasSearch = Boolean(searchFromShell || (env.SEARCH_API_KEY ?? "").trim());
    const hasRegistry = Boolean((env.COMPANIES_HOUSE_API_KEY ?? "").trim());
    if (!args.secondary) {
      console.error("· nguồn cấp 2: đã tắt bằng --no-secondary");
    } else if (hasSearch || hasRegistry) {
      const parts = [];
      if (hasSearch) parts.push(`search (khoá từ ${searchFromShell ? "biến môi trường" : ".env.local"})`);
      if (hasRegistry) parts.push("sổ đăng ký Anh");
      console.error(`· nguồn cấp 2: có ${parts.join(" + ")} — chỉ chạy khi bước 2 chưa tới được cửa mua hàng`);
    } else {
      console.error("· nguồn cấp 2: chưa có khoá nào trong .env.local (SEARCH_API_KEY / COMPANIES_HOUSE_API_KEY) — bước 3 sẽ bị bỏ qua");
    }
  }

  const result = await runConnectorFn(args.seed, {
    maxPages: args.maxPages,
    maxDocuments: args.maxDocuments,
    delayMs: args.delayMs,
    targets: args.targets,
    companyName: args.company,
    country: args.country,
    secondary: args.secondary
      ? {
          searchApiKey: env.SEARCH_API_KEY,
          searchProvider: env.SEARCH_PROVIDER,
          companiesHouseApiKey: env.COMPANIES_HOUSE_API_KEY,
          secUserAgent: env.SEC_USER_AGENT,
        }
      : false,
    log: args.json ? () => {} : (message) => console.error(`· ${message}`),
  });

  await rm(workDir, { recursive: true, force: true });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const documents = result.pages.filter((page) => page.kind === "pdf").length;
  console.log(`\nCÔNG TY: ${result.domain}   (${result.pagesFetched} nguồn đã đọc${documents > 0 ? `, trong đó ${documents} PDF` : ""})`);
  console.log("\nKÊNH TÌM ĐƯỢC:");
  if (result.channels.length === 0) console.log("  (không có)");
  result.channels.forEach((channel) => {
    const who = channel.personName ? ` — ${channel.personName}${channel.personTitle ? ` (${channel.personTitle})` : ""}` : "";
    console.log(`  • ${channel.label}: ${channel.value}${who}`);
    console.log(`      tin cậy: ${CERTAINTY_VI[channel.certainty] ?? channel.certainty} · dùng: ${POLICY_VI[channel.policy] ?? channel.policy}`);
    console.log(`      nguồn: ${channel.sourceUrl}`);
    console.log(`      thấy ở: "${channel.evidenceSnippet}"`);
  });

  if (result.registry) {
    const registry = result.registry;
    console.log("\nĐỐI CHIẾU SỔ ĐĂNG KÝ (bước 1 — có đúng công ty này không):");
    console.log(`  ${registry.registryLabel}: ${registry.registeredName ?? "(không rõ tên)"}${registry.companyNumber ? ` — ${registry.companyNumber}` : ""}`);
    if (registry.status) console.log(`      tình trạng: ${registry.status}`);
    if (registry.incorporatedOn) console.log(`      thành lập: ${registry.incorporatedOn}`);
    if (registry.industry) console.log(`      ngành: ${registry.industry}`);
    if (registry.formerNames?.length) console.log(`      tên cũ: ${registry.formerNames.join(", ")}`);
    console.log(`      nguồn: ${registry.sourceUrl}`);
    if (registry.officers.length > 0) {
      console.log(`      người đương nhiệm (${registry.officers.length}, sổ không có email/điện thoại):`);
      registry.officers.slice(0, 10).forEach((officer) => {
        console.log(`        • ${officer.name} — ${officer.role}${officer.appointedOn ? ` (từ ${officer.appointedOn})` : ""}`);
      });
    }
  }

  if (result.secondary?.ran) {
    console.log("\nNGUỒN CẤP 2 ĐÃ DÙNG:");
    console.log(`  lý do: ${result.secondary.reason}`);
    if (result.secondary.search) console.log(`  search (${result.secondary.search.provider}): ${result.secondary.search.queries} truy vấn → ${result.secondary.search.urls} trang, ${result.secondary.search.documents} tài liệu`);
    if (result.secondary.registriesQueried.length > 0) console.log(`  sổ đăng ký đã hỏi: ${result.secondary.registriesQueried.join(", ")}`);
    if (result.secondary.registryReason) console.log(`  sổ đăng ký không cho kết quả: ${result.secondary.registryReason}`);
  }

  if (result.people.length > 0) {
    console.log("\nNGƯỜI TÌM ĐƯỢC:");
    result.people.forEach((person) => {
      console.log(`  • ${person.name}${person.title ? ` — ${person.title}` : ""} (${person.channelValues.join(", ")})`);
      console.log(`      nguồn: ${person.sourceUrl}`);
    });
  }

  if (result.notes.length > 0) {
    console.log("\nKHÔNG TÌM THẤY & ĐÃ LOẠI TRỪ:");
    result.notes.forEach((note) => {
      console.log(`  [${note.kind}] ${note.label}`);
      console.log(`      ${note.detail}`);
    });
  }

  console.log("\nNGUỒN ĐÃ ĐỌC:");
  result.pages.forEach((page) => {
    const kind = page.kind === "pdf" ? "PDF" : "trang";
    console.log(`  ${page.status === "skipped" ? "bỏ qua" : page.status} · ${kind} · ${page.url}${page.reason ? ` (${page.reason})` : ""}`);
  });
  console.log("");
}

main().catch(async (error) => {
  console.error(error);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
