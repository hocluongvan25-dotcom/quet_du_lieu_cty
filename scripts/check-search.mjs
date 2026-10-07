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
 * Ba điều lệnh này **không** làm, vì đã từng làm sai:
 *  1. Không coi "HTTP 200" là bằng chứng nối được. Nhà cung cấp có thể trả 200
 *     kèm thân lỗi; `hasSearchShape` bắt đúng ca đó và nói thẳng là chưa nối được.
 *  2. Không in ra `undefined`. Trước đây, khi không gom được module, script in
 *     đúng một chữ "undefined" rồi thoát — người đọc tưởng đó là kết quả gọi
 *     mạng. Giờ mọi chỗ in đều có giá trị dự phòng, và lỗi gom module nói rõ.
 *  3. Không đoán nhà cung cấp từ hình dạng khoá ngoài tiền tố đã biết (`tvly-`).
 *
 * Không có khoá: thoát 0 kèm hướng dẫn — chạy thiếu bước 3 là trạng thái bình
 * thường, connector vẫn đủ bước 1 và bước 2 (`--no-secondary`).
 * Có khoá nhưng chưa nối được: thoát 1 kèm lý do cụ thể.
 */

import { cleanupTsModules, loadEnvFile, loadTsModule } from "./lib/ts-module.mjs";

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

/** Che khoá: chỉ để lại phần nhận dạng được, không để lộ bí mật khi dán log lên chat. */
function maskKey(key) {
  const dash = key.indexOf("-");
  const prefix = dash > 0 && dash <= 12 ? key.slice(0, dash + 1) : key.slice(0, Math.min(6, key.length));
  return `${prefix}… (${key.length} ký tự)`;
}

function explainStatus(status) {
  if (status === 401 || status === 403) {
    return "Khoá sai, hết hạn, hoặc thuộc nhà cung cấp khác — kiểm SEARCH_PROVIDER có khớp khoá không.";
  }
  if (status === 404) return "Sai đường dẫn — thường là sai nhà cung cấp cho khoá này.";
  if (status === 429) return "Hết quota của tháng/ngày. Connector tự bỏ qua bước 3 khi bị chặn, không làm hỏng lần chạy.";
  if (status >= 500) return "Lỗi phía nhà cung cấp. Không phải khoá hỏng — thử lại sau.";
  return "Xem thân phản hồi bên dưới để biết nhà cung cấp nói gì.";
}

async function main() {
  const env = { ...loadEnvFile(), ...process.env };
  const apiKey = (env.SEARCH_API_KEY ?? "").trim();
  const explicit = (env.SEARCH_PROVIDER ?? "").trim();

  console.log("Kiểm khoá Search API cho nguồn cấp 2 (bước 3 của thiết kế chuẩn).\n");

  if (!apiKey) {
    console.log(`  ${INFO} Chưa cắm SEARCH_API_KEY — đây là trạng thái bình thường.`);
    console.log(`  ${INFO} Không có khoá, connector vẫn chạy đủ bước 1 và bước 2 (đọc website công ty),`);
    console.log(`  ${INFO} chỉ bỏ bước 3 (search + sổ đăng ký) — và luôn chạy được với --no-secondary.`);
    console.log(`  ${INFO} Khi nào muốn bật: lấy khoá ở một trong ba nhà cung cấp dưới, rồi thêm hai dòng vào .env.local\n`);
    for (const [key, info] of Object.entries(PROVIDERS)) {
      console.log(`      ${key.padEnd(7)} ${info.label} — ${info.hint}`);
    }
    console.log(`\n      SEARCH_API_KEY=<khoá>`);
    console.log(`      SEARCH_PROVIDER=tavily     # chỉ cần khi khoá không có tiền tố tvly-`);
    console.log(`\n  ${INFO} Khoá Tavily (bắt đầu bằng "tvly-") được nhận ra tự động, không cần đặt SEARCH_PROVIDER.`);
    console.log(`  ${INFO} Chạy lại lệnh này sau khi thêm — nó gọi đúng request mà connector dùng.`);
    process.exit(0);
  }

  const api = await loadTsModule(
    'export { buildSearchRequest, parseSearchHits, countProviderRows, hasSearchShape, resolveProvider, providerFromKey } from "@/lib/connector/secondary";',
    { tag: "search" },
  );

  const resolved = api.resolveProvider(apiKey, explicit);
  if (!resolved) {
    console.error(`  ${FAIL} Không chọn được nhà cung cấp nào từ khoá và SEARCH_PROVIDER.`);
    process.exit(1);
  }

  const fromKey = api.providerFromKey(apiKey);
  const explicitValid = ["serper", "tavily", "brave"].includes(explicit.toLowerCase());
  const via = explicitValid
    ? `SEARCH_PROVIDER=${explicit}`
    : fromKey
      ? `nhận ra khoá ${PROVIDERS[fromKey].label} từ tiền tố "${fromKey === "tavily" ? "tvly-" : fromKey}" (SEARCH_PROVIDER chưa đặt)`
      : "mặc định serper (SEARCH_PROVIDER chưa đặt)";

  console.log(`  ${INFO} Khoá: ${maskKey(apiKey)}`);
  console.log(`  ${INFO} Nhà cung cấp: ${PROVIDERS[resolved].label} — ${via}`);
  if (explicitValid && fromKey && explicit.toLowerCase() !== fromKey) {
    console.error(`  ${FAIL} Cảnh báo: khoá này là của ${PROVIDERS[fromKey].label} nhưng SEARCH_PROVIDER=${explicit} — vẫn gọi theo cấu hình.`);
    console.error(`  ${INFO} Nếu kết quả bên dưới là lỗi xác thực, sửa lại: SEARCH_PROVIDER=${fromKey}`);
  }

  const { url, init } = api.buildSearchRequest(PROBE_DOMAIN, PROBE_QUERY, resolved, apiKey);
  const endpoint = new URL(url);
  console.log(`  ${INFO} Sẽ gọi: ${endpoint.origin}${endpoint.pathname}`);
  console.log(`  ${INFO} Truy vấn: site:${PROBE_DOMAIN} "${PROBE_QUERY}" — tên miền công khai, không phải của khách hàng.`);

  const started = Date.now();
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : String(error ?? "không rõ lý do");
    console.error(`  ${FAIL} Không gọi được ${PROVIDERS[resolved].label}: ${reason}`);
    console.error(`  ${INFO} Kiểm tra mạng rồi chạy lại. Connector bỏ qua bước 3 cho tới khi gọi được.`);
    process.exit(1);
  }
  const elapsed = Date.now() - started;
  const body = await response.text().catch(() => "");
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    console.error(`  ${FAIL} HTTP ${response.status} sau ${elapsed}ms — chưa nối được.`);
    console.error(`  ${INFO} ${explainStatus(response.status)}`);
    if (body) console.error(`  ${INFO} Thân phản hồi: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  // HTTP 200 chưa đủ. Sai khoá/sai endpoint cũng có thể trả 200 kèm thân lỗi —
  // và mảng kết quả rỗng thì dễ bị đọc thành "nối được nhưng không có kết quả".
  if (!api.hasSearchShape(payload, resolved)) {
    console.error(`  ${FAIL} HTTP 200 nhưng phản hồi KHÔNG phải kết quả tìm kiếm của ${PROVIDERS[resolved].label}.`);
    console.error(`  ${INFO} Nghĩa là chưa nối được: nhà cung cấp trả 200 kèm thân lỗi (thường là sai khoá hoặc sai endpoint).`);
    console.error(`  ${INFO} Đúng hình dạng phải là ${resolved === "serper" ? '"organic": [...]' : resolved === "tavily" ? '"results": [...]' : '"web": { "results": [...] }'}.`);
    console.error(`  ${INFO} Thân phản hồi: ${body.slice(0, 400) || "(rỗng)"}`);
    process.exit(1);
  }

  const rows = api.countProviderRows(payload, resolved);
  const hits = api.parseSearchHits(payload, resolved, PROBE_DOMAIN);
  console.log(`  ${OK} HTTP 200 sau ${elapsed}ms — ${PROVIDERS[resolved].label} trả lời với đúng hình dạng kết quả tìm kiếm.`);
  console.log(`  ${OK} ${rows} dòng kết quả, ${hits.length} dòng thuộc ${PROBE_DOMAIN} (đã qua hàng rào tên miền của connector).`);

  if (rows === 0) {
    console.log(`  ${INFO} 0 dòng không có nghĩa là khoá hỏng — nhà cung cấp trả lời bình thường, chỉ là truy vấn này không có kết quả với họ.`);
  } else if (hits.length > 0) {
    console.log(`  ${INFO} Ví dụ: ${hits[0].url}`);
  } else {
    console.log(`  ${INFO} Có dòng kết quả nhưng không dòng nào thuộc ${PROBE_DOMAIN}: nhà cung cấp này không lọc theo "site:" như Google.`);
    console.log(`  ${INFO} Connector vẫn an toàn (hàng rào tên miền thứ hai), và với Tavily thì tên miền còn được gửi kèm`);
    console.log(`  ${INFO} bằng "include_domains" — chạy lần thật để xem kết quả trong tên miền công ty.`);
  }

  console.log(`\n  ${OK} Khoá dùng được: bước 3 sẵn sàng, và chỉ chạy khi bước 2 chưa tới được cửa mua hàng của công ty.`);
  console.log(`  ${INFO} Trên Supabase: thêm SEARCH_API_KEY (và SEARCH_PROVIDER nếu khoá không có tiền tố tvly-) vào Project Settings → Edge/Environment.`);
  console.log(`  ${INFO} Nhắc lại luật của lớp này: đoạn mô tả của công cụ tìm kiếm KHÔNG phải bằng chứng —`);
  console.log(`  ${INFO} connector tải trang về rồi trích câu chữ thật; kết quả ngoài tên miền bị bỏ.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => cleanupTsModules());
