#!/usr/bin/env node
/**
 * Tự kiểm **đường đi thật của một lần research**, bằng dữ liệu sống:
 *
 *   npm run research:check                    # dùng tên mặc định
 *   npm run research:check -- "Vinamilk"
 *   npm run research:check -- "Sun-Maid Growers" "United States"
 *
 * Lệnh này chạy đúng chuỗi mà `POST /api/research` chạy khi đã đăng nhập:
 *
 *   tên công ty → search API (không giới hạn tên miền) → chọn website có bằng
 *   chứng tên → connector đọc trang công khai → dựng Company Report
 *
 * Nó **không** ghi vào Supabase và **không** trừ credits — phần ghi đã có
 * `npm run persist:test` chứng minh trên schema thật (đủ 12 migration). Ở đây
 * chỉ trả lời một câu: *với khoá và mạng hiện tại, app có ra được report thật
 * không, và nếu không thì người dùng sẽ nhận đúng câu gì.*
 *
 * Kết quả in ra gồm cả những chỗ **không** tìm được — đó là thông tin, không
 * phải lỗi: một report nói rõ "không thấy WhatsApp" đúng hơn một report im lặng.
 */

import { cleanupTsModules, loadEnvFile, loadTsModule } from "./lib/ts-module.mjs";

const OK = "✓";
const FAIL = "✗";
const INFO = "•";

const DEFAULT_NAME = "Mariani Packing";

function maskKey(key) {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

async function main() {
  const env = { ...loadEnvFile(), ...process.env };
  const apiKey = (env.SEARCH_API_KEY ?? "").trim();
  const explicit = (env.SEARCH_PROVIDER ?? "").trim();
  const companyName = (process.argv[2] ?? DEFAULT_NAME).trim();
  const country = (process.argv[3] ?? "").trim();

  console.log("Kiểm đường đi research thật (tên → website → đọc trang → report).\n");

  if (!apiKey) {
    console.log(`  ${INFO} Chưa có SEARCH_API_KEY — app sẽ dùng **provider mẫu**:`);
    console.log(`  ${INFO} báo cáo minh hoạ, có nhãn "dữ liệu mẫu", **0 credits**, không đọc nguồn nào.`);
    console.log(`  ${INFO} Đó là hành vi đúng thiết kế, không phải lỗi. Muốn bật research thật:`);
    console.log(`\n      SEARCH_API_KEY=<khoá Tavily/Serper/Brave>\n`);
    console.log(`  ${INFO} Sau khi thêm, chạy lại lệnh này để xem app sẽ ra gì.`);
    process.exit(0);
  }

  console.log(`  ${INFO} Khoá: ${maskKey(apiKey)}${explicit ? ` · SEARCH_PROVIDER=${explicit}` : ""}`);
  console.log(`  ${INFO} Tên công ty: "${companyName}"${country ? ` · quốc gia: ${country}` : ""}`);

  const api = await loadTsModule(
    [
      'export { searchOpenWeb } from "@/lib/connector/secondary";',
      'export { runConnector } from "@/lib/connector/index";',
      'export { pickOfficialDomain, websiteQueryFor } from "@/lib/data/company-resolver";',
      'export { buildConnectorReport } from "@/lib/data/connector-report";',
      'export { resolveResearchProvider } from "@/lib/data/research-provider";',
    ].join("\n"),
    { tag: "research" },
  );

  const provider = api.resolveResearchProvider({ searchKey: apiKey, reportCost: 5 });
  console.log(`  ${INFO} Provider: ${provider.provider} · ${provider.cost} credits/report\n`);

  // ------------------------------------------------------------ bước 1: website
  const query = api.websiteQueryFor(companyName, country);
  const outcome = await api.searchOpenWeb(query, { apiKey, provider: explicit || undefined });

  if (!outcome.ok) {
    const message =
      outcome.reason === "rejected"
        ? "Nhà cung cấp từ chối khoá (HTTP 401/403). Kiểm tra SEARCH_API_KEY."
        : `Không gọi được dịch vụ tìm kiếm: ${outcome.detail}.`;
    console.error(`  ${FAIL} ${message}`);
    console.error(`  ${INFO} App sẽ trả đúng câu này cho người dùng và **không trừ credits**.`);
    process.exit(1);
  }

  console.log(`  ${OK} Tìm kiếm: ${outcome.provider} trả ${outcome.hits.length} kết quả cho "${query}"`);
  for (const hit of outcome.hits.slice(0, 5)) {
    console.log(`      ${hit.url}`);
  }
  if (outcome.hits.length > 5) console.log(`      … và ${outcome.hits.length - 5} kết quả nữa`);

  const picked = api.pickOfficialDomain(outcome.hits, companyName);
  if (!picked) {
    console.error(`\n  ${FAIL} Không có kết quả nào mang bằng chứng tên ⇒ app KHÔNG chọn tên miền nào.`);
    console.error(`  ${INFO} Người dùng sẽ nhận: "Không tìm thấy website công khai nào khớp với tên… hãy dán link".`);
    console.error(`  ${INFO} Không trừ credits. Đây là lựa chọn có chủ ý: đoán tên miền sai thì report nói về một công ty khác.`);
    process.exit(1);
  }

  console.log(`\n  ${OK} Website công ty: ${picked.domain}  (chọn từ ${picked.url})`);
  for (const why of picked.why) console.log(`      vì ${why}`);
  if (picked.domain.split(".")[0].length < 6) {
    console.log(`  ${INFO} Tên miền ngắn — kiểm lại xem có đúng công ty không trước khi dùng report.`);
  }

  // ------------------------------------------------------- bước 2: đọc trang
  const started = Date.now();
  const result = await api.runConnector(picked.domain, {
    maxPages: 6,
    delayMs: 250,
    country: country || null,
    companyName,
    deadlineAt: Date.now() + 45_000,
    secondary: {
      searchApiKey: apiKey,
      searchProvider: explicit || undefined,
      companiesHouseApiKey: env.COMPANIES_HOUSE_API_KEY,
      secUserAgent: env.SEC_USER_AGENT,
    },
    log: (message) => console.log(`      ${message}`),
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n  ${OK} Đã đọc ${result.pagesFetched} trang trong ${seconds}s`);

  if (result.pagesFetched === 0) {
    console.error(`  ${FAIL} Không đọc được trang nào ⇒ app trả lỗi và **không trừ credits**.`);
    process.exit(1);
  }

  if (result.identityMatched === true) {
    console.log(`  ${OK} Tên công ty có trên trang đã đọc — danh tính được xác nhận`);
  } else {
    console.log(`  ${INFO} Chưa thấy tên "${companyName}" trên trang đã đọc — app ghi chú lại và hạ nhãn tin cậy (không kết luận sai website)`);
  }

  // ------------------------------------------------------- bước 3: kết quả
  const built = api.buildConnectorReport({
    companyName,
    country,
    result,
    locale: "vi",
    resolvedFrom: { url: picked.url, why: picked.why },
    retentionDays: 30,
  });

  console.log(`\n  Kênh liên hệ tìm được (${built.report.contacts.length}):`);
  if (built.report.contacts.length === 0) console.log("      — không có kênh nào trên các trang đã đọc");
  for (const contact of built.report.contacts.slice(0, 8)) {
    console.log(`      ${contact.type.padEnd(9)} ${contact.value}  ← ${contact.sourceUrl ?? contact.source}`);
  }

  const people = built.report.people ?? [];
  if (people.length > 0) {
    console.log(`\n  Người công bố kèm kênh (${people.length}):`);
    for (const person of people.slice(0, 5)) console.log(`      ${person.name} — ${person.title || "chưa rõ chức danh"}`);
  }

  console.log(`\n  Ghi chú cho người kiểm (${result.notes.length}):`);
  for (const note of result.notes.slice(0, 6)) console.log(`      [${note.kind}] ${note.label} — ${note.detail}`);
  if (result.reviewHints.length > 0) {
    console.log(`\n  Gần đúng — người xem lại (${result.reviewHints.length}):`);
    for (const hint of result.reviewHints) console.log(`      ${hint.value} — ${hint.reason}`);
  }

  console.log(`\n  ${OK} Confidence ${built.report.confidence}/100 · trạng thái ${built.report.status}`);
  for (const signal of built.report.signals) console.log(`      · ${signal}`);
  console.log(`\n  ${INFO} Nếu lưu: provider=connector, trừ ${provider.cost} credits, giữ ${result.pagesFetched} trang làm bằng chứng.`);
  console.log(`  ${INFO} Lệnh này KHÔNG ghi vào Supabase và không trừ credits.`);

  await cleanupTsModules();
}

main().catch(async (error) => {
  console.error(`\n${FAIL} ${error instanceof Error ? error.message : error}`);
  await cleanupTsModules().catch(() => {});
  process.exit(1);
});
