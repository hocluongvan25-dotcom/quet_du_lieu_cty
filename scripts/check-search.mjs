#!/usr/bin/env node
/**
 * Tự kiểm khoá Search API (nguồn cấp 2):
 *
 *   npm run search:check
 *
 * Đọc `.env.local` (hoặc biến môi trường), rồi gọi **đúng request mà connector
 * dùng** — cùng hàm `buildSearchRequest`/`parseSearchHits` — để biết khoá có
 * chạy thật hay không. Kiểm bằng một request riêng không đi qua code của
 * connector là kiểm một thứ khác với thứ chạy thật.
 *
 * Không có khoá: thoát 0 kèm hướng dẫn — đây là trạng thái bình thường, toàn bộ
 * connector vẫn chạy miễn phí khi thiếu nguồn cấp 2 (`--no-secondary`).
 * Có khoá nhưng lỗi (401/403/429, mạng, khoá sai nhà cung cấp): thoát 1.
 */

import { readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const workDir = path.join(root, ".search-check");

const OK = "✓";
const FAIL = "✗";
const INFO = "•";

// Tên miền để thử: công khai, nhiều trang, có kết quả ổn định cho mọi câu hỏi.
// Không dùng tên miền của khách hàng — lệnh kiểm này không được đọc dữ liệu của ai.
const PROBE_DOMAIN = "wikipedia.org";
const PROBE_QUERY = "supplier registration";

const PROVIDERS = {
  serper: { label: "Serper.dev", hint: "https://serper.dev — 2.500 câu hỏi thử, sau đó ~1 USD/1.000 câu" },
  tavily: { label: "Tavily", hint: "https://tavily.com — 1.000 credit/tháng miễn phí" },
  brave: { label: "Brave Search API", hint: "https://brave.com/search/api — 5 USD credit/tháng (~1.000 câu)" },
};

function loadEnvFile(file) {
  const env = {};
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return env;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadSearchApi() {
  await mkdir(workDir, { recursive: true });
  const entryPath = path.join(workDir, "entry.ts");
  const bundlePath = path.join(workDir, "bundle.mjs");
  await writeFile(entryPath, 'export { buildSearchRequest, parseSearchHits, resolveProvider } from "@/lib/connector/secondary";\n', "utf8");

  const build = spawnSync(
    "npx",
    ["--no-install", "esbuild", entryPath, "--bundle", "--platform=node", "--format=esm", "--alias:@=./src", `--outfile=${bundlePath}`, "--log-level=warning"],
    { cwd: root, encoding: "utf8" },
  );
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }
  return import(pathToFileURL(bundlePath).href);
}

async function main() {
  const fileEnv = loadEnvFile(path.join(root, ".env.local"));
  const env = { ...fileEnv, ...process.env };
  const apiKey = (env.SEARCH_API_KEY ?? "").trim();
  const provider = ((env.SEARCH_PROVIDER ?? "").trim() || "serper").toLowerCase();

  console.log("Kiểm khoá Search API cho nguồn cấp 2 (bước 3 của thiết kế chuẩn).\n");

  if (!Object.keys(PROVIDERS).includes(provider)) {
    console.error(`  ${FAIL} SEARCH_PROVIDER="${provider}" không thuộc nhóm hỗ trợ: serper | tavily | brave`);
    process.exit(1);
  }

  if (!apiKey) {
    console.log(`  ${INFO} Chưa cắm SEARCH_API_KEY — đây là trạng thái bình thường.`);
    console.log(`  ${INFO} Không có khoá, connector vẫn chạy đủ bước 1 và bước 2 (đọc website công ty),`);
    console.log(`  ${INFO} chỉ bỏ bước 3 (search + sổ đăng ký) — và luôn chạy được với --no-secondary.`);
    console.log(`  ${INFO} Khi nào muốn bật: mua khoá ở một trong ba nhà cung cấp dưới, rồi thêm hai dòng vào .env.local\n`);
    for (const [key, info] of Object.entries(PROVIDERS)) {
      console.log(`      ${key.padEnd(7)} ${info.label} — ${info.hint}`);
    }
    console.log(`\n      SEARCH_PROVIDER=serper`);
    console.log(`      SEARCH_API_KEY=<khoá>`);
    console.log(`\n  ${INFO} Chạy lại lệnh này sau khi thêm — nó gọi đúng request mà connector dùng.`);
    process.exit(0);
  }

  const api = await loadSearchApi();
  const resolved = api.resolveProvider(apiKey, provider);
  console.log(`  ${INFO} Nhà cung cấp: ${PROVIDERS[provider].label} (SEARCH_PROVIDER=${resolved})`);
  console.log(`  ${INFO} Thử: site:${PROBE_DOMAIN} "${PROBE_QUERY}" — tên miền công khai, không phải của khách hàng.`);

  const { url, init } = api.buildSearchRequest(PROBE_DOMAIN, PROBE_QUERY, resolved, apiKey);
  const started = Date.now();
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    console.error(`  ${FAIL} Không gọi được ${PROVIDERS[provider].label}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`  ${INFO} Kiểm tra mạng, rồi chạy lại. Connector sẽ bỏ qua bước 3 cho tới khi gọi được.`);
    process.exit(1);
  }
  const elapsed = Date.now() - started;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`  ${FAIL} HTTP ${response.status} sau ${elapsed}ms — khoá chưa dùng được.`);
    if (response.status === 401 || response.status === 403) {
      console.error(`  ${INFO} Khoá sai, hết hạn, hoặc thuộc nhà cung cấp khác. Kiểm SEARCH_PROVIDER có khớp khoá không.`);
    } else if (response.status === 429) {
      console.error(`  ${INFO} Hết quota của tháng/ngày. Connector tự bỏ qua bước 3 khi bị chặn, không làm hỏng lần chạy.`);
    }
    if (body) console.error(`  ${INFO} Trả về: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const payload = await response.json();
  const hits = api.parseSearchHits(payload, resolved, PROBE_DOMAIN);
  console.log(`  ${OK} Khoá hoạt động — HTTP ${response.status}, ${elapsed}ms.`);
  console.log(`  ${OK} ${hits.length} kết quả cùng tên miền ${PROBE_DOMAIN} (đã qua đúng hàng rào của connector).`);

  if (hits.length === 0) {
    console.log(`  ${INFO} 0 kết quả không có nghĩa là khoá hỏng — nhà cung cấp có thể trả rỗng cho truy vấn này.`);
  } else {
    console.log(`  ${INFO} Ví dụ: ${hits[0].url}`);
    console.log(`  ${INFO} Nhắc lại luật của lớp này: đoạn mô tả của công cụ tìm kiếm KHÔNG phải bằng chứng —`);
    console.log(`  ${INFO} connector tải trang về rồi trích câu chữ thật; kết quả ngoài tên miền bị bỏ.`);
  }

  console.log(`\n  ${OK} Bước 3 sẵn sàng. Nó chỉ chạy khi bước 2 chưa tới được cửa mua hàng của công ty.`);
  console.log(`  ${INFO} Trên Supabase: thêm SEARCH_API_KEY + SEARCH_PROVIDER vào Project Settings → Edge/Environment.`);
  rmSync(workDir, { recursive: true, force: true });
}

main().catch((error) => {
  rmSync(workDir, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
