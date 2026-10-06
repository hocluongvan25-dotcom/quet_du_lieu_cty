#!/usr/bin/env node
/**
 * Supabase connectivity self-check for Seekora / Company Intelligence.
 *
 *   npm run supabase:check
 *
 * Reads .env.local (falling back to real process env), then verifies:
 *   1. the project URL and the anon key belong to the same project,
 *   2. Supabase Auth responds and reports which sign-in methods are on,
 *   3. every table from supabase/migrations/001_company_intel_schema.sql
 *      exists and is readable,
 *   4. the private storage bucket `research-artifacts` exists.
 *
 * Exits with code 1 on the first hard failure so it can gate a deploy.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TABLES = [
  "organizations",
  "organization_members",
  "profiles",
  "research_jobs",
  "company_reports",
  "source_evidence",
  "credit_ledger",
];

const ARTIFACT_BUCKET = "research-artifacts";
const TIMEOUT_MS = 15_000;

const OK = "✓";
const FAIL = "✗";
const INFO = "•";

let failures = 0;

function pass(message) {
  console.log(`  ${OK} ${message}`);
}

function fail(message, detail) {
  failures += 1;
  console.log(`  ${FAIL} ${message}`);
  if (detail) console.log(`      ${detail}`);
}

function info(message) {
  console.log(`  ${INFO} ${message}`);
}

/** Minimal .env parser: KEY=value, # comments, optional surrounding quotes. */
function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const values = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function decodeJwtPayload(token) {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function request(url, { method = "GET", key, bearer, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(key ? { apikey: key } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      Accept: "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 300);
  }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

function describeError(error) {
  const cause = error?.cause?.code ?? error?.cause?.message;
  return cause && !String(error.message).includes(String(cause))
    ? `${error.message} (${cause})`
    : error.message;
}

async function main() {
  const fileEnv = loadEnvFile(resolve(process.cwd(), ".env.local"));
  const read = (name) => process.env[name] ?? fileEnv[name] ?? "";
  const source = Object.keys(fileEnv).length > 0 ? ".env.local" : "process environment";

  const rawUrl = read("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceKey = read("SUPABASE_SERVICE_ROLE_KEY");
  const url = rawUrl.replace(/\/+$/, "");

  console.log("\nSeekora — Supabase connection check");
  console.log(`Config source: ${source}\n`);

  if (!url || !anonKey) {
    fail(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required",
      "Run: cp .env.example .env.local  and fill in the project values.",
    );
    process.exit(1);
  }

  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;
  const projectRef = hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : null;
  info(`Project URL: ${url}`);
  info(`Anonymous key: ${anonKey.slice(0, 12)}…${anonKey.slice(-6)}`);
  info(`Service role key: ${serviceKey ? "present (server-only)" : "missing — RLS-restricted checks only"}`);

  // 1. The anon key must belong to the same project as the URL.
  console.log("\nProject identity");
  const anonClaims = decodeJwtPayload(anonKey);
  if (!anonClaims) {
    fail("The anon key is not a readable JWT");
  } else if (!projectRef) {
    info(`Custom domain "${hostname}" — skipping key/project ref comparison`);
    pass(`Anon key readable (role: ${anonClaims.role})`);
  } else if (anonClaims.ref !== projectRef) {
    fail(
      `Key/project mismatch: key ref "${anonClaims.ref}" vs URL ref "${projectRef}"`,
      "Copy both values from the same project's Settings > API page.",
    );
  } else {
    const expires = anonClaims.exp ? new Date(anonClaims.exp * 1000).toISOString() : "unknown";
    pass(`Anon key matches project "${projectRef}" (role: ${anonClaims.role}, expires: ${expires})`);
  }

  // 2. Auth service.
  console.log("\nAuth service");
  try {
    const health = await request(`${url}/auth/v1/health`, { key: anonKey });
    if (health.ok) {
      pass(`GoTrue reachable: ${health.body?.name ?? "ok"} ${health.body?.version ?? ""}`.trim());
    } else {
      fail(`Auth health returned HTTP ${health.status}`, JSON.stringify(health.body));
    }

    const settings = await request(`${url}/auth/v1/settings`, { key: anonKey });
    if (settings.ok) {
      const enabled = Object.entries(settings.body?.external ?? {})
        .filter(([, value]) => value === true)
        .map(([name]) => name);
      pass(`Sign-up enabled: ${settings.body?.disable_signup ? "no" : "yes"}`);
      info(`Providers enabled: ${enabled.length > 0 ? enabled.join(", ") : "none"}`);
      info(`Email confirmation required: ${settings.body?.mailer_autoconfirm ? "no" : "yes"}`);
    } else {
      fail(`Auth settings returned HTTP ${settings.status}`, JSON.stringify(settings.body));
    }
  } catch (error) {
    fail("Cannot reach Supabase Auth", describeError(error));
  }

  // 3. Schema: every table from the migration must exist.
  console.log("\nSchema (public)");
  const tableKey = serviceKey || anonKey;
  const readable = [];
  for (const table of TABLES) {
    try {
      const result = await request(
        `${url}/rest/v1/${table}?select=*&limit=1`,
        { key: tableKey, bearer: tableKey, headers: { Prefer: "count=exact" } },
      );

      if (result.status === 404) {
        fail(`Table "${table}" is missing`, "Apply supabase/migrations/001_company_intel_schema.sql.");
        continue;
      }
      if (!result.ok) {
        const detail = result.body?.message ?? JSON.stringify(result.body);
        fail(`Table "${table}" not readable (HTTP ${result.status})`, detail);
        continue;
      }

      const range = result.headers.get("content-range") ?? "";
      const total = range.includes("/") ? range.split("/")[1] : "?";
      readable.push(table);
      pass(`${table}: reachable (rows: ${total})`);
    } catch (error) {
      fail(`Cannot query "${table}"`, describeError(error));
    }
  }

  // 4. Storage bucket for permitted raw artifacts.
  console.log("\nStorage");
  if (!serviceKey) {
    info(`Skipped ${ARTIFACT_BUCKET} check — SUPABASE_SERVICE_ROLE_KEY not set`);
  } else {
    try {
      const result = await request(`${url}/storage/v1/bucket/${ARTIFACT_BUCKET}`, {
        key: serviceKey,
        bearer: serviceKey,
      });
      if (result.ok) {
        pass(`Bucket "${ARTIFACT_BUCKET}" exists (public: ${result.body?.public ?? false})`);
      } else {
        fail(
          `Bucket "${ARTIFACT_BUCKET}" not found (HTTP ${result.status})`,
          "Create it in Dashboard > Storage as a private bucket.",
        );
      }
    } catch (error) {
      fail(`Cannot list storage buckets`, describeError(error));
    }
  }

  console.log("");
  if (failures > 0) {
    console.log(`Result: ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`Result: all checks passed (${readable.length}/${TABLES.length} tables).`);
}

main().catch((error) => {
  console.error(`\n${FAIL} Unexpected error: ${describeError(error)}`);
  process.exit(1);
});
