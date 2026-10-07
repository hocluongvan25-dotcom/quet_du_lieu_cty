#!/usr/bin/env node
/**
 * Chạy lượt đọc lại định kỳ trên một app đang chạy.
 *
 *   npm run reverify:run                            # http://localhost:3000, 90 ngày
 *   npm run reverify:run -- --days 180 --limit 50
 *   BASE_URL=https://your-app npm run reverify:run
 *
 * Cần CRON_SECRET trong môi trường hoặc trong .env.local — cùng giá trị mà app
 * và lịch chạy tự động dùng. Chạy lại nhiều lần không sao: lần đọc lại chỉ ghi
 * thêm một dòng vào sổ, và kênh vừa được làm mới thì không còn trong hàng đợi.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

const fileEnv = loadEnvFile(resolve(process.cwd(), ".env.local"));
const secret = process.env.CRON_SECRET ?? fileEnv.CRON_SECRET ?? "";
const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

if (!secret) {
  console.error("✗ Thiếu CRON_SECRET. Thêm vào .env.local hoặc export trước khi chạy.");
  process.exit(1);
}

const args = process.argv.slice(2);
function numberArg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const parsed = Number.parseInt(args[index + 1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const body = { days: numberArg("days", 90), limit: numberArg("limit", 200) };
const endpoint = `${baseUrl}/api/maintenance/reverify`;

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok !== true) {
    console.error(`✗ HTTP ${response.status}`, payload.error ?? payload);
    process.exit(1);
  }

  console.log(`Ngưỡng: ${payload.thresholdDays} ngày · trong hàng đợi: ${payload.queued} · đã đọc lại: ${payload.checked}`);
  console.log(`  ✓ còn thấy: ${payload.stillPresent}`);
  console.log(`  − không còn: ${payload.gone}`);
  console.log(`  ? không mở được (giữ nguyên, thử lại lần sau): ${payload.unreachable}`);
  if (payload.skipped > 0) console.log(`  · bỏ qua (loại không đọc lại được): ${payload.skipped}`);
  console.log(`Đã ghi: ${payload.recorded}`);
  if (payload.failures?.length) {
    console.error(`✗ ${payload.failures.length} kết quả không ghi được:`);
    payload.failures.slice(0, 5).forEach((failure) => console.error(`    ${failure.channelId}: ${failure.error}`));
  }
} catch (error) {
  console.error(`✗ Không gọi được ${endpoint}: ${error.message}`);
  process.exit(1);
}
