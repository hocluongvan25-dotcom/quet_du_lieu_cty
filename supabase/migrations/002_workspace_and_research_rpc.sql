-- Seekora / Company Intelligence
-- 002: atomic RPCs for workspace onboarding and research persistence.
--
-- The Next.js app never writes credits or reports with separate statements.
-- Both flows below run inside a single function call, so a failure rolls back
-- completely and the browser can never invent its own organization or price.

-- ---------------------------------------------------------------------------
-- Onboarding: give the signed-in user a workspace, an owner membership and a
-- starter credit grant recorded in the ledger. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_workspace(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_organization_id uuid;
  v_name text;
  v_slug text;
  v_starter_credits constant integer := 50;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select membership.organization_id into v_organization_id
  from public.organization_members membership
  where membership.user_id = v_user
  order by membership.created_at asc
  limit 1;

  if v_organization_id is not null then
    return v_organization_id;
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(u.email, '@', 1), ''))
      into v_name
    from auth.users u
    where u.id = v_user;
  end if;
  v_name := coalesce(v_name, 'Workspace ' || left(v_user::text, 8));

  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    v_slug := 'workspace';
  end if;
  v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.organizations (name, slug, plan, credits_balance)
  values (v_name, v_slug, 'starter', 0)
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_user, 'owner');

  if v_starter_credits > 0 then
    insert into public.credit_ledger (organization_id, created_by, type, amount, description)
    values (v_organization_id, v_user, 'credit', v_starter_credits, 'Starter workspace grant');

    update public.organizations
    set credits_balance = credits_balance + v_starter_credits
    where id = v_organization_id;
  end if;

  return v_organization_id;
end;
$$;

comment on function public.bootstrap_workspace(text) is
  'Creates the caller''s first workspace with owner membership and starter credits. Idempotent.';

-- ---------------------------------------------------------------------------
-- Research persistence: reserve credits, store the job, the report and its
-- evidence, then settle the charge. Returns the new company_reports id.
--
-- p_report / p_evidence carry the provider output; every value is validated or
-- coerced here so a malformed payload cannot corrupt the ledger.
-- ---------------------------------------------------------------------------
create or replace function public.complete_research_job(
  p_organization_id uuid,
  p_input_company_name text default null,
  p_input_source_url text default null,
  p_input_country text default null,
  p_report jsonb default '{}'::jsonb,
  p_evidence jsonb default '[]'::jsonb,
  p_cost integer default 5,
  p_retention_days integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_job_id uuid;
  v_report_id uuid;
  v_balance integer;
  v_captured_at timestamptz := now();
  v_expires_at timestamptz;
  v_company_name text;
  v_confidence integer;
  v_retention_days integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not public.is_organization_member(p_organization_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  if p_cost is null or p_cost < 0 then
    raise exception 'cost must be zero or positive' using errcode = '22023';
  end if;

  v_company_name := nullif(btrim(coalesce(p_report ->> 'company_name', p_input_company_name, '')), '');
  if v_company_name is null then
    raise exception 'company name is required' using errcode = '22023';
  end if;

  if coalesce(btrim(p_input_company_name), '') = '' and coalesce(btrim(p_input_source_url), '') = '' then
    raise exception 'company name or source url is required' using errcode = '22023';
  end if;

  v_retention_days := greatest(coalesce(p_retention_days, 30), 1);
  v_expires_at := v_captured_at + make_interval(days => v_retention_days);

  -- Lock the workspace row so two concurrent jobs cannot overspend.
  select credits_balance into v_balance
  from public.organizations
  where id = p_organization_id
  for update;

  if v_balance is null then
    raise exception 'workspace not found' using errcode = '42501';
  end if;

  if v_balance < p_cost then
    raise exception 'insufficient credits' using errcode = 'SK402';
  end if;

  insert into public.research_jobs (
    organization_id, created_by, input_company_name, input_source_url, input_country,
    status, progress, credits_reserved, credits_charged, started_at
  )
  values (
    p_organization_id, v_user,
    nullif(btrim(coalesce(p_input_company_name, '')), ''),
    nullif(btrim(coalesce(p_input_source_url, '')), ''),
    nullif(btrim(coalesce(p_input_country, '')), ''),
    'researching', 60, p_cost, 0, v_captured_at
  )
  returning id into v_job_id;

  v_confidence := case
    when jsonb_typeof(p_report -> 'confidence') = 'number' then (p_report ->> 'confidence')::integer
    when (p_report ->> 'confidence') ~ '^[0-9]{1,3}$' then (p_report ->> 'confidence')::integer
    else 0
  end;
  v_confidence := greatest(0, least(100, coalesce(v_confidence, 0)));

  insert into public.company_reports (
    organization_id, research_job_id, company_name, legal_name, country, city, industry,
    description, official_website, linkedin_url, public_business_email, public_business_phone,
    whatsapp_business_url, confidence, report_data, captured_at, expires_at
  )
  values (
    p_organization_id, v_job_id, v_company_name,
    nullif(btrim(coalesce(p_report ->> 'legal_name', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'country', p_input_country, '')), ''),
    nullif(btrim(coalesce(p_report ->> 'city', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'industry', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'description', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'official_website', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'linkedin_url', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'public_business_email', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'public_business_phone', '')), ''),
    nullif(btrim(coalesce(p_report ->> 'whatsapp_business_url', '')), ''),
    v_confidence,
    case when jsonb_typeof(p_report -> 'report_data') = 'object' then p_report -> 'report_data' else '{}'::jsonb end,
    v_captured_at,
    v_expires_at
  )
  returning id into v_report_id;

  insert into public.source_evidence (
    organization_id, company_report_id, kind, source_label, source_url, field_name,
    evidence_snippet, content_hash, artifact_storage_path, is_verified, captured_at, expires_at
  )
  select
    p_organization_id,
    v_report_id,
    case
      when element ->> 'kind' in ('website', 'directory', 'social', 'news', 'registry', 'customer_input')
        then (element ->> 'kind')::public.source_kind
      else 'website'::public.source_kind
    end,
    coalesce(nullif(btrim(element ->> 'source_label'), ''), 'Source'),
    element ->> 'source_url',
    nullif(btrim(coalesce(element ->> 'field_name', '')), ''),
    nullif(btrim(coalesce(element ->> 'evidence_snippet', '')), ''),
    nullif(btrim(coalesce(element ->> 'content_hash', '')), ''),
    nullif(btrim(coalesce(element ->> 'artifact_storage_path', '')), ''),
    case when jsonb_typeof(element -> 'is_verified') = 'boolean' then (element ->> 'is_verified')::boolean else false end,
    v_captured_at,
    v_expires_at
  from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) as element
  where nullif(btrim(coalesce(element ->> 'source_url', '')), '') is not null;

  if p_cost > 0 then
    update public.organizations
    set credits_balance = credits_balance - p_cost
    where id = p_organization_id;

    insert into public.credit_ledger (organization_id, created_by, research_job_id, type, amount, description)
    values (p_organization_id, v_user, v_job_id, 'debit', p_cost, 'Company Report: ' || v_company_name);
  end if;

  update public.research_jobs
  set status = 'ready',
      progress = 100,
      credits_reserved = 0,
      credits_charged = p_cost,
      provider_trace = case
        when jsonb_typeof(p_report -> 'provider_trace') = 'object' then p_report -> 'provider_trace'
        else '{}'::jsonb
      end,
      completed_at = now()
  where id = v_job_id;

  return v_report_id;
end;
$$;

comment on function public.complete_research_job(uuid, text, text, text, jsonb, jsonb, integer, integer) is
  'Atomically reserves credits, stores the research job, report and evidence, and settles the charge.';

-- Only signed-in users may call these; the service role keeps working through
-- its own credentials.
revoke all on function public.bootstrap_workspace(text) from public, anon;
revoke all on function public.complete_research_job(uuid, text, text, text, jsonb, jsonb, integer, integer) from public, anon;
grant execute on function public.bootstrap_workspace(text) to authenticated, service_role;
grant execute on function public.complete_research_job(uuid, text, text, text, jsonb, jsonb, integer, integer) to authenticated, service_role;
