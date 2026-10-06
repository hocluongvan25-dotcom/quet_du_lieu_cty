-- Seekora / Company Intelligence
-- Initial multi-tenant schema for Supabase (PostgreSQL)
-- Run with: supabase db push or paste into the Supabase SQL editor.

create extension if not exists "pgcrypto";

create type public.workspace_plan as enum ('starter', 'pro', 'team', 'enterprise');
create type public.research_status as enum ('queued', 'researching', 'ready', 'needs_review', 'failed', 'expired');
create type public.source_kind as enum ('website', 'directory', 'social', 'news', 'registry', 'customer_input');
create type public.ledger_type as enum ('credit', 'debit', 'refund', 'adjustment');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan public.workspace_plan not null default 'starter',
  credits_balance integer not null default 0 check (credits_balance >= 0),
  default_retention_days integer not null default 30 check (default_retention_days between 1 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  input_company_name text,
  input_source_url text,
  input_country text,
  status public.research_status not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  provider_trace jsonb not null default '{}'::jsonb,
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (input_company_name is not null or input_source_url is not null)
);

create table public.company_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_job_id uuid not null unique references public.research_jobs(id) on delete cascade,
  company_name text not null,
  legal_name text,
  country text,
  city text,
  industry text,
  description text,
  official_website text,
  linkedin_url text,
  public_business_email text,
  public_business_phone text,
  whatsapp_business_url text,
  confidence smallint not null default 0 check (confidence between 0 and 100),
  report_data jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_report_id uuid not null references public.company_reports(id) on delete cascade,
  kind public.source_kind not null,
  source_label text not null,
  source_url text not null,
  field_name text,
  evidence_snippet text,
  content_hash text,
  artifact_storage_path text,
  is_verified boolean not null default false,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  research_job_id uuid references public.research_jobs(id) on delete set null,
  type public.ledger_type not null,
  amount integer not null check (amount > 0),
  description text not null,
  external_reference text,
  created_at timestamptz not null default now()
);

create index research_jobs_organization_created_idx on public.research_jobs (organization_id, created_at desc);
create index research_jobs_status_idx on public.research_jobs (status);
create index company_reports_organization_captured_idx on public.company_reports (organization_id, captured_at desc);
create index company_reports_expiry_idx on public.company_reports (expires_at);
create index source_evidence_report_idx on public.source_evidence (company_report_id, created_at asc);
create index source_evidence_expiry_idx on public.source_evidence (expires_at);
create index credit_ledger_organization_created_idx on public.credit_ledger (organization_id, created_at desc);

-- Helper used by all RLS policies. Security definer avoids recursion while
-- checking organization_members; search_path is locked for safety.
create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
  );
$$;

create or replace function public.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin')
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger organizations_touch_updated_at before update on public.organizations
for each row execute function public.touch_updated_at();
create trigger research_jobs_touch_updated_at before update on public.research_jobs
for each row execute function public.touch_updated_at();
create trigger company_reports_touch_updated_at before update on public.company_reports
for each row execute function public.touch_updated_at();

-- Create a profile automatically whenever Supabase Auth creates a user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.research_jobs enable row level security;
alter table public.company_reports enable row level security;
alter table public.source_evidence enable row level security;
alter table public.credit_ledger enable row level security;

create policy "profiles readable by self" on public.profiles
for select using (id = auth.uid());
create policy "profiles writable by self" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

create policy "organizations readable by members" on public.organizations
for select using (public.is_organization_member(id));
create policy "organizations editable by admins" on public.organizations
for update using (public.is_organization_admin(id)) with check (public.is_organization_admin(id));

create policy "members readable by organization" on public.organization_members
for select using (public.is_organization_member(organization_id));
create policy "members managed by admins" on public.organization_members
for all using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));

create policy "research jobs readable by organization" on public.research_jobs
for select using (public.is_organization_member(organization_id));
create policy "members create research jobs" on public.research_jobs
for insert with check (public.is_organization_member(organization_id) and created_by = auth.uid());
create policy "members update their research jobs" on public.research_jobs
for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create policy "reports readable by organization" on public.company_reports
for select using (public.is_organization_member(organization_id));
create policy "reports managed by organization" on public.company_reports
for all using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create policy "evidence readable by organization" on public.source_evidence
for select using (public.is_organization_member(organization_id));
create policy "evidence managed by organization" on public.source_evidence
for all using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create policy "ledger readable by organization" on public.credit_ledger
for select using (public.is_organization_member(organization_id));

-- Store raw HTML/screenshots/PDFs in a private Supabase Storage bucket called
-- `research-artifacts`. Attach paths in source_evidence.artifact_storage_path.
-- Apply a daily Edge Function or pg_cron task that deletes objects and rows with
-- expires_at < now(). Never retain an artifact longer than its source terms allow.
