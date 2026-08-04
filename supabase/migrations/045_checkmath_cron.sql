-- supabase/migrations/045_checkmath_cron.sql
-- Schedule sync-checkmath hourly at :30, after both price syncs (:15 and
-- :20) have finished, so it always computes against fresh data.
--
-- To remove:   SELECT cron.unschedule('sync-checkmath');
-- To run now:  POST https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-checkmath

select cron.schedule(
  'sync-checkmath',
  '30 * * * *',
  $$
  select
    net.http_post(
      url     := 'https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-checkmath',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
