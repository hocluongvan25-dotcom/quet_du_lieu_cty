-- Seekora / Company Intelligence
-- 004: schedule the retention sweep.
--
-- The sweep itself lives in the app at POST /api/maintenance/retention, because
-- deleting a Storage object needs the Storage API rather than SQL. This file
-- only wires the schedule, using pg_cron to fire an HTTP request through
-- pg_net.
--
-- 1. Deploy the app (or expose a tunnel) and set CRON_SECRET on it.
-- 2. Run this file, then schedule the job once per environment:
--
--      select public.schedule_retention_cron(
--        'https://your-app.example.com/api/maintenance/retention',
--        'the-same-secret-you-set'
--      );
--
--    Re-running it replaces the previous schedule.
-- 3. Inspect the job with:
--
--      select * from cron.job;
--      select * from cron.job_run_details order by start_time desc limit 10;
--      select * from net._http_response order by created desc limit 10;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Creates or replaces the nightly sweep. Returns the cron job id.
create or replace function public.schedule_retention_cron(
  p_url text,
  p_secret text,
  p_schedule text default '0 3 * * *'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id bigint;
begin
  if coalesce(btrim(p_url), '') = '' or coalesce(btrim(p_secret), '') = '' then
    raise exception 'p_url and p_secret are required' using errcode = '22023';
  end if;

  if to_regclass('cron.job') is null then
    raise exception 'pg_cron is not enabled on this project' using errcode = '0A000';
  end if;

  if to_regclass('net.http_post') is null then
    raise exception 'pg_net is not enabled on this project' using errcode = '0A000';
  end if;

  -- Replace any previous schedule with the same name.
  for v_job_id in
    select jobid from cron.job where jobname = 'seekora-retention-sweep'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  select cron.schedule(
    'seekora-retention-sweep',
    p_schedule,
    format(
      $job$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || %L),
          body := jsonb_build_object('trigger', 'pg_cron'),
          timeout_milliseconds := 120000
        );
      $job$,
      p_url,
      p_secret
    )
  )
  into v_job_id;

  return v_job_id;
end;
$$;

comment on function public.schedule_retention_cron(text, text, text) is
  'Schedules (or replaces) the nightly HTTP call that deletes expired research artifacts.';

-- Only the service role may install the schedule: it embeds the shared secret.
revoke all on function public.schedule_retention_cron(text, text, text) from public, anon, authenticated;
grant execute on function public.schedule_retention_cron(text, text, text) to service_role;
