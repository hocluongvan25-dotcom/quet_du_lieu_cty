#!/usr/bin/env node
/**
 * Chạy connector thật trên máy bạn (cần internet):
 *
 *   npm run connector:run mariani.com
 *   npm run connector:run https://mariani.com/pages/contact-us -- --json
 *   npm run connector:run mariani.com -- --max-pages 8 --targets email,phone,linkedin
 *
 * Connector chỉ đọc trang công khai trong cùng tên miền, tôn trọng robots.txt,
 * không đăng nhập, không giải CAPTCHA, và không sinh email theo pattern.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const workDir = path.join(root, ".connector-test");

function parseArgs(argv) {
  const args = { seed: "", json: false, maxPages: 6, delayMs: 400, targets: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--json") args.json = true;
    else if (value === "--max-pages") args.maxPages = Number(argv[++i]) || 6;
    else if (value === "--delay") args.delayMs = Number(argv[++i]) || 0;
    else if (value === "--targets") args.targets = String(argv[++i] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
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

  const build = spawnSync(
    "npx",
    ["--no-install", "esbuild", path.join(workDir, "run.ts"), "--bundle", "--platform=node", "--format=esm", "--alias:@=./src", `--outfile=${bundlePath}`, "--log-level=warning"],
    { cwd: root, encoding: "utf8" },
  );
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
  }

  const { runConnectorFn } = await import(pathToFileURL(bundlePath).href);

  const result = await runConnectorFn(args.seed, {
    maxPages: args.maxPages,
    delayMs: args.delayMs,
    targets: args.targets,
    log: args.json ? () => {} : (message) => console.error(`· ${message}`),
  });

  await rm(workDir, { recursive: true, force: true });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nCÔNG TY: ${result.domain}   (${result.pagesFetched} trang đã đọc)`);
  console.log("\nKÊNH TÌM ĐƯỢC:");
  if (result.channels.length === 0) console.log("  (không có)");
  result.channels.forEach((channel) => {
    const who = channel.personName ? ` — ${channel.personName}${channel.personTitle ? ` (${channel.personTitle})` : ""}` : "";
    console.log(`  • ${channel.label}: ${channel.value}${who}`);
    console.log(`      tin cậy: ${CERTAINTY_VI[channel.certainty] ?? channel.certainty} · dùng: ${POLICY_VI[channel.policy] ?? channel.policy}`);
    console.log(`      nguồn: ${channel.sourceUrl}`);
    console.log(`      thấy ở: "${channel.evidenceSnippet}"`);
  });

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

  console.log("\nTRANG ĐÃ ĐỌC:");
  result.pages.forEach((page) => {
    console.log(`  ${page.status === "skipped" ? "bỏ qua" : page.status} · ${page.url}${page.reason ? ` (${page.reason})` : ""}`);
  });
  console.log("");
}

main().catch(async (error) => {
  console.error(error);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
