# Seekora — Company Intelligence

A Next.js + Supabase foundation for a **single-company, multi-source research** product. A customer can either enter a company name or paste a public company/profile URL, consume credits for a research job, review source-backed results, and keep the resulting snapshot for a controlled period.

> The current UI is deliberately runnable without credentials. It uses a safe **demo research provider** so the product flow can be tested first. It does **not** crawl the live web or claim to return real company contact data until permitted source connectors and model/API keys are configured.

## Product scenario

### 1. Research one company

1. The user enters a company name *or* pastes a public URL.
2. They optionally choose a country to reduce entity ambiguity.
3. The system discovers candidate sources, validates the entity, collects permitted public business information, then builds a `Company Report`.
4. The report displays confidence, field-level source evidence, capture time, expiry date and only business contact channels explicitly found in allowed sources.
5. A standard report costs 5 credits. A refresh is a lower-cost future job.

### 2. Retention that creates value

- **Starter:** report snapshot and permitted raw artifacts are retained for 30 days.
- **Pro:** 12-month report history, source snapshots and change comparisons.
- **Monitoring:** periodic refreshes with contact/website/product changes highlighted.

The product should present this as **freshness and privacy by default**, not an artificial deletion barrier. Storage alone is not the premium feature; historical intelligence and monitoring are.

### 3. Inputs supported by the product

| Input | How it is used |
| --- | --- |
| Company name | Candidate discovery and entity resolution |
| Official website | High-confidence identity anchor plus crawl seed |
| Public directory/profile URL | Context seed; it is not treated as the sole truth |
| Country / region | Disambiguates companies with similar names |

## Included implementation

- Responsive bilingual dashboard with a clean, modern desktop/mobile UX.
- Vietnamese (`/vi`) and English (`/en`) route-based localization, with a persistent language switcher that keeps the current page.
- Search mode switch: company name or reference URL.
- Credit balance, report list, research loading state and report detail drawer.
- Evidence-first report detail, confidence score, retention countdown and archive/refresh CTAs.
- Related workspace pages: Reports, Archive, Change history, Team, Billing and Settings.
- Safe demo API endpoint: `POST /api/research`.
- Supabase multi-tenant SQL schema with RLS, companies/reports/evidence/credits tables.
- 30-day retention fields and a documented artifact expiry workflow.
- `.env.example` for Supabase and AI/search connector keys.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

The app keeps working without `.env.local`; it stays in demo mode.

## Routes and languages

| Route | Purpose |
| --- | --- |
| `/vi` / `/en` | Company Intelligence dashboard and one-company research flow |
| `/[locale]/reports` | Report list, search and source/confidence overview |
| `/[locale]/archive` | Snapshot retention and archive upgrade flow |
| `/[locale]/history` | Evidence-backed change timeline |
| `/[locale]/team` | Workspace member and role overview |
| `/[locale]/billing` | Credit balance, activity and plans |
| `/[locale]/settings` | Retention, safety and language preferences |

## Connect Supabase

1. Create a Supabase project.
2. Run both files in `supabase/migrations/` in its SQL editor (in order), or use the Supabase CLI:

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Copy `.env.example` to `.env.local` and fill in the project URL, the anon key, the service role key (server-only) and a `CRON_SECRET` (`openssl rand -hex 32`).
4. Enable your chosen Supabase Auth providers.
5. Migration `003` creates the private `research-artifacts` bucket for raw permitted HTML/PDF/screenshot artifacts.
6. Schedule the retention sweep — see [Retention and the artifact bucket](#retention-and-the-artifact-bucket).

### Verify the migrations

```bash
npm run db:verify
```

Runs every file in `supabase/migrations` against an in-process Postgres (PGlite, WebAssembly) with a minimal Supabase shim, then asserts that onboarding is idempotent, that a research job reserves and settles credits atomically, that change detection records one row per moved field, that a first snapshot records nothing, that the retention sweep never orphans an artifact, that rejected calls write nothing, that candidates expire and cannot be promoted without a channel, that a catch-all result blocks export while `invalid` can never be verified, that the verification log keeps its history, that the export policy withholds unchecked guesses and respects tenant isolation, and that one workspace cannot read another's reports, ledger, evidence, change history or buyer data. No credentials or network access needed.

### Verify the connection

```bash
npm run supabase:check
```

The check reads `.env.local` and reports whether the URL and anon key belong to the same project, whether Auth is reachable and which providers are enabled, whether every table from the migration exists, and whether the private `research-artifacts` bucket is present. It exits non-zero when a check fails, so it can gate a deploy or a CI job.

> `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS for the entire project. Keep it server-side only: never prefix it with `NEXT_PUBLIC_`, never import it from a client component, and never commit it. `.env*` is gitignored; rotate any key that has been shared in plain text.

### Auth and live persistence

The dashboard runs in demo mode until a visitor signs in; after that it reads and writes real rows:

| Flow | Where | What happens |
| --- | --- | --- |
| Sign in / sign up / reset | `/[locale]/login` → `src/components/auth-panel.tsx` | Supabase Auth with email + password and cookie sessions via `@supabase/ssr` |
| Email confirmation | `/auth/callback` | Exchanges a PKCE code or verifies an email OTP, then returns to the app |
| Session refresh | `src/proxy.ts` | Renews auth cookies only when a session cookie already exists |
| First workspace | `bootstrap_workspace()` | Creates the organization, owner membership and a 50-credit starter grant in one transaction |
| New Company Report | `POST /api/research` → `complete_research_job()` | Reserves credits, writes `research_jobs`, `company_reports` and `source_evidence`, settles the debit in `credit_ledger`, returns the stored report |

`organization_id` is always derived from the signed-in user's membership inside the SQL functions, so a browser request can never choose its own workspace or price. Anonymous visitors keep the safe demo provider, and an unreachable project degrades to demo data with a visible notice instead of a broken page.

### Team, change monitoring and retention

| Flow | Where | What happens |
| --- | --- | --- |
| Team list | `/[locale]/team` → `workspace_members()` | Members, emails, roles and per-member research counts of the caller's workspace |
| Invite a teammate | `POST /api/team/invite` | Owner/admin only. Sends the Supabase invitation and upserts the membership; roles are limited to admin/member/viewer |
| Change history | `/[locale]/history` → `report_changes` | Every field that moved between two snapshots of the same company, grouped per research run |
| Retention sweep | `POST /api/maintenance/retention` | Deletes expired Storage objects first, then evidence plus expired Starter snapshots. Rows whose object could not be deleted are deferred to the next run |

Change detection runs inside `complete_research_job()`: when a company is researched again, the previous snapshot is compared field by field and a row per change is written (`added`, `removed` or `changed`, including confidence moves). Because `report_changes` stores the compared values as text and references snapshots with `ON DELETE SET NULL`, the history survives the retention sweep that removes the snapshots themselves.

Not wired to real data yet: the credit activity list on the Billing page still renders sample content (the balance itself is real).

### Buyer discovery and the contact verification pipeline

`docs/buyer-discovery-spec.md` explains the pipeline. Migrations `005` and `006` are its data model — `006` is the **Contact Candidate & Verification Pipeline**: it separates what we observed from what we guessed, and makes verification an event log instead of a status column.

| Table | Holds | Retention |
| --- | --- | --- |
| `market_sources` | Every allowed data origin with its licence terms (public record, open government licence, commercial subscription, resale rights) | Reference data |
| `buyer_profiles` | The buyer company, its HS codes, fit score and reasons | Company data |
| `trade_signals` | One row per shipment record: supplier, HS code, weight, containers, bill-of-lading reference | Company data, no expiry |
| `decision_makers` | The person or role signal, with grade A (own public channel), B (company channel only) or C (role, no name) | Personal data, `expires_at` |
| `buyer_routes` | Published ways into a buying organisation: vendor registration, supplier portal, RFQ page, procurement page, department line. The first thing to try, before any name is known | Company data |
| `contact_channels` | Channels **seen on a source**: email, phone, form, portal, per-market messaging, each with `source_url`, `evidence_snippet`, confidence and mailbox state | Personal data, `expires_at` |
| `contact_candidates` | Pattern-generated hypotheses: `pattern_used`, `inference_basis`, 30-day life. Never exported directly | Personal data, 30 days |
| `contact_verification_events` | Append-only log of each mailbox check (provider, result, raw response, cost) so an address valid in March and dead in June keeps both answers | Audit log |
| `contact_export_policy` (view) | The single decision layer: `visible_in_app`, `exportable`, `requires_override`, `outreach_eligible`, `blocked_reason` | — |

The report drawer renders that model as **content only**. The company row carries the name, the facts and the company-level channels — website, LinkedIn, switchboard, general email — as plain values, two per row, each one a link to the page it was seen on. The people found, and the department / regional email addresses, sit in cards of the same shape further down. Inside the report there are no status marks: the certainty, identity and policy labels are not rendered — no badges, no check marks, no "source: LinkedIn profile" line, no "evidence verified" note. They stay in the data model, in the buyers list and in the CSV export. What remains is content: each channel keeps its own icon (mail, phone, profile, website) and a copy button, every value is a link to the page it was seen on, and the source block lists every page that was checked. `npm run check:content` enforces this: it fails if a report field starts carrying advice (ranking, "why approach this person", priority) instead of a value with a source. `src/lib/demo-mariani.ts` is a real fixture built from public sources — searching "Mariani" in the demo returns it.

Rules that are enforced by the database rather than by documentation:

- Observation and inference are different tables. A candidate must state its `pattern_used` and `inference_basis`, expires in 30 days, and can only become a channel by being promoted after a verification event.
- `deliverability` (does the mailbox exist), `identity_match` (whose address is it) and `is_verified` (did we tie it to this person) are three separate answers.
- **A catch-all result is not proof.** A catch-all domain accepts every address, so such a row is blocked from export by default and needs an explicit customer override. Only `valid` counts for automated outreach.
- A profile URL can never be guessed: an invented handle reaches a stranger, so only found URLs are accepted.
- `is_public` is pinned to `true` — private or personal channels cannot be stored.
- An address a verifier reports as dead can never be marked verified.
- A channel from a commercial contact database must name its `market_sources` row, so the customer always sees whose data it is.
- Grade A/B rows must carry a name; grade C rows must not.
- `purge_expired_people()` sweeps expired people, channels and candidates, and deletes a buyer only when there is no shipment, person, channel, candidate **or route** left — a route keeps the buyer alive.

What may leave the building is defined in SQL, not scattered through the app. Three views, all `security_invoker = true` so the caller's RLS still applies:

| View | Purpose |
| --- | --- |
| `contact_export_policy` | Decides `exportable` / `requires_override` / `outreach_eligible` and returns the `blocked_reason` |
| `outreach_ready_contacts` | Exportable rows with A/B/C grade, confidence, deliverability and any override flag — this is the CSV |
| `buyer_outreach_summary` | Per-buyer rollup for the list screen: reachable, verified, outreach-ready, named people, best grade |

| Case | In app | CSV | Automated outreach |
| --- | ---: | ---: | ---: |
| Published company address, cited | yes | yes | after a mailbox check |
| Public profile URL | yes | link only | no — manual contact |
| Candidate, never verified | warning label | no | no |
| Inferred, mailbox `valid` | labelled | yes, with override | needs customer confirmation |
| `catch_all` | risky label | **no** (default) | no |
| `invalid` / expired | audit only | no | no |

An inferred email can be stored and shown in the app, but it only becomes exportable once a verifier says `valid`. The bounce figures widely quoted (verified ~1.2%, unverified ~7.8%, purchased ~18.5%) are marketing benchmarks, not a rule of nature; the firmer reference is Amazon SES, which recommends staying under 2% and reviews accounts from ~5%. Every provider has its own policy, and complaint rate, engagement, domain age and volume all matter.

Writes come from connectors running with the service role; members only read (`insert`/`update`/`delete` are revoked from `authenticated`, and `db:verify` asserts that).

### Buyer list and CSV export

`/[locale]/buyers` is the list-first view: one row per company with its exportable channel count, named people, and last-seen date. Expanding a row shows each channel with its person, role, `identity_match`, confidence label and source link.

`GET /api/export/buyers` returns the CSV the screen's export button downloads. It reads `outreach_ready_contacts`, which already applies the policy, so withheld rows (mailbox unchecked, catch-all, expired) are absent by construction rather than by a filter in the handler. Columns are data only — no ranking, score, priority or advice column — and a test asserts that. BOM UTF-8 and CRLF so Excel opens Vietnamese text correctly; the screen's filters are passed through, and the count of withheld rows is shown on the page so an export is never quietly short.

```bash
npm run export:test   # 43 checks, including re-reading the CSV with an RFC 4180 parser
```

### Connector: public pages to sourced channels

`src/lib/connector/` turns a domain into contact channels found on public pages. Rules are enforced in code and covered by tests: public pages only (no login, no cookies, no CAPTCHA solving), robots.txt respected, same-domain only, every value carries the page URL and the exact sentence it was found in, and no email is ever generated from a pattern.

| Piece | Role |
| --- | --- |
| `html.ts` | HTML to lines, entity decoding, registrable-domain helper |
| `extract.ts` | Emails, phones, social/WhatsApp links, forms, adjacent person names, excluded third-party values |
| `robots.ts` | robots.txt parsing and longest-match Allow/Disallow |
| `fetch.ts` | One page fetch with timeout, size cap, login-wall and block detection |
| `safety.ts` | SSRF guard: loopback, private ranges, link-local/metadata IPs, `.internal`, non-http schemes |
| `discover.ts` | Page selection: contact/supplier/about pages, same domain, robots-respecting |
| `index.ts` | `runConnector(domain)` orchestration |
| `to-report.ts` | Maps results onto the frozen report shape |

```bash
npm run connector:test    # 71 checks on real HTML fixtures, no network needed
npm run connector:run mariani.com            # real run, human readable
npm run connector:run mariani.com -- --json  # full JSON
```

`POST /api/connector` with `{ "domain": "mariani.com" }` does the same over HTTP. Results are returned, **not persisted** — that needs migrations 002–006 applied first.

### Retention and the artifact bucket

The bucket is private and has no `storage.objects` policy, so the service role is the only writer and downloads must be authorised by a server route. The sweep has two parts:

1. `POST /api/maintenance/retention` (requires `CRON_SECRET`) — calls `retention_artifact_paths()`, removes those objects from Storage, then calls `purge_expired_retention(removed_paths)`.
2. A schedule that calls it. Either:

   ```bash
   npm run retention:run            # manual, uses BASE_URL + CRON_SECRET
   ```

   or, in the project, run `supabase/migrations/004_retention_cron.sql` and then:

   ```sql
   select public.schedule_retention_cron(
     'https://your-app.example.com/api/maintenance/retention',
     'the-same-CRON_SECRET'
   );
   ```

   That installs a nightly `pg_cron` job (`0 3 * * *`) which posts through `pg_net`. Inspect it with `select * from cron.job_run_details order by start_time desc limit 10`.

## Production research pipeline

The demo endpoint should evolve into an asynchronous queue, not a long HTTP request:

```text
Request
  -> reserve credits atomically
  -> research_jobs (queued)
  -> URL safety validation / candidate discovery
  -> allowed source connectors + crawler/browser worker
  -> deterministic extraction (JSON-LD, tel:, mailto:, wa.me)
  -> LLM structured extraction + entity validation
  -> source_evidence + company_reports
  -> settle/refund credits
  -> notify UI
```

### Recommended model routing

1. **Deterministic extraction first:** avoid LLM cost for URLs, phone links, email links, JSON-LD and known page structure.
2. **Fast model:** page classification, language normalization, JSON extraction.
3. **Research model:** planning, source synthesis and company-level reasoning.
4. **Escalation model:** only for ambiguous, low-confidence entity matches.

Keep source URLs, timestamps, matching reasons and confidence for every material field. The model must return `not_found` when there is no evidence; it must never infer personal contacts.

## Security checklist for user-supplied links

- Permit only `http:` and `https:` URLs.
- Block localhost, private IP ranges, cloud metadata endpoints and unsafe redirects.
- Fetch in a sandboxed worker with strict size/time limits.
- Do not forward user cookies or credentials to sources.
- Respect source terms, robots restrictions, rate limits and data licenses.
- Use only public business contact information with documented sources.
- Do not retain or resell source content when its terms do not permit it.

## Important files

```text
src/app/page.tsx                              # Dashboard entry point
src/components/intelligence-dashboard.tsx     # Product UI and research flow
src/app/[locale]/login/page.tsx               # Sign-in / sign-up route
src/app/auth/callback/route.ts                # Email-link verification endpoint
src/app/api/research/route.ts                 # Research endpoint (demo or Supabase-backed)
src/app/api/team/invite/route.ts               # Workspace invitations (owner/admin)
src/app/api/maintenance/retention/route.ts     # Expired artifact + evidence sweep
src/components/team-page.tsx                   # Team list UI
src/components/history-page.tsx                # Change-history timeline UI
src/lib/data/activity-view.ts                  # Change + member row mapping
scripts/run-retention.mjs                      # Manual sweep runner
src/lib/data/workspace.ts                     # Server-side workspace loader
src/lib/data/report-view.ts                   # Row -> view mapper
src/lib/demo-data.ts                          # Demo report types and provider
src/lib/supabase/client.ts                    # Browser-safe Supabase client
src/lib/supabase/server.ts                    # Cookie-bound server client
src/lib/supabase/admin.ts                     # Service-role client (server jobs only)
src/proxy.ts                                  # Session-cookie refresh
supabase/migrations/001_company_intel_schema.sql
supabase/migrations/002_workspace_and_research_rpc.sql
supabase/migrations/003_change_monitoring_and_retention.sql
supabase/migrations/004_retention_cron.sql
supabase/migrations/005_buyer_discovery.sql
supabase/migrations/006_contact_candidates_and_verification.sql
docs/buyer-discovery-spec.md
```
