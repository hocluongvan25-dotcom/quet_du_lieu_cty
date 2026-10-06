-- Seekora / Company Intelligence
-- 006: Contact Candidate & Verification Pipeline.
--
-- 005 treated inference as a flavour of a stored channel. That was the wrong
-- shape: an observed phone number on a company website and a pattern email that
-- nobody has ever seen are different kinds of object. They have different
-- evidence, different lifetimes and different export rules.
--
-- This migration separates them, following the four-layer model:
--
--   A. observed channels   public.contact_channels      — seen on a source, cited
--   B. contact candidates  public.contact_candidates    — hypotheses, expire fast
--   C. verification events public.contact_verification_events — one row per check
--   D. outreach policy     public.contact_export_policy — visible / exportable /
--                                                         outreach_eligible +
--                                                         blocked_reason, in SQL
--
-- Two corrections to 005 that matter:
--   * catch_all is not "good enough to export". A catch-all domain accepts every
--     address, so a catch-all result says nothing about whether the mailbox
--     exists. It is blocked by default and needs an explicit customer override.
--   * delivery is not identity. A mailbox can exist and still belong to someone
--     else, so identity_match is tracked separately from both.
--
-- Also adds buyer_routes (the department-first path): vendor registration forms,
-- supplier portals and RFQ pages are what an exporter actually needs before any
-- person's name is known.
--
-- Nothing is deleted here. 005 stays as pushed history; this migration is additive.

-- ---------------------------------------------------------------------------
-- New vocabulary.
-- ---------------------------------------------------------------------------
-- Whose address is this? Delivery and ownership are separate questions.
create type public.identity_match as enum (
  'person',           -- the address/page belongs to a named individual
  'department',       -- e.g. procurement@ or a role mailbox
  'company_general',  -- e.g. info@, main switchboard
  'unknown'
);

create type public.candidate_status as enum (
  'proposed',   -- generated, not yet sent anywhere
  'queued',     -- waiting for a verification run
  'promoted',   -- a verifier said the mailbox exists; now a labelled channel
  'rejected',   -- a verifier said it does not exist, or a human rejected it
  'expired'
);

-- The department-first route into a company. This is what a seller without a
-- name can still act on today.
create type public.route_kind as enum (
  'vendor_registration',  -- "become a supplier" form
  'supplier_portal',      -- Ariba/Coupa/SAP-style onboarding portal
  'rfq_form',             -- request-for-quote page
  'procurement_page',     -- "Suppliers" / "Procurement" section
  'department_email',     -- published procurement@ address
  'department_phone',     -- published purchasing line
  'trade_show_contact'    -- exhibitor contact published by the organiser
);

-- ---------------------------------------------------------------------------
-- A. Observed channels gain identity and evidence.
-- ---------------------------------------------------------------------------
alter table public.contact_channels
  add column identity_match public.identity_match not null default 'unknown',
  add column evidence_snippet text;

comment on column public.contact_channels.identity_match is
  'Whose address this is. Separate from deliverability (does the mailbox exist) and is_verified (did we tie it to this person).';
comment on column public.contact_channels.evidence_snippet is
  'The line on the source page that shows the value, so a reviewer can see why it was recorded without re-opening the page.';

-- ---------------------------------------------------------------------------
-- B. Candidates: hypotheses, not contacts.
-- ---------------------------------------------------------------------------
create table public.contact_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_profile_id uuid not null references public.buyer_profiles(id) on delete cascade,
  decision_maker_id uuid references public.decision_makers(id) on delete set null,
  market_source_id uuid references public.market_sources(id) on delete set null,
  channel_type public.channel_type not null,
  candidate_value text not null,
  pattern_used text not null check (nullif(btrim(pattern_used), '') is not null),
  inference_basis text not null check (nullif(btrim(inference_basis), '') is not null),
  identity_match public.identity_match not null default 'unknown',
  status public.candidate_status not null default 'proposed',
  promoted_channel_id uuid references public.contact_channels(id) on delete set null,
  discovered_by public.discovered_by not null default 'inferred_pattern',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Candidates are the shortest-lived object in the system: a guess that nobody
  -- verified is worthless within weeks.
  expires_at timestamptz not null default (now() + interval '30 days'),
  -- A promoted candidate must point at what it became.
  check (status <> 'promoted' or promoted_channel_id is not null),
  check (nullif(btrim(candidate_value), '') is not null),
  unique (buyer_profile_id, channel_type, candidate_value)
);

create trigger contact_candidates_touch_updated_at before update on public.contact_candidates
for each row execute function public.touch_updated_at();

comment on table public.contact_candidates is
  'Pattern-generated contact hypotheses. Never exported directly: a candidate has to pass a verification event and be promoted into contact_channels first.';

create index contact_candidates_buyer_idx on public.contact_candidates (buyer_profile_id, status);
create index contact_candidates_expiry_idx on public.contact_candidates (expires_at);
create index contact_candidates_org_idx on public.contact_candidates (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- C. Verification events: an append-only log, not a mutable status column.
-- ---------------------------------------------------------------------------
create table public.contact_verification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid references public.contact_candidates(id) on delete cascade,
  channel_id uuid references public.contact_channels(id) on delete cascade,
  provider text not null check (nullif(btrim(provider), '') is not null),
  result public.email_deliverability not null,
  raw_response jsonb,
  cost_usd numeric(10, 4) check (cost_usd is null or cost_usd >= 0),
  checked_by uuid,
  checked_at timestamptz not null default now(),
  -- A verification event must be about something, and must have a real result.
  check (candidate_id is not null or channel_id is not null),
  check (result <> 'not_checked')
);

comment on table public.contact_verification_events is
  'Append-only log of mailbox checks. Keeping history means we can see that an address was valid in March and invalid in June, instead of silently overwriting the old answer.';

create index contact_verification_events_candidate_idx on public.contact_verification_events (candidate_id, checked_at desc);
create index contact_verification_events_channel_idx on public.contact_verification_events (channel_id, checked_at desc);
create index contact_verification_events_org_idx on public.contact_verification_events (organization_id, checked_at desc);

-- Latest answer per candidate, for the UI and for the policy view.
create view public.contact_candidate_status
with (security_invoker = true) as
select
  candidate.*,
  latest.provider as latest_provider,
  latest.result as latest_result,
  latest.checked_at as latest_checked_at,
  candidate.expires_at <= now() as is_expired
from public.contact_candidates candidate
left join lateral (
  select event.provider, event.result, event.checked_at
  from public.contact_verification_events event
  where event.candidate_id = candidate.id
  order by event.checked_at desc
  limit 1
) latest on true;

comment on view public.contact_candidate_status is
  'Candidates with the newest verification result attached, so the app never has to guess which check was the last one.';

-- ---------------------------------------------------------------------------
-- D. The outreach policy, expressed once in SQL.
-- ---------------------------------------------------------------------------
drop view if exists public.buyer_outreach_summary;
drop view if exists public.outreach_ready_contacts;
drop view if exists public.outreach_ready_channels;

create view public.contact_export_policy
with (security_invoker = true) as
with scored as (
  select
    channel.*,
    case
      when channel.expires_at <= now() then 'expired'
      when channel.deliverability = 'invalid' then 'mailbox_invalid'
      -- A catch-all domain accepts anything, so this result proves nothing.
      when channel.deliverability = 'catch_all' then 'catch_all_needs_override'
      when channel.certainty = 'inferred' and channel.deliverability <> 'valid' then 'unverified_candidate'
      -- Mailbox exists, but nobody has shown it belongs to this person.
      when channel.certainty = 'inferred' then 'identity_unconfirmed'
      when channel.channel_type = 'email' and channel.deliverability <> 'valid' then 'deliverability_unchecked'
      when channel.channel_type = 'linkedin_url' then 'manual_contact_only'
      else null
    end as blocked_reason
  from public.contact_channels channel
)
select
  scored.*,
  case when scored.is_verified then 'verified' else scored.certainty::text end as confidence_label,
  scored.deliverability <> 'not_checked' as deliverability_checked,
  true as visible_in_app,
  -- CSV and CRM export: everything a customer may legitimately hold. That
  -- includes a published address whose mailbox has not been checked yet, a
  -- profile link, and a deliverable-but-unattributed guess behind an override.
  -- What it never includes: expired rows, dead mailboxes, catch-all results and
  -- guesses no verifier has ever seen.
  scored.blocked_reason is null
    or scored.blocked_reason in ('identity_unconfirmed', 'deliverability_unchecked', 'manual_contact_only') as exportable,
  -- Anything a customer can consciously opt into. The UI must show why.
  scored.blocked_reason in ('catch_all_needs_override', 'identity_unconfirmed') as requires_override,
  -- Automated outreach: no override, no unchecked mailbox, no profile link.
  scored.blocked_reason is null as outreach_eligible
from scored;

comment on view public.contact_export_policy is
  'The single place that decides visible_in_app / exportable / outreach_eligible and says why. Server and database enforce it; the UI only reflects it.';

-- Kept under their 005 names so callers do not have to change.
create view public.outreach_ready_channels
with (security_invoker = true) as
select * from public.contact_export_policy where exportable;

comment on view public.outreach_ready_channels is
  'Channels that may be exported: not expired, not known-dead, not catch-all, and (when inferred) mailbox-validated.';

create view public.outreach_ready_contacts
with (security_invoker = true) as
select
  buyer.organization_id,
  buyer.id as buyer_profile_id,
  buyer.display_name as buyer_name,
  buyer.country,
  buyer.website,
  buyer.fit_score,
  person.id as decision_maker_id,
  person.full_name,
  person.job_title,
  person.department,
  policy.id as channel_id,
  policy.channel_type,
  policy.value,
  policy.confidence_label,
  policy.certainty,
  policy.identity_match,
  policy.deliverability,
  policy.is_verified,
  policy.exportable,
  policy.requires_override,
  policy.outreach_eligible,
  policy.blocked_reason,
  policy.source_url,
  policy.last_seen_at,
  policy.expires_at,
  case
    when policy.decision_maker_id is not null then 'a'   -- a channel of that person or department
    when person.full_name is not null then 'b'            -- we know who, but only a company line
    else 'c'                                              -- only a role so far
  end as outreach_grade
from public.outreach_ready_channels policy
join public.buyer_profiles buyer on buyer.id = policy.buyer_profile_id
left join public.decision_makers person on person.id = policy.decision_maker_id;

comment on view public.outreach_ready_contacts is
  'One row per exportable way to reach a buyer, with grade, confidence, deliverability and any override flag. This is the CSV.';

create view public.buyer_outreach_summary
with (security_invoker = true) as
select
  buyer.organization_id,
  buyer.id as buyer_profile_id,
  buyer.display_name,
  buyer.country,
  buyer.region,
  buyer.website,
  buyer.industry,
  buyer.fit_score,
  buyer.last_signal_at,
  count(contact.channel_id) as reachable_channels,
  count(contact.channel_id) filter (where contact.is_verified) as verified_channels,
  count(distinct contact.full_name) as named_people,
  min(contact.outreach_grade) as best_grade,
  count(contact.channel_id) filter (where contact.outreach_eligible) as outreach_ready_channels,
  max(contact.last_seen_at) as last_contact_seen_at
from public.buyer_profiles buyer
left join public.outreach_ready_contacts contact on contact.buyer_profile_id = buyer.id
group by buyer.organization_id, buyer.id, buyer.display_name, buyer.country, buyer.region,
         buyer.website, buyer.industry, buyer.fit_score, buyer.last_signal_at;

comment on view public.buyer_outreach_summary is
  'Buyer list screen: how well each buyer can actually be reached (A/B/C, verified count, outreach-ready count).';

-- ---------------------------------------------------------------------------
-- E. Department-first routes: what to do before any name is known.
-- ---------------------------------------------------------------------------
create table public.buyer_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_profile_id uuid not null references public.buyer_profiles(id) on delete cascade,
  market_source_id uuid references public.market_sources(id) on delete set null,
  route_kind public.route_kind not null,
  department text,
  url text,
  value text,
  source_url text not null check (nullif(btrim(source_url), '') is not null),
  evidence_snippet text,
  is_verified boolean not null default false,
  discovered_by public.discovered_by not null default 'web_research_agent',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(coalesce(url, value, '')), '') is not null),
  -- The route kinds that are a place to go must actually have a place to go.
  check (route_kind not in ('vendor_registration', 'supplier_portal', 'rfq_form', 'procurement_page') or url is not null)
);

create trigger buyer_routes_touch_updated_at before update on public.buyer_routes
for each row execute function public.touch_updated_at();

comment on table public.buyer_routes is
  'Published ways into a buying organisation: vendor registration, supplier portals, RFQ pages, department mailboxes. Company-level data with no personal expiry, and the first thing to try before resolving a person.';

create unique index buyer_routes_unique_idx
  on public.buyer_routes (buyer_profile_id, route_kind, md5(coalesce(url, value)));
create index buyer_routes_buyer_idx on public.buyer_routes (buyer_profile_id, route_kind);
create index buyer_routes_org_idx on public.buyer_routes (organization_id, route_kind);

-- ---------------------------------------------------------------------------
-- Retention: candidates are cleaned up with the rest of the personal data.
-- ---------------------------------------------------------------------------
drop function public.purge_expired_people(integer);

create function public.purge_expired_people(p_orphan_days integer default 30)
returns table (
  deleted_channels integer,
  deleted_candidates integer,
  deleted_decision_makers integer,
  deleted_buyer_profiles integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channels integer := 0;
  v_candidates integer := 0;
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
    delete from public.contact_candidates candidate
    where candidate.expires_at < now()
    returning candidate.id
  )
  select count(*) into v_candidates from gone;

  with gone as (
    delete from public.decision_makers person
    where person.expires_at < now()
    returning person.id
  )
  select count(*) into v_people from gone;

  -- A buyer nobody researched any more: no shipments, no people, no channels,
  -- no candidates and no route into them either.
  with gone as (
    delete from public.buyer_profiles profile
    where not exists (select 1 from public.trade_signals signal where signal.buyer_profile_id = profile.id)
      and not exists (select 1 from public.decision_makers person where person.buyer_profile_id = profile.id)
      and not exists (select 1 from public.contact_channels channel where channel.buyer_profile_id = profile.id)
      and not exists (select 1 from public.contact_candidates candidate where candidate.buyer_profile_id = profile.id)
      and not exists (select 1 from public.buyer_routes route where route.buyer_profile_id = profile.id)
      and coalesce(profile.last_signal_at, profile.created_at) < now() - make_interval(days => greatest(coalesce(p_orphan_days, 30), 0))
    returning profile.id
  )
  select count(*) into v_profiles from gone;

  return query select v_channels, v_candidates, v_people, v_profiles;
end;
$$;

comment on function public.purge_expired_people(integer) is
  'Deletes expired people, channels and candidates, plus orphaned buyer profiles. Run from the same scheduled job as the artifact sweep.';

-- ---------------------------------------------------------------------------
-- Access.
-- ---------------------------------------------------------------------------
alter table public.contact_candidates enable row level security;
alter table public.contact_verification_events enable row level security;
alter table public.buyer_routes enable row level security;

create policy "candidates readable by organization" on public.contact_candidates
for select using (public.is_organization_member(organization_id));

create policy "verification events readable by organization" on public.contact_verification_events
for select using (public.is_organization_member(organization_id));

create policy "routes readable by organization" on public.buyer_routes
for select using (public.is_organization_member(organization_id));

revoke insert, update, delete on public.contact_candidates from anon, authenticated;
revoke insert, update, delete on public.contact_verification_events from anon, authenticated;
revoke insert, update, delete on public.buyer_routes from anon, authenticated;

revoke all on public.contact_candidate_status from anon;
revoke all on public.contact_export_policy from anon;
revoke insert, update, delete on public.contact_candidate_status from anon, authenticated;
revoke insert, update, delete on public.contact_export_policy from anon, authenticated;

grant select on public.contact_candidates to authenticated, service_role;
grant select on public.contact_verification_events to authenticated, service_role;
grant select on public.buyer_routes to authenticated, service_role;
grant select on public.contact_candidate_status to authenticated, service_role;
grant select on public.contact_export_policy to authenticated, service_role;
grant select on public.outreach_ready_channels to authenticated, service_role;
grant select on public.outreach_ready_contacts to authenticated, service_role;
grant select on public.buyer_outreach_summary to authenticated, service_role;

revoke all on function public.purge_expired_people(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_people(integer) to service_role;
