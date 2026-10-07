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
2. Run every file in `supabase/migrations/` (twelve, in order) in its SQL editor, or use the Supabase CLI:

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
npm run supabase:check   # auth, tables, bucket — and whether the project is reachable
npm run search:check     # the search provider key, using the connector's own request
npm run whatsapp:check   # whether a number has WhatsApp, via your own Cloud API (sends nothing)
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

The report drawer renders that model as **content only**. The company row carries the name, the facts and the company-level channels — website, LinkedIn, switchboard, general email — as plain values, two per row, each one a link to the page it was seen on. Each person gets a card carrying **every channel attached to them** — the LinkedIn profile, an email published next to their name, a phone if one was published — so a published address never floats on its own without its owner. Department addresses that belong to no named person sit in cards of the same shape further down. Inside the report there are no status marks: the certainty, identity and policy labels are not rendered — no badges, no check marks, no "source: LinkedIn profile" line, no "evidence verified" note. They stay in the data model, in the buyers list and in the CSV export. What remains is content: each channel keeps its own icon (mail, phone, profile, website) and a copy button, every value is a link — drawn in the link colour at rest, underlined on hover, so it reads as clickable without moving the mouse — to the page it was seen on, and the source block lists every page that was checked. `npm run check:content` enforces this: it fails if a report field starts carrying advice (ranking, "why approach this person", priority) instead of a value with a source. `src/lib/demo-mariani.ts` is a real fixture built from public sources — searching "Mariani" in the demo returns it.

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

### Customs records, roles and the resolve queue

Bills of lading publish no email and no phone — so the customs layer carries **no contact columns at all**, and none of it lands in `contact_channels`. What it carries is the three things the paperwork actually says: which parties took part, in which role, on which shipment.

Three layers, kept apart on purpose (migration 012):

1. **As printed** — `customs_records` + `customs_record_parties` keep the name exactly as the bill prints it (`name_as_printed`), next to the normalised copy used only for matching (`name_normalized`), plus the country as printed with a separate `country_iso2`, and the column the value was read from (`source_column`).
2. **Derived** — `public.customs_side_for(role)` turns the printed role into a side of the trade: `importer`/`consignee` → `importer_side`, `shipper` → `exporter_side`, and *everything else stays `unknown`*. A notify party can be a bank, a forwarder or a customs broker, so deriving a buyer from it would be a guess. `src/lib/customs/normalize.ts` is the TypeScript twin of that function, and both sides are asserted against the same table in `customs:test` and `db:verify`.
3. **Decided** — `customs_entity_matches` records what a person concluded: `linked`, `created`, `review` (candidates exist, nobody has chosen) or `unmatched` (there is nothing to choose). A CHECK constraint refuses any row that would turn a shipper into a customer, whether it arrives through the function or through a direct insert.

Writing is four service-role-only functions: `record_customs_record` (idempotent — the same bill number returns the existing row with `replayed = true`, never a duplicate), `link_customs_party` (refuses anything that is not importer-side, refuses a profile from another workspace, and writes the shipment into `trade_signals` so "linked" always comes with "has history"), `mark_customs_party` (review/unmatched only — the two states stay different), and `create_buyer_from_customs_party` (needs a country, reuses a single same-name profile, and hands over to `review` when two profiles share the name).

**No source, no record**: like every other write path, the source key must exist in `market_sources` (the 005 rule), so importing a customs file starts by registering the source.

On the reading side, `buyer_customs_summary` gives the report its import history (shipment count, first/last shipment, HS codes grouped at HS6, goods samples, supplier names and countries, sources, how the link was decided) and `buyer_customs_roles` keeps every role the buyer appears in — including `notify_party`, which is shown as `unknown` side rather than quietly dropped. `customs_resolution_queue` is the working queue: importer-side parties that are not linked yet, with the counterparty on the same bill for context.

The screen: the buyer report and the expanded row on `/[locale]/buyers` both show a **"Lịch sử nhập khẩu"** block (roles as chips, shipment window, HS6 codes, goods, suppliers) and the top of the buyers page carries the **"Hàng đợi phân loại tờ khai hải quan"** panel. Candidates are ranked by evidence, never auto-applied: a matching declared domain scores highest, then the same name with the same country, then the same name alone, then a close name — each with the reason spelled out, and a name clash on country or domain is stated as a reason *against* linking. Deciding happens through `POST /api/customs`, which reads the party through the caller's own session first (so another workspace's party is invisible), then writes with the service role.

Importing a file is a deliberate, reported step: `src/lib/customs/import.ts` maps columns by name (`Shipper Name` → the shipper's name; `Buyer` → the importer, keeping the file's word in `source_column`), prints which columns it understood and which it ignored, refuses a file with no bill-number column or no role column at all, drops an ambiguous `05/03/2026` date instead of guessing the day/month order, and reports what it skipped and why.

### Buyer list and CSV export

`/[locale]/buyers` is the list-first view: one row per company with its exportable channel count, named people, and last-seen date. Expanding a row shows each channel with its person, role, `identity_match`, confidence label and source link.

`GET /api/export/buyers` returns the CSV the screen's export button downloads. It reads `outreach_ready_contacts`, which already applies the policy, so withheld rows (mailbox unchecked, catch-all, expired) are absent by construction rather than by a filter in the handler. Columns are data only — no ranking, score, priority or advice column — and a test asserts that. BOM UTF-8 and CRLF so Excel opens Vietnamese text correctly; the screen's filters are passed through, and the count of withheld rows is shown on the page so an export is never quietly short.

```bash
npm run export:test   # 58 checks, including re-reading the CSV with an RFC 4180 parser
npm run report:test   # 19 checks: person channels merge onto the person card, nothing lost or invented
npm run requirements:test # 24 checks: supplier requirements kept verbatim, sourced, never invented
```

### What the system finds

Per company: name, country, city, industry, a one-or-two-line description, official website, company LinkedIn, published business email, office phone (fax kept separate and never treated as a contact line), business WhatsApp when published, the contact form, and signals read from the page content — each value carrying the page URL and the exact sentence it was seen in, plus a confidence score and capture/expiry dates.

Per person: name, title, department, previous role when published, and **the channels that belong to that person** — LinkedIn profile, a published email with their name next to it, a phone if one is published beside their name — with last-seen date and source.

Not found today: personal mobile numbers (LinkedIn has no phone field; under ~5% of members publish one and usually only to first-degree connections), pattern-inferred emails (a later phase, labelled and never exported directly), anything behind a login wall, and paid trade data. Founded year, headcount and address exist only in the demo fixture — the connector does not extract them yet. The full list lives in `docs/buyer-discovery-spec.md` §13.

### What the AI actually does (and what it must do next)

Reading one company website is not a product — anyone can do that in five minutes. The value is in reading **many** sources, merging them into one correct entity, pointing at the right door and keeping it fresh, plus the layer Google does not have: customs/registry data. `docs/buyer-discovery-spec.md` §14 lays out the source layers (company pages → press/PDF/trade-fair directories → government registries → trade data → enrichment vendors → mailbox verification → monitoring) with cost and legal status for each, and splits the AI's job into what it does today (understanding one page: which email belongs to the company, which number is a fax, which name goes with which address) versus what it must do next (choosing which sources to read, entity resolution across sources, reading long documents into a supplier-requirements checklist, resolving conflicts, and matching a Vietnamese supplier's product/HS code to what a buyer actually imports).

### Supplier requirements & documents

The report carries a block listing what the buyer itself publishes as a condition for its suppliers: certifications (BRCGS, SQF, HACCP, ISO, FSSC, GlobalG.A.P., Kosher, Halal, organic), documents (COA, COO, phytosanitary, fumigation, health certificate, product liability insurance, W-9, food safety plan, specification sheet, MRL, aflatoxin), audits (SMETA/Sedex, BSCI, SA8000, third-party audit) and commercial terms (MOQ, payment terms, lead time, pre-shipment sample).

A line only becomes an item when it names one of those and either carries requirement wording (`must`, `required`, `provide`, `submit`, `audited`, "yêu cầu", "phải") or sits under a requirement heading (`Supplier requirements`, `Required documents`, `Vendor approval`) within four lines. Sentences about the buyer itself — "We are BRCGS certified since 1998", "our own facility is audited" — are skipped unless they address suppliers. The item keeps the buyer's **verbatim sentence** as evidence, a Vietnamese label, a group, and the URL (page or PDF) it came from. Nothing is inferred and nothing is recommended; when a buyer publishes no requirements, the block does not appear at all.

```bash
npm run requirements:test   # 24 checks: no fabrication, verbatim evidence, sources, PDF, no advice
npm run persist:test      # 144 checks: rows built from real findings, written into a real Postgres, read back through the app's views, gated, verified, exported, WhatsApp-checked, and customs records linked end to end
npm run roles:test        # 33 checks: title classification order (a procurement director is not management), other ≠ unknown
npm run customs:test      # 105 checks: reading a customs CSV, mapping columns to fields, refusing to guess, ranking candidates
npm run reverify:test     # 37 checks: three answers to "is this value still there", and what each one changes
```

### Connector: public sources to sourced channels

Beyond HTML pages, the connector reads **same-domain PDFs** — annual reports, press releases, catalogues and supplier guides — because that is where the things a website does not publish live: named people with titles, department mailboxes, switchboard numbers. PDFs are ranked by filename relevance (supplier > financial report > press release > catalogue > certification), capped at three per run (`--max-documents`), same-domain only, robots.txt respected. A scanned PDF with no text layer, a font-encoded PDF, an encrypted file or one over 12 MB is recorded as "could not read" **with a reason** and contributes nothing — the connector never guesses a value out of a document it failed to read.

```bash
npm run connector:run mariani.com -- --max-pages 8 --max-documents 4
npm run connector:run acmespices.co.uk -- --company "Acme Spices Ltd" --country "United Kingdom"
npm run connector:run acmespices.co.uk -- --no-secondary   # company site only
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
| `sitemap.ts` | Reads the company's own sitemap(s): finds supplier pages whose names cannot be guessed |
| `gate.ts` | Decides whether step 3 is needed at all (pure: is there a buying-role channel yet?) |
| `secondary.ts` | Step 3 sources: scoped search API, UK Companies House, US SEC EDGAR |
| `index.ts` | `runConnector(domain)` orchestration (steps 2 and 3) |
| `to-report.ts` | Maps results onto the frozen report shape |
| `persist.ts` | Builds the database rows (pure) and writes them through a small store port: `buyer_profiles`, `decision_makers`, `contact_channels`, `buyer_routes` |

```bash
npm run connector:test    # 211 checks on real HTML and PDF fixtures, no network needed
npm run connector:run mariani.com            # real run, human readable
npm run connector:run mariani.com -- --json  # full JSON
```

**Step 3 (secondary sources) only runs when step 2 came up thin** — i.e. when reading the company's own site (including its sitemap and same-domain PDFs) did not reach a channel that belongs to a buying role (procurement / purchasing / sourcing / supply chain). It is opt-in through server-side environment variables, and each of its three sources is independently optional:

| Source | Key | What it can add — and what it never adds |
| --- | --- | --- |
| Search API (Serper / Tavily / Brave) | `SEARCH_API_KEY`, `SEARCH_PROVIDER` (optional for Tavily — a `tvly-` key is recognised on its own) | **URLs inside the company domain** (`site:` is always in the query, plus Tavily's own `include_domains` because Tavily does not honour `site:`). Search snippets are never evidence; the page is fetched and quoted as usual. Off-domain hits are dropped twice. Google's and Microsoft's own search APIs are no longer an option: Bing Search was retired on 11/08/2025 and Google's Custom Search JSON API is closed to new customers and ends 01/01/2027 — hence the three providers above. |
| UK Companies House | `COMPANIES_HOUSE_API_KEY` | Legal name, company number, status, incorporation date, SIC code, former names, current officers — entity confirmation for step 1. **The register has no email or phone, so it never creates a channel.** Open Government Licence; source label always written. |
| US SEC EDGAR | none | Legal name, CIK, SIC industry, former names, latest filing. EDGAR does not list officers (that lives inside each filing), so no names are guessed. |

Countries without a free register (Vietnam included) get an explicit "no register available for this country" reason rather than a substitute source. `--no-secondary`, or `secondary: false` over HTTP, disables the step entirely.

Before buying a key, `npm run search:check` calls **the same request the connector builds** (and prints which endpoint it called, how many rows came back, and how many of those were inside the probe domain — HTTP 200 with an error body is reported as *not connected*, not as success) (same `buildSearchRequest`/`parseSearchHits`) against a public domain, so "the key works" is measured rather than assumed — and with no key it prints the three providers, their free tiers and the two lines to add to `.env.local`, then exits 0, because running without step 3 is a normal state.

### Connector: findings go into the buyer tables

`POST /api/connector` with `{ "domain": "mariani.com", "companyName": "Mariani Packing Co.", "country": "United States" }` does the same over HTTP, and — when there is a signed-in workspace — writes what it found into `buyer_profiles`, `decision_makers`, `contact_channels` and `buyer_routes`. The buyer list then shows the company, and `contact_export_policy` decides what may be exported.

```bash
curl -s -X POST localhost:3000/api/connector \
  -H 'content-type: application/json' \
  -d '{"domain":"mariani.com","companyName":"Mariani Packing Co.","country":"United States"}'
# → { "persisted": true, "persist": { "counts": { "channels": {...}, "candidatesInserted": 0 } } }
```

Four rules the write layer cannot break, all covered by `npm run persist:test`:

1. **`contact_candidates` stays empty.** That table is for pattern-guessed emails; the connector never guesses one.
2. **`is_verified` stays `false`.** "This value is on a public page" is not "this mailbox belongs to that person", and the schema keeps the two apart.
3. **No row without a source and a quote.** Every channel carries `source_url` plus the verbatim sentence (`evidence_snippet`) it was read from; anything missing either one is dropped and listed with a reason.
4. **No personal LinkedIn profile as a company channel.** `/in/…` links are excluded in extraction, blocked at the write layer, and — since migration 007 — refused by the database unless the row belongs to a named person.

Migration 007 makes evidence a column-level rule rather than a convention: a `confirmed` row without a quote is rejected by `contact_channels_confirmed_needs_quote`, `evidence_url` names the page each value was read from, and `is_verified` can only be set by `verify_contact_channel(uuid)` — a service-role-only function that refuses guesses, mailboxes known to be dead, and rows without both a page and a quote. Ownership and deliverability stay separate questions: a verified published address is exportable but not `outreach_eligible` until its mailbox has been checked.

`country` is required and is never inferred from the domain suffix: missing it returns `persisted: false` with that reason instead of storing half a row. Writes go through the service role — migrations 005/006 revoke insert/update on the buyer tables from `authenticated`, so the browser cannot write buyer data — and `organization_id` always comes from the session, never from the request body.

Re-running the same domain refreshes `last_seen_at` instead of duplicating channels, people or routes.

### Phone numbers and WhatsApp

Phone numbers are normalised to **E.164** in `src/lib/connector/phone.ts`, in a second field: `value` keeps the number exactly as published, `phone_e164` holds the normalised one. A number that already carries `+` (or is written the `00` way) always normalises. A national-format number normalises **only when the company's country is known** — the country's dialling code is prepended and the trunk prefix dropped according to that country's convention (`0` for most, none for the US/Canada/Italy/Spain, `8` for Russia). Without a known country the number is left as published and `phone_e164` stays empty: an E.164 value is what opens `wa.me/<number>`, and a wrong country code does not just look wrong, it opens a chat with a stranger.

### Role and email gates

`role_kind` (migration 009) is classified once, when a person is written, by `src/lib/roles.ts` — instead of every caller re-deriving it from the title string. Buying roles (`procurement`, `purchasing`, `sourcing`, `supply_chain`) pass the role gate; `quality`, `logistics`, `sales`, `management` do not; `other` (a title nobody recognises) and `unknown` (no title found) are deliberately separate values, because "data we cannot use" and "no data" are different answers.

`email_kind` carries the three labels from the standard design — `published_named`, `published_role_mailbox`, `inferred_unverified` — but it is a **new column beside** `identity_match`, not a rename of it: `identity_match` says *whose address this is*, `email_kind` says *how it was published*. A SQL function (`email_kind_for`) maps between them and a constraint refuses any row where the two disagree. Only `inferred_unverified` is blocked by the email gate; a published department mailbox is published, not guessed.

### Keeping it fresh

`contact_reverify_queue` (migration 010) lists the channels due for a re-read: those found on the company's own site, with a source page, not marked dead, still within their 90-day life. `POST /api/maintenance/reverify` (or `npm run reverify:run -- --days 90`) re-opens exactly that page and answers one question — is the value still there?

```
still_present  → refresh last_seen_at / expires_at, move verified_at forward
gone           → expire the channel now (it drops out of export), keep the row
unreachable    → change nothing
```

### Entity resolution: the registry match on the buyer list

Step 1 of the standard design is *know whose website you are reading*. `record_registry_match(...)` (migration 011) stores what the register published — legal name, company number, status, incorporation date, SIC industry, former names, and the current officers — together with the page it was read from, the name that was queried, and when. Everything lands in `buyer_registry_matches` + `buyer_registry_officers`; `buyer_registry_latest` gives the list screen the newest match per buyer, and the buyers page shows it as a **"Đối chiếu pháp nhân"** block inside the expanded row.

Two rules are enforced in the schema, not in the UI:

- **A register never creates a contact channel.** It publishes no email and no phone, so it can never be a row in `contact_channels`: that is why the officers table has no contact columns at all, and why the block sits beside the channel list instead of inside it.
- **Nothing is stored that was not found.** There is no row for "we looked and there was nothing" — no source page, no row. Re-running the same lookup refreshes `checked_at` and adds nothing; a *different* answer (status moved to liquidation, an officer changed) adds a row, so the history of the register stays readable. `organization_id` is derived from the buyer inside the function, never passed in by the caller.

**`unreachable` is not "gone".** A network blip must never remove a customer's data — the next run retries, and the expiry still counts from the last time the value was actually seen. There is deliberately no third state for "the page changed to something else": the old value becomes `gone` and the connector finds the new one as a new channel, so a re-read only ever has to answer one question it can answer honestly.

Every re-read is appended to `contact_reverifications` with the page, the quote and the time — `still_present` without a quote is rejected by the database, because "still there" has to be shown, not asserted.

`contact_role_gate` and `contact_email_gate` are separate from `contact_export_policy` on purpose: exporting is about what may leave the building, the gates are about who is worth calling — and that decision belongs to the user.

`has_whatsapp` is a **three-state** boolean because "not checked" is not "checked, and no": `null` on everything the connector writes, `true` only after a service checked it, `false` only when a service said no. A `true` must name the service and must have an E.164 number — enforced by constraints in migration 008. `public.contact_whatsapp_links` exposes the `wa.me` link for checked numbers, and the buyer list shows a "Nhắn WhatsApp" button for exactly those rows; unchecked numbers show nothing. `npm run whatsapp:check` is the way in: it sends **no message**, asks Meta which number the account is on, then asks whether the numbers you pass have WhatsApp — and with no credentials it prints the setup steps instead. See `docs/backlog.md` for the four routes (and why an unofficial gateway was rejected) and `docs/buyer-discovery-spec.md` §19 for the rules, including coexistence if the number still runs the Business app.

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
supabase/migrations/007_evidence_is_required.sql
supabase/migrations/008_whatsapp_and_e164.sql
supabase/migrations/009_role_and_email_gates.sql
supabase/migrations/010_reverification.sql
supabase/migrations/011_registry_identity.sql
supabase/migrations/012_customs_parties.sql
docs/buyer-discovery-spec.md
```
