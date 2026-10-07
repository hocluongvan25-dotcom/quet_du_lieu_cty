#!/usr/bin/env node
/**
 * Kiểm một số có tài khoản WhatsApp — bằng chính WhatsApp Business của mình:
 *
 *   npm run whatsapp:check -- +84912345678 +447700900123
 *
 * **Không gửi tin nhắn nào.** Cả hai request đều là câu hỏi: hỏi tài khoản đang
 * gọi là số nào, rồi hỏi Meta số kia có WhatsApp không.
 *
 * Chưa có thông tin đăng nhập: lệnh này in ra **các bước lấy** (số test trước,
 * số thật sau, token dài hạn) rồi thoát 0 — vì thiếu phần này là bình thường.
 *
 * Có rồi: đọc kết quả và nói thẳng kết quả nào là kết quả nào. Ba dòng có thể
 * ra — `valid` (có), `invalid` (không có), `unknown` (Meta không kết luận).
 * `unknown` **không** phải "không có", và không bao giờ được ghi thành `false`.
 */

import { cleanupTsModules, loadEnvFile, loadTsModule } from "./lib/ts-module.mjs";

const OK = "✓";
const FAIL = "✗";
const INFO = "•";

const EXPORTS = [
  'export { buildWhatsappCheckRequest, buildWhatsappAccountRequest, parseWhatsappAccount, parseWhatsappCheck, describeWhatsappCheck } from "@/lib/connector/whatsapp";',
  'export { toE164, isE164 } from "@/lib/connector/phone";',
];

function guide() {
  console.log(`  ${INFO} Chưa có thông tin đăng nhập WhatsApp Cloud API — đây là trạng thái bình thường.`);
  console.log(`  ${INFO} Nút wa.me sẽ vẫn nằm im cho tới khi có dòng nào đó được kiểm và ghi lại.\n`);
  console.log("  Các bước lấy (làm một lần):\n");
  console.log("   1. developers.facebook.com → Create App → loại \"Business\" → thêm sản phẩm WhatsApp.");
  console.log("      Mục WhatsApp → API Setup hiện ra **số test của Meta** + token tạm (24 giờ) + Phone Number ID.");
  console.log("      Số test gửi được cho tối đa 5 số đã thêm sẵn — đủ để thử xem endpoint /contacts có trả lời không.");
  console.log("");
  console.log("   2. Muốn dùng số thật: số đó phải được đăng ký vào Cloud API. Hai đường:");
  console.log("      - **Coexistence**: giữ nguyên WhatsApp Business app và cắm thêm Cloud API trên CÙNG số.");
  console.log("        Không đổi số, không mất lịch sử (sync tối đa 6 tháng chat 1:1; nhóm không sync;");
  console.log("        trần 20 tin/giây; phải mở app ít nhất mỗi 13 ngày; KHÔNG được gỡ app khỏi máy).");
  console.log("        Bật qua một Tech Provider / Solution Partner của Meta — không tự bật trong app được.");
  console.log("      - **Chuyển hẳn sang API**: số đó không còn dùng được trên app, và lịch sử ở lại app.");
  console.log("");
  console.log("   3. Token dài hạn (token ở API Setup chỉ sống 24 giờ):");
  console.log("      business.facebook.com → Settings → Users → System users → Add (role Admin)");
  console.log("      → Assign assets: chọn app VÀ chọn WhatsApp account (WABA)");
  console.log("      → Generate new token: expiry **Never**, quyền whatsapp_business_messaging + whatsapp_business_management.");
  console.log("      Token chỉ hiện một lần — dán thẳng vào .env.local, đừng qua chat, ảnh chụp hay ghi chú.");
  console.log("");
  console.log("   4. Điền vào .env.local (file này đã được gitignore, không lên repo):\n");
  console.log("        WHATSAPP_PHONE_NUMBER_ID=<Phone Number ID ở API Setup>");
  console.log("        WHATSAPP_ACCESS_TOKEN=<token của System user>");
  console.log("        # WHATSAPP_API_VERSION=v26.0        (mặc định; chỉ đổi khi Meta đổi bản)");
  console.log("");
  console.log("   5. Rồi chạy, đưa số cần kiểm vào sau dấu --:\n");
  console.log("        npm run whatsapp:check -- +84912345678");
  console.log("");
  console.log(`  ${INFO} Lệnh này KHÔNG gửi tin nhắn nào. Nó chỉ hỏi, và không ghi gì vào database.`);
  console.log(`  ${INFO} Không cần đưa token cho ai: chạy lệnh rồi dán lại phần chữ nó in ra là đủ (token đã bị che).`);
}

function metaError(body) {
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error;
    if (!error) return null;
    return {
      message: typeof error.message === "string" ? error.message : "",
      code: error.code ?? null,
      subcode: error.error_subcode ?? null,
      type: typeof error.type === "string" ? error.type : "",
    };
  } catch {
    return null;
  }
}

function explainMetaError(status, error) {
  if (status === 401 || error?.code === 190) {
    console.error(`  ${INFO} Token không hợp lệ hoặc đã hết hạn. Token ở API Setup chỉ sống 24 giờ — dùng token của System user.`);
    return;
  }
  if (status === 403 || error?.code === 200) {
    console.error(`  ${INFO} Token thiếu quyền. Cần whatsapp_business_messaging (và whatsapp_business_management) khi tạo token.`);
    return;
  }
  if (error?.code === 100 || status === 404) {
    console.error(`  ${INFO} Meta không biết endpoint này trên tài khoản đó. Nhiều khả năng /contacts chỉ có ở On-Premises API (đã ngừng),`);
    console.error(`  ${INFO} hoặc chưa mở cho tài khoản này. Kết luận: đường A không dùng được ngay → chuyển sang đường B`);
    console.error(`  ${INFO} (gửi một template rồi đọc trạng thái webhook: sent = số có WhatsApp, delivered = máy đã nhận được).`);
    return;
  }
  if (status === 429) {
    console.error(`  ${INFO} Bị chặn vì tần suất. Chờ rồi chạy lại — không phải khoá hỏng.`);
  }
}

async function call(url, init, label) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    console.error(`  ${FAIL} Không gọi được ${label}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`  ${INFO} Kiểm tra mạng rồi chạy lại.`);
    process.exit(1);
  }
}

async function main() {
  const env = { ...loadEnvFile(), ...process.env };
  const token = (env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const phoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const version = (env.WHATSAPP_API_VERSION ?? "").trim() || undefined;

  console.log("Kiểm một số có tài khoản WhatsApp — qua chính WhatsApp Business của mình.\n");

  if (!token || !phoneNumberId) {
    guide();
    process.exit(0);
  }

  const raw = process.argv.slice(2).filter((value) => !value.startsWith("-"));
  if (raw.length === 0) {
    console.error(`  ${FAIL} Có thông tin đăng nhập nhưng chưa có số nào để kiểm.`);
    console.error(`  ${INFO} Cách dùng: npm run whatsapp:check -- +84912345678`);
    console.error(`  ${INFO} Nhiều số thì cách nhau bằng dấu cách. Số phải ở dạng quốc tế (bắt đầu bằng + hoặc 00).`);
    process.exit(1);
  }

  const api = await loadTsModule(EXPORTS, { tag: "whatsapp" });

  // Chuẩn hoá: chỉ những số đã có mã quốc gia (+, hoặc lối 00) mới đi tiếp. Số
  // nội địa cần biết quốc gia của công ty, và lệnh kiểm không được đoán.
  const numbers = [];
  const rejected = [];
  for (const value of raw) {
    const normalized = api.isE164(value) ? { ok: true, value } : api.toE164(value);
    if (normalized.ok) numbers.push(normalized.value);
    else rejected.push({ value, reason: normalized.reason });
  }
  if (rejected.length > 0) {
    console.error(`  ${FAIL} ${rejected.length} số không dùng được (cần mã quốc gia, dạng +84912345678):`);
    for (const item of rejected) console.error(`      ${item.value} — ${item.reason}`);
    console.error(`  ${INFO} Số nội địa thì chuẩn hoá trước bằng toE164(số, quốc gia) — hàm này cần quốc gia của công ty.`);
    process.exit(1);
  }

  const redact = (text) => String(text).split(token).join("•••");

  // (1) Đang gọi trên số nào? Thử trên số test của Meta khác hẳn số thật.
  const accountRequest = api.buildWhatsappAccountRequest(phoneNumberId, token, version);
  const accountResponse = await call(accountRequest.url, accountRequest.init, "Meta");
  const accountBody = await accountResponse.text();
  console.log("  Bước 1 — tài khoản đang gọi là số nào:");
  if (!accountResponse.ok) {
    const error = metaError(accountBody);
    console.error(`  ${FAIL} HTTP ${accountResponse.status} — chưa xác định được số đang gọi.`);
    if (error?.message) console.error(`  ${INFO} Meta nói: ${redact(error.message)}${error.code ? ` (code ${error.code})` : ""}`);
    explainMetaError(accountResponse.status, error);
    process.exit(1);
  }
  let account = null;
  try {
    account = api.parseWhatsappAccount(JSON.parse(accountBody));
  } catch {
    account = null;
  }
  if (account) {
    console.log(`  ${OK} ${account.displayPhoneNumber ?? "(không có số trong phản hồi)"}${account.verifiedName ? ` — ${account.verifiedName}` : ""}`);
    console.log(`  ${INFO} Đây là số sẽ hỏi Meta. Nếu là số test của Meta thì kết quả chỉ nói về tài khoản test.`);
  } else {
    console.log(`  ${INFO} Gọi được nhưng phản hồi không có số/tên — đi tiếp bước 2 vẫn được.`);
  }

  // (2) Câu hỏi chính.
  console.log(`\n  Bước 2 — hỏi Meta ${numbers.length} số có tài khoản WhatsApp không:`);
  const checkRequest = api.buildWhatsappCheckRequest(phoneNumberId, token, numbers, version);
  const response = await call(checkRequest.url, checkRequest.init, "Meta");
  const responseBody = await response.text();

  if (!response.ok) {
    const error = metaError(responseBody);
    console.error(`  ${FAIL} HTTP ${response.status} — endpoint /contacts không trả lời trên tài khoản này.`);
    if (error?.message) {
      console.error(`  ${INFO} Meta nói: ${redact(error.message)}${error.code ? ` (code ${error.code}${error.subcode ? `/${error.subcode}` : ""})` : ""}`);
    } else if (responseBody) {
      console.error(`  ${INFO} Trả về: ${redact(responseBody).slice(0, 300)}`);
    }
    explainMetaError(response.status, error);
    console.error(`\n  ${FAIL} Chưa kiểm được bằng đường A. Không có gì được ghi vào database, không tin nhắn nào được gửi.`);
    process.exit(1);
  }

  let payload = null;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    payload = null;
  }
  const checks = api.parseWhatsappCheck(payload);

  if (checks.length === 0) {
    console.error(`  ${FAIL} HTTP 200 nhưng không có danh sách kết quả — không kết luận được gì về ${numbers.length} số.`);
    console.error(`  ${INFO} Đây là "unknown", không phải "không có WhatsApp". Không ghi gì vào database.`);
    console.error(`  ${INFO} Cần tự soi payload thật để biết endpoint trả hình dạng gì.`);
    process.exit(1);
  }

  console.log(`  ${OK} Endpoint /contacts trả lời trên tài khoản này — đường A dùng được.`);
  for (const check of checks) {
    const mark = check.verdict === "valid" ? OK : check.verdict === "invalid" ? FAIL : INFO;
    console.log(`      ${mark} ${api.describeWhatsappCheck(check)}`);
  }

  const valid = checks.filter((check) => check.verdict === "valid");
  const unknown = checks.filter((check) => check.verdict === "unknown");
  console.log(`\n  ${OK} ${valid.length}/${checks.length} số có WhatsApp${unknown.length > 0 ? `, ${unknown.length} số chưa kết luận được` : ""}.`);
  console.log(`  ${INFO} Không có tin nhắn nào được gửi. Muốn nút wa.me sáng lên thì số phải được ghi lại:`);
  console.log(`  ${INFO} update public.contact_channels set has_whatsapp = true, whatsapp_checked_at = now(),`);
  console.log(`  ${INFO}   whatsapp_checked_by = 'cloud_api_contacts' where id = '<channel-id>';`);
  console.log(`  ${INFO} (ràng buộc trong database đòi đủ cả ba thứ, và đòi phone_e164 — nút chat không mở bằng số chưa rõ mã quốc gia)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => cleanupTsModules());
