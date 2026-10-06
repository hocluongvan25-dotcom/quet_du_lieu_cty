-- Seekora / Company Intelligence
-- 003: change monitoring, workspace members, artifact bucket and retention.
--
-- Adds what the Team and Change history pages read, stores the private
-- artifact bucket, and exposes the two RPCs a scheduled cleanup job needs.
-- Change history survives snapshot deletion: report_changes keeps the compared
-- values as text and only references reports with ON DELETE SET NULL.

-- ---------------------------------------------------------------------------
-- Change monitoring
-- ---------------------------------------------------------------------------
create type public.change_kind as enum ('added', 'removed', 'changed');

create table public.report_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_report_id uuid references public.company_reports(id) on delete set null,
  previous_report_id uuid references public.company_reports(id) on delete set null,
  company_name text not null,
  field_name text not null,
  change_kind public.change_kind not null,
  previous_value text,
  new_value text,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index report_changes_organization_detected_idx on public.report_changes (organization_id, detected_at desc);
create index report_changes_company_detected_idx on public.report_changes (company_name, detected_at desc);

alter table public.report_changes enable row level security;

create policy "changes readable by organization" on public.report_changes
for select using (public.is_organization_member(organization_id));

-- Deliberately no insert/update/delete policy: rows are only written by
-- complete_research_job(), whose definer rights bypass RLS.

-- ---------------------------------------------------------------------------
-- Team page: members of the caller's workspace.
-- Reads auth.users for the email, so it must be a definer function rather than
-- a policy. It only ever returns rows from workspaces the caller belongs to.
-- ---------------------------------------------------------------------------
create or replace function public.workspace_members()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  joined_at timestamptz,
  reports_created bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    membership.user_id,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(u.email, '@', 1), ''),
      'Member'
    ) as full_name,
    u.email,
    membership.role,
    membership.created_at as joined_at,
    (
      select count(*)
      from public.research_jobs job
      where job.organization_id = membership.organization_id
        and job.created_by = membership.user_id
    ) as reports_created
  from public.organization_members membership
  join auth.users u on u.id = membership.user_id
  where public.is_organization_member(membership.organization_id)
  order by
    case membership.role
      when 'owner' then 0
      when 'admin' then 1
      when 'member' then 2
      else 3
    end,
    membership.created_at asc;
$$;

comment on function public.workspace_members() is
  'Members, emails, roles and research counts for the caller''s workspace.';

-- ---------------------------------------------------------------------------
-- Research persistence with change detection.
-- Same contract as 002, plus a diff against the previous snapshot of the same
-- company inside the same transaction.
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
  v_website text;
  v_linkedin text;
  v_email text;
  v_phone text;
  v_whatsapp text;
  v_country text;
  v_city text;
  v_industry text;
  v_previous_id uuid;
  v_previous_website text;
  v_previous_linkedin text;
  v_previous_email text;
  v_previous_phone text;
  v_previous_whatsapp text;
  v_previous_country text;
  v_previous_city text;
  v_previous_industry text;
  v_previous_confidence integer;
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

  v_website := nullif(btrim(coalesce(p_report ->> 'official_website', '')), '');
  v_linkedin := nullif(btrim(coalesce(p_report ->> 'linkedin_url', '')), '');
  v_email := nullif(btrim(coalesce(p_report ->> 'public_business_email', '')), '');
  v_phone := nullif(btrim(coalesce(p_report ->> 'public_business_phone', '')), '');
  v_whatsapp := nullif(btrim(coalesce(p_report ->> 'whatsapp_business_url', '')), '');
  v_country := nullif(btrim(coalesce(p_report ->> 'country', p_input_country, '')), '');
  v_city := nullif(btrim(coalesce(p_report ->> 'city', '')), '');
  v_industry := nullif(btrim(coalesce(p_report ->> 'industry', '')), '');

  v_confidence := case
    when jsonb_typeof(p_report -> 'confidence') = 'number' then (p_report ->> 'confidence')::integer
    when (p_report ->> 'confidence') ~ '^[0-9]{1,3}$' then (p_report ->> 'confidence')::integer
    else 0
  end;
  v_confidence := greatest(0, least(100, coalesce(v_confidence, 0)));

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

  insert into public.company_reports (
    organization_id, research_job_id, company_name, legal_name, country, city, industry,
    description, official_website, linkedin_url, public_business_email, public_business_phone,
    whatsapp_business_url, confidence, report_data, captured_at, expires_at
  )
  values (
    p_organization_id, v_job_id, v_company_name,
    nullif(btrim(coalesce(p_report ->> 'legal_name', '')), ''),
    v_country, v_city, v_industry,
    nullif(btrim(coalesce(p_report ->> 'description', '')), ''),
    v_website, v_linkedin, v_email, v_phone, v_whatsapp,
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

  -- Compare with the previous snapshot of the same company (same workspace).
  select
    previous.id,
    previous.official_website,
    previous.linkedin_url,
    previous.public_business_email,
    previous.public_business_phone,
    previous.whatsapp_business_url,
    previous.country,
    previous.city,
    previous.industry,
    previous.confidence
  into
    v_previous_id,
    v_previous_website,
    v_previous_linkedin,
    v_previous_email,
    v_previous_phone,
    v_previous_whatsapp,
    v_previous_country,
    v_previous_city,
    v_previous_industry,
    v_previous_confidence
  from public.company_reports previous
  where previous.organization_id = p_organization_id
    and previous.id <> v_report_id
    and lower(btrim(previous.company_name)) = lower(v_company_name)
  order by previous.captured_at desc, previous.created_at desc
  limit 1;

  if v_previous_id is not null then
    insert into public.report_changes (
      organization_id, company_report_id, previous_report_id, company_name,
      field_name, change_kind, previous_value, new_value, detected_at
    )
    select
      p_organization_id,
      v_report_id,
      v_previous_id,
      v_company_name,
      candidate.field_name,
      candidate.change_kind,
      candidate.previous_value,
      candidate.new_value,
      v_captured_at
    from (
      select
        raw.field_name,
        raw.previous_value,
        raw.new_value,
        case
          when raw.previous_value is not distinct from raw.new_value then null
          when raw.previous_value is null then 'added'::public.change_kind
          when raw.new_value is null then 'removed'::public.change_kind
          else 'changed'::public.change_kind
        end as change_kind
      from (values
        ('official_website', v_previous_website, v_website),
        ('linkedin_url', v_previous_linkedin, v_linkedin),
        ('public_business_email', v_previous_email, v_email),
        ('public_business_phone', v_previous_phone, v_phone),
        ('whatsapp_business_url', v_previous_whatsapp, v_whatsapp),
        ('country', v_previous_country, v_country),
        ('city', v_previous_city, v_city),
        ('industry', v_previous_industry, v_industry),
        ('confidence', v_previous_confidence::text, v_confidence::text)
      ) as raw(field_name, previous_value, new_value)
    ) as candidate
    where candidate.change_kind is not null;
  end if;

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

-- ---------------------------------------------------------------------------
-- Retention: expired raw artifacts are deleted through the Storage API first,
-- then the rows that referenced them. Running this without removed paths is
-- safe: rows that still own an artifact are kept for the next attempt.
-- ---------------------------------------------------------------------------
create or replace function public.retention_artifact_paths(p_limit integer default 500)
returns table (evidence_id uuid, storage_path text)
language sql
security definer
set search_path = public
stable
as $$
  select evidence.id, evidence.artifact_storage_path
  from public.source_evidence evidence
  where evidence.artifact_storage_path is not null
    and (
      evidence.expires_at < now()
      or exists (
        select 1
        from public.company_reports report
        where report.id = evidence.company_report_id
          and report.expires_at < now()
      )
    )
  order by evidence.expires_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
$$;

create or replace function public.purge_expired_retention(p_removed_paths text[] default '{}'::text[])
returns table (deleted_evidence integer, deleted_reports integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_evidence integer := 0;
  v_deleted_reports integer := 0;
begin
  with removed as (
    delete from public.source_evidence evidence
    where (
        evidence.artifact_storage_path is null
        or evidence.artifact_storage_path = any(p_removed_paths)
      )
      and (
        evidence.expires_at < now()
        or exists (
          select 1
          from public.company_reports report
          where report.id = evidence.company_report_id
            and report.expires_at < now()
        )
      )
    returning evidence.id
  )
  select count(*) into v_deleted_evidence from removed;

  -- Starter snapshots expire with their evidence. A report that still owns an
  -- artifact is kept so the next run can retry the object deletion.
  with expired as (
    delete from public.company_reports report
    where report.expires_at < now()
      and exists (
        select 1 from public.organizations organization
        where organization.id = report.organization_id
          and organization.plan = 'starter'
      )
      and not exists (
        select 1 from public.source_evidence evidence
        where evidence.company_report_id = report.id
          and evidence.artifact_storage_path is not null
      )
    returning report.id
  )
  select count(*) into v_deleted_reports from expired;

  return query select v_deleted_evidence, v_deleted_reports;
end;
$$;

-- ---------------------------------------------------------------------------
-- Private bucket for raw permitted artifacts.
-- Only the service role can touch it (no storage.objects policies are added),
-- so downloads must go through a server route that checks membership first.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('research-artifacts', 'research-artifacts', false, 26214400)
    on conflict (id) do update set public = false, file_size_limit = 26214400;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: members may read their workspace data, only the service role may run
-- the retention job.
-- ---------------------------------------------------------------------------
revoke all on function public.workspace_members() from public, anon;
grant execute on function public.workspace_members() to authenticated, service_role;

revoke all on function public.retention_artifact_paths(integer) from public, anon, authenticated;
revoke all on function public.purge_expired_retention(text[]) from public, anon, authenticated;
grant execute on function public.retention_artifact_paths(integer) to service_role;
grant execute on function public.purge_expired_retention(text[]) to service_role;

grant select on public.report_changes to authenticated, service_role;
