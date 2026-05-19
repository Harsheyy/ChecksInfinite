-- Migration 018: schedule sync-market-prices edge function hourly at :15
-- Keeps all_checks.eth_price and all_permutations.is_all_listed fresh.
--
-- Requires OPENSEA_API_KEY secret set in:
--   Supabase dashboard → Edge Functions → Secrets
--
-- To remove:   SELECT cron.unschedule('sync-market-prices');
-- To run now:  POST https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-market-prices

select cron.schedule(
  'sync-market-prices',
  '15 * * * *',
  $$
  select
    net.http_post(
      url     := 'https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-market-prices',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
