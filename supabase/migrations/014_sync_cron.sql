-- Enable extensions (both are available on all Supabase projects)
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Schedule sync-tokenstr to run every hour at :05 past the hour.
-- pg_net fires the HTTP request async — the cron job returns immediately.
-- The edge function logs progress to sync_log (job = 'sync-tokenstr').
--
-- To remove the schedule:  SELECT cron.unschedule('sync-tokenstr');
-- To run immediately:      POST https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-tokenstr
select cron.schedule(
  'sync-tokenstr',
  '5 * * * *',
  $$
  select
    net.http_post(
      url     := 'https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-tokenstr',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
