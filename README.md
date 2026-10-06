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

Runs every file in `supabase/migrations` against an in-process Postgres (PGlite, WebAssembly) with a minimal Supabase shim, then asserts that onboarding is idempotent, that a research job reserves and settles credits atomically, that change detection records one row per moved field, that a first snapshot records nothing, that the retention sweep never orphans an artifact, that rejected calls write nothing, that inference is labelled and short-lived (never verified), that a dead address cannot be marked verified, that the export views withhold unchecked guesses and respect tenant isolation, and that one workspace cannot read another's reports, ledger, evidence, change history or buyer data. No credentials or network access needed.

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

### Buyer discovery (foreign markets)

`docs/buyer-discovery-spec.md` explains the pipeline; migration `005` is its data model:

| Table | Holds | Retention |
| --- | --- | --- |
| `market_sources` | Every allowed data origin with its licence terms (public record, open government licence, commercial subscription, resale rights) | Reference data |
| `buyer_profiles` | The buyer company, its HS codes, fit score and reasons | Company data |
| `trade_signals` | One row per shipment record: supplier, HS code, weight, containers, bill-of-lading reference | Company data, no expiry |
| `decision_makers` | The person or role signal, with grade A (own public channel), B (company channel only) or C (role, no name) | Personal data, `expires_at` |
| `contact_channels` | Email, phone, form, portal, per-market messaging, each with provenance, a confidence label and a mailbox-check status | Personal data, `expires_at` (30 days when inferred) |

Rules that are enforced by the database rather than by documentation:

- Inference is allowed but labelled: `certainty` is `confirmed` (seen published, with the page it was seen on), `probable`, or `inferred` — and an inferred value must state its `inference_basis`.
- An `inferred` value is never `is_verified` and expires within 30 days instead of 90; `is_guessed` is generated from `certainty`, so a guess cannot be silently relabelled.
- A profile URL can never be `inferred`: an invented handle reaches a stranger, so only found URLs are accepted.
- `deliverability` (does the mailbox exist, checked by an email verifier) is tracked separately from `is_verified` (is it really this person's).
- `is_public` is pinned to `true` — private or personal channels cannot be stored.
- An address a verifier reports as dead can never be marked verified.
- A channel from a commercial contact database must name its `market_sources` row, so the customer always sees whose data it is.
- Grade A/B rows must carry a name; grade C rows must not.
- `purge_expired_people()` deletes expired people, expired channels and orphaned buyer profiles, while leaving shipment records alone.

What may leave the building is defined in SQL, not scattered through the app. Three views, all `security_invoker = true` so the caller's RLS still applies:

| View | Purpose |
| --- | --- |
| `outreach_ready_channels` | Fresh, not known-dead, and either citable or (when inferred) mailbox-checked. Carries `confidence_label` |
| `outreach_ready_contacts` | One row per usable channel with its A/B/C grade, confidence and source — this is the CSV export |
| `buyer_outreach_summary` | Per-buyer rollup for the list screen: reachable channels, verified channels, named people, best grade |

The practical rule: an inferred email can be stored and shown in the app, but it only becomes exportable after a mailbox check says `valid` or `catch_all`. Verified working lists bounce around 1.2%, unverified ones around 7.8%, and purchased lists around 18.5% — 2% is the industry ceiling before mail providers start throttling a customer's domain.

Writes come from connectors running with the service role; members only read (`insert`/`update`/`delete` are revoked from `authenticated`, and `db:verify` asserts that).

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
docs/buyer-discovery-spec.md
```
