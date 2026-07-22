-- Migration 025: authenticate cron → edge function calls
--
-- sync-tokenstr and sync-market-prices are deployed with JWT verification off
-- (pg_net can't sign JWTs), which previously left them publicly invokable —
-- anyone could hammer them and burn the OpenSea/Alchemy API quota.
--
-- Fix: pg_cron now sends an x-cron-secret header read from Supabase Vault,
-- and both edge functions reject requests without the matching CRON_SECRET.
--
-- ⚠ PREREQUISITES (do these BEFORE applying this migration / deploying):
--   1. Generate a secret:            openssl rand -hex 32
--   2. Store it in Vault (SQL editor):
--        select vault.create_secret('<generated-secret>', 'cron_secret');
--   3. Set the same value for the edge functions:
--        supabase secrets set CRON_SECRET=<generated-secret>
--   4. Redeploy both functions:
--        supabase functions deploy sync-tokenstr sync-market-prices

-- Remove the old unauthenticated schedules (ignore "job not found")
DO $$ BEGIN PERFORM cron.unschedule('sync-tokenstr');      EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('sync-market-prices'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- sync-tokenstr: hourly at :05 (matches migration 014)
select cron.schedule(
  'sync-tokenstr',
  '5 * * * *',
  $$
  select
    net.http_post(
      url     := 'https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-tokenstr',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);

-- sync-market-prices: hourly at :15 (matches migration 018)
select cron.schedule(
  'sync-market-prices',
  '15 * * * *',
  $$
  select
    net.http_post(
      url     := 'https://wfumeshdazbstfseytcf.supabase.co/functions/v1/sync-market-prices',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
