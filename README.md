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
2. Run `supabase/migrations/001_company_intel_schema.sql` in its SQL editor, or use the Supabase CLI:

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Copy `.env.example` to `.env.local` and fill in the project URL, the anon key and (server-side only) the service role key.
4. Enable your chosen Supabase Auth providers.
5. Create a private Storage bucket named `research-artifacts` for raw permitted HTML/PDF/screenshot artifacts.
6. Add a scheduled job or Edge Function to delete expired artifacts and evidence based on `expires_at`.

### Verify the connection

```bash
npm run supabase:check
```

The check reads `.env.local` and reports whether the URL and anon key belong to the same project, whether Auth is reachable and which providers are enabled, whether every table from the migration exists, and whether the private `research-artifacts` bucket is present. It exits non-zero when a check fails, so it can gate a deploy or a CI job.

> `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS for the entire project. Keep it server-side only: never prefix it with `NEXT_PUBLIC_`, never import it from a client component, and never commit it. `.env*` is gitignored; rotate any key that has been shared in plain text.

> Before enabling live persistence, add Supabase Auth to the frontend and derive `organization_id` only from the authenticated user’s memberships. Never accept an organization ID from an untrusted browser request as authorization.

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
src/components/intelligence-dashboard.tsx     # Product UI and interactive demo flow
src/app/api/research/route.ts                 # Safe demo research endpoint
src/lib/demo-data.ts                          # Demo report types and provider
src/lib/supabase/client.ts                    # Browser-safe Supabase client
supabase/migrations/001_company_intel_schema.sql
```
