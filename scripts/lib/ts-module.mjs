import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Gốc repo, suy từ vị trí file này (`scripts/lib/`) — không phụ thuộc cwd. */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workDir = path.join(root, ".ts-bundle");

/**
 * Nạp một module TypeScript của repo vào script Node **bằng đúng mã nguồn đang
 * có**. Lệnh kiểm phải gọi thứ connector chạy, không phải một bản chép lại —
 * bản chép lại sẽ đúng cho tới lần sửa tiếp theo.
 */
export async function loadTsModule(exportLine, { tag = "entry" } = {}) {
  await mkdir(workDir, { recursive: true });
  const entryPath = path.join(workDir, `${tag}.ts`);
  const bundlePath = path.join(workDir, `${tag}.mjs`);
  const source = Array.isArray(exportLine) ? exportLine.join("\n") : exportLine;
  await writeFile(entryPath, `${source}\n`, "utf8");

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

export async function cleanupTsModules() {
  await rm(workDir, { recursive: true, force: true });
}

/**
 * Đọc `.env.local` theo đúng cách Next.js đọc: file thắng biến môi trường sẵn
 * có của tiến trình (vì `.env*` là chỗ người dùng thật sự điền vào).
 */
export function loadEnvFile(file = path.join(root, ".env.local")) {
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
