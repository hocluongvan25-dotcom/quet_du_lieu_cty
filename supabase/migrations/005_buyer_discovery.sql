-- Seekora / Company Intelligence
-- 005: buyer discovery for foreign markets (trade data + official registries).
--
-- Four layers:
--   trade_signals    — shipment records: who imports what, from where, when
--   buyer_profiles   — the buyer company we researched
--   decision_makers  — the person behind the purchase (from a named source)
--   contact_channels — how to reach them, always with provenance
--
-- Policy encoded in the schema rather than in a wiki page:
--   * contact_channels.is_guessed must stay false  -> no pattern-generated emails
--   * contact_channels.is_public must stay true    -> no private/personal channels
--   * an email channel always needs a source_url   -> no "found somewhere" data
--   * a licensed contact database always needs its market_source row
--   * decision_makers of grade a/b need a name, grade c must not have one
--   * personal data carries expires_at and is purged by a scheduled job
--
-- Trade records are company-level data and are treated as such: no expiry.

-- ---------------------------------------------------------------------------
-- Where data is allowed to come from.
-- ---------------------------------------------------------------------------
create type public.market_source_kind as enum (
  'trade_data',          -- customs / bill-of-lading datasets
  'registry',            -- official company registers
  'company_site',        -- the buyer's own website or documents
  'press',               -- press releases, trade press
  'sec_filing',          -- regulatory filings
  'trade_show',          -- exhibitor lists
  'licensed_contact_db'  -- commercial contact databases
);

create type public.decision_maker_grade as enum ('a', 'b', 'c');

create type public.channel_type as enum (
  'email',
  'phone',
  'form',
  'linkedin_url',
  'whatsapp',
  'wechat_oa',
  'zalo_oa',
  'portal'
);

-- Where a single value was observed.
create type public.channel_provenance as enum (
  'registry',
  'company_site',
  'press_release',
  'sec_filing',
  'trade_show',
  'licensed_contact_db'
);

create table public.market_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  kind public.market_source_kind not null,
  coverage_countries text[] not null default '{}',
  coverage_note text,
  licence_type text,
  licence_reference text,
  terms_url text,
  allows_storage boolean not null default true,
  allows_resale boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger market_sources_touch_updated_at before update on public.market_sources
for each row execute function public.touch_updated_at();

comment on table public.market_sources is
  'Catalogue of allowed data origins with their licence terms. Nothing may be stored without a row here.';

-- Curated starting catalogue. ImportYeti/Panjiva/ImportGenius are company-level
-- only; Volza-style databases bundle contacts whose provenance is the reseller's.
insert into public.market_sources (key, display_name, kind, coverage_countries, licence_type, terms_url, allows_resale, coverage_note, notes)
values
  ('importyeti', 'ImportYeti', 'trade_data', '{US}', 'public-record', 'https://www.importyeti.com/', false,
   'US sea import manifests (CBP), history from ~2015. No air/land, no exports.',
   'Company-level only: importer name/address, website, HS/HTS, suppliers, lanes, TEUs. Contact details are withheld by the source.'),
  ('panjiva', 'Panjiva (S&P Global)', 'trade_data', '{US,CN,IN,MX,BR}', 'commercial-subscription', 'https://panjiva.com/', false,
   'Global shipment records with entity matching.', 'Company-level only, no decision-maker contacts. Enterprise pricing.'),
  ('importgenius', 'ImportGenius', 'trade_data', '{US,IN,MX}', 'commercial-subscription', 'https://www.importgenius.com/', false,
   'Deep US bill-of-lading history.', 'No contact data at any tier.'),
  ('volza', 'Volza', 'licensed_contact_db', '{US,IN,CN,AE,TR,BR}', 'commercial-subscription', 'https://www.volza.com/', false,
   'Global shipment records with bundled contacts.', 'Bundled emails/phones come from the reseller''s own sourcing: provenance must be shown to the customer, never presented as verified by us.'),
  ('companies_house', 'UK Companies House', 'registry', '{GB}', 'open-government-licence', 'https://developer.company-information.service.gov.uk/', true,
   'Free official API: officers, PSC, filings.', 'Legal representative / director names are authoritative. 600 requests per 5 minutes.'),
  ('sec_edgar', 'SEC EDGAR', 'sec_filing', '{US}', 'public-record', 'https://www.sec.gov/edgar', true,
   'Filings of US public companies.', 'Executive names for public companies.'),
  ('company_website', 'Company website', 'company_site', '{}', 'public-record', null, false,
   'Published by the buyer itself.', 'Safest source for channels: leadership pages, contact pages, supplier documents.'),
  ('press_release', 'Press release / trade press', 'press', '{}', 'public-record', null, false,
   'Announcements naming people and roles.', 'Use for role signals, corroborate before calling it verified.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Buyers and their import history.
-- ---------------------------------------------------------------------------
create table public.buyer_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_job_id uuid references public.research_jobs(id) on delete set null,
  legal_name text not null,
  display_name text not null,
  country text not null,
  region text,
  city text,
  address text,
  website text,
  domain text,
  industry text,
  target_department text,
  hs_codes text[] not null default '{}',
  fit_score smallint check (fit_score between 0 and 100),
  fit_reasons jsonb not null default '[]'::jsonb,
  first_signal_at timestamptz,
  last_signal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, domain)
);

create trigger buyer_profiles_touch_updated_at before update on public.buyer_profiles
for each row execute function public.touch_updated_at();

create index buyer_profiles_org_score_idx on public.buyer_profiles (organization_id, fit_score desc nulls last, last_signal_at desc);
create index buyer_profiles_hs_idx on public.buyer_profiles using gin (hs_codes);

create table public.trade_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_profile_id uuid not null references public.buyer_profiles(id) on delete cascade,
  market_source_id uuid not null references public.market_sources(id) on delete restrict,
  shipment_date date,
  supplier_name text,
  supplier_country text,
  hs_code text,
  product_description text,
  quantity numeric,
  quantity_unit text,
  weight_kg numeric,
  containers integer,
  value_usd numeric,
  origin_country text,
  destination_port text,
  record_reference text,
  captured_at timestamptz not null default now(),
  unique (buyer_profile_id, market_source_id, record_reference)
);

comment on table public.trade_signals is
  'One row per shipment record. Company-level data: kept without expiry, like any business register extract.';

create index trade_signals_buyer_date_idx on public.trade_signals (buyer_profile_id, shipment_date desc);
create index trade_signals_org_date_idx on public.trade_signals (organization_id, shipment_date desc);
create index trade_signals_hs_idx on public.trade_signals (hs_code, shipment_date desc);

-- ---------------------------------------------------------------------------
-- People and channels: personal data, with expiry.
-- ---------------------------------------------------------------------------
create table public.decision_makers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_profile_id uuid not null references public.buyer_profiles(id) on delete cascade,
  market_source_id uuid references public.market_sources(id) on delete set null,
  full_name text,
  job_title text,
  department text,
  grade public.decision_maker_grade not null,
  source_url text not null,
  corroboration_count smallint not null default 1 check (corroboration_count >= 1),
  is_current boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A/B are named people; C is a role signal with no name yet.
  check (grade = 'c' or nullif(btrim(coalesce(full_name, '')), '') is not null),
  check (grade <> 'c' or nullif(btrim(coalesce(job_title, department, '')), '') is not null),
  check (grade <> 'c' or full_name is null)
);

create trigger decision_makers_touch_updated_at before update on public.decision_makers
for each row execute function public.touch_updated_at();

comment on table public.decision_makers is
  'Named people (grade a/b) or role signals without a name (grade c). Expires so outreach lists cannot go stale silently.';

create index decision_makers_buyer_idx on public.decision_makers (buyer_profile_id, grade, last_seen_at desc);
create index decision_makers_expiry_idx on public.decision_makers (expires_at);
create index decision_makers_org_idx on public.decision_makers (organization_id, last_seen_at desc);

create table public.contact_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_profile_id uuid not null references public.buyer_profiles(id) on delete cascade,
  decision_maker_id uuid references public.decision_makers(id) on delete cascade,
  market_source_id uuid references public.market_sources(id) on delete set null,
  channel_type public.channel_type not null,
  value text not null,
  provenance public.channel_provenance not null,
  source_url text,
  is_public boolean not null default true,
  is_verified boolean not null default false,
  verification_note text,
  verified_at timestamptz,
  is_guessed boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  -- Tripwires: these two cannot be flipped without a deliberate schema change.
  check (is_guessed = false),
  check (is_public = true),
  -- Any email must point at where it was actually seen.
  check (channel_type <> 'email' or nullif(btrim(coalesce(source_url, '')), '') is not null),
  -- Values coming from a commercial contact database must name that source.
  check (provenance <> 'licensed_contact_db' or market_source_id is not null),
  check (nullif(btrim(value), '') is not null)
);

comment on table public.contact_channels is
  'Public business channels only. is_public and is_guessed are pinned true/false: guessed channels are structurally impossible.';

create index contact_channels_buyer_idx on public.contact_channels (buyer_profile_id, channel_type);
create index contact_channels_person_idx on public.contact_channels (decision_maker_id);
create index contact_channels_expiry_idx on public.contact_channels (expires_at);

-- ---------------------------------------------------------------------------
-- Retention for personal data. Company-level trade rows are left alone.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_people(p_orphan_days integer default 30)
returns table (deleted_channels integer, deleted_decision_makers integer, deleted_buyer_profiles integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channels integer := 0;
  v_people integer := 0;
  v_profiles integer := 0;
begin
  with gone as (
    delete from public.contact_channels channel
    where channel.expires_at < now()
    returning channel.id
  )
  select count(*) into v_channels from gone;

  with gone as (
    delete from public.decision_makers person
    where person.expires_at < now()
    returning person.id
  )
  select count(*) into v_people from gone;

  -- A buyer nobody researched any more: no shipments, no people, no channels.
  with gone as (
    delete from public.buyer_profiles profile
    where not exists (select 1 from public.trade_signals signal where signal.buyer_profile_id = profile.id)
      and not exists (select 1 from public.decision_makers person where person.buyer_profile_id = profile.id)
      and not exists (select 1 from public.contact_channels channel where channel.buyer_profile_id = profile.id)
      and coalesce(profile.last_signal_at, profile.created_at) < now() - make_interval(days => greatest(coalesce(p_orphan_days, 30), 0))
    returning profile.id
  )
  select count(*) into v_profiles from gone;

  return query select v_channels, v_people, v_profiles;
end;
$$;

comment on function public.purge_expired_people(integer) is
  'Deletes expired people/channels and orphaned buyer profiles. Run from the same scheduled job as the artifact sweep.';

-- ---------------------------------------------------------------------------
-- Access: members read their workspace, only the service role writes.
-- ---------------------------------------------------------------------------
alter table public.market_sources enable row level security;
alter table public.buyer_profiles enable row level security;
alter table public.trade_signals enable row level security;
alter table public.decision_makers enable row level security;
alter table public.contact_channels enable row level security;

-- The source catalogue is not tenant data: any signed-in user may read it.
create policy "market sources readable" on public.market_sources
for select using (auth.uid() is not null);

create policy "buyers readable by organization" on public.buyer_profiles
for select using (public.is_organization_member(organization_id));

create policy "trade signals readable by organization" on public.trade_signals
for select using (public.is_organization_member(organization_id));

create policy "decision makers readable by organization" on public.decision_makers
for select using (public.is_organization_member(organization_id));

create policy "channels readable by organization" on public.contact_channels
for select using (public.is_organization_member(organization_id));

-- No insert/update/delete policies on purpose: connectors write with the
-- service role, which bypasses RLS. Revoke the table privileges too so a
-- future policy mistake cannot open writes from the browser.
revoke insert, update, delete on public.market_sources from anon, authenticated;
revoke insert, update, delete on public.buyer_profiles from anon, authenticated;
revoke insert, update, delete on public.trade_signals from anon, authenticated;
revoke insert, update, delete on public.decision_makers from anon, authenticated;
revoke insert, update, delete on public.contact_channels from anon, authenticated;

grant select on public.market_sources to authenticated, service_role;
grant select on public.buyer_profiles to authenticated, service_role;
grant select on public.trade_signals to authenticated, service_role;
grant select on public.decision_makers to authenticated, service_role;
grant select on public.contact_channels to authenticated, service_role;

revoke all on function public.purge_expired_people(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_people(integer) to service_role;
