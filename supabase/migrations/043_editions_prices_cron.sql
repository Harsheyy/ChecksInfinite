-- supabase/migrations/043_editions_prices_cron.sql
-- Schedule sync-editions-prices hourly at :20 (5 min after sync-market-prices
-- at :15, so sync-checkmath at :30 has fresh data from both).
--
-- To remove:   SELECT cron.unschedule('sync-editions-prices');
-- To run now:  POST https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-editions-prices

select cron.schedule(
  'sync-editions-prices',
  '20 * * * *',
  $$
  select
    net.http_post(
      url     := 'https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-editions-prices',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
