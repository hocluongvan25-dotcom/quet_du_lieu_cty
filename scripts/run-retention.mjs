#!/usr/bin/env node
/**
 * Runs the retention sweep against a running app.
 *
 *   npm run retention:run                       # http://localhost:3000
 *   BASE_URL=https://your-app npm run retention:run
 *
 * Needs CRON_SECRET in the environment or in .env.local — the same value the
 * app and the pg_cron schedule use. Safe to run repeatedly: rows whose Storage
 * object could not be deleted are kept for the next attempt.
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
  console.error("✗ CRON_SECRET is missing. Add it to .env.local or export it before running this script.");
  process.exit(1);
}

const endpoint = `${baseUrl}/api/maintenance/retention`;

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ trigger: "manual" }),
    signal: AbortSignal.timeout(120_000),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.ok !== true) {
    console.error(`✗ Retention sweep failed (HTTP ${response.status})`);
    console.error(`  ${body.error ?? "no details returned"}`);
    process.exit(1);
  }

  console.log(`✓ Retention sweep finished on ${baseUrl}`);
  console.log(`  artifacts found   : ${body.artifactsFound}`);
  console.log(`  artifacts removed : ${body.artifactsRemoved}`);
  console.log(`  evidence deleted  : ${body.deletedEvidence}`);
  console.log(`  reports deleted   : ${body.deletedReports}`);
  if (body.deferred) console.log(`  deferred (retry)  : ${body.deferred}`);
  if (body.storageError) console.log(`  storage warning   : ${body.storageError}`);
} catch (error) {
  console.error(`✗ Could not reach ${endpoint}`);
  console.error(`  ${error.message}`);
  console.error("  Start the app (npm run dev) or point BASE_URL at the deployed instance.");
  process.exit(1);
}
