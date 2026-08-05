-- supabase/migrations/051_capture_drifted_objects.sql
-- Captures three public-schema objects that exist in production but were
-- never written into a migration — they were created by hand at some point
-- and have been drifting silently ever since.
--
-- Nothing here changes production behaviour. Every definition below was read
-- back out of the live database with pg_get_functiondef and is reproduced
-- verbatim, so applying this migration to a fresh database yields the schema
-- prod already has. The point is to make a rebuild-from-migrations faithful.
--
-- Audit note (2026-08-05): none of the three are called from application or
-- edge-function code. They are kept rather than dropped because dropping is
-- the irreversible direction and nothing is costing us by their presence.
-- If you later confirm they are dead, dropping them is a one-line migration.

-- ─── get_random_permutations ────────────────────────────────────────────────
-- Random sample from the legacy `permutations` table (not `all_permutations`).
-- Predates the all_permutations split; no current caller.
CREATE OR REPLACE FUNCTION public.get_random_permutations(row_count integer DEFAULT 2500)
RETURNS TABLE(
  keeper_1_id     integer,
  burner_1_id     integer,
  keeper_2_id     integer,
  burner_2_id     integer,
  abcd_checks     integer,
  abcd_color_band text,
  abcd_gradient   text,
  abcd_speed      text,
  abcd_shift      text
)
LANGUAGE sql
STABLE
AS $function$
    SELECT keeper_1_id, burner_1_id, keeper_2_id, burner_2_id,
           abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift
    FROM permutations ORDER BY random() LIMIT row_count;
  $function$;

-- ─── log_wallet_purchase ────────────────────────────────────────────────────
-- Upserts purchase totals onto connected_wallets. Superseded in practice by
-- the credits flow (charge_credits / log_wallet_purchase was the older path).
CREATE OR REPLACE FUNCTION public.log_wallet_purchase(
  p_address      text,
  p_spent_eth    numeric,
  p_checks_count integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
  begin
    insert into connected_wallets (
      address, first_seen, last_seen, visit_count, total_spent_eth, checks_purchased
    )
    values (lower(p_address), now(), now(), 1, p_spent_eth, p_checks_count)
    on conflict (address) do update
      set last_seen        = now(),
          total_spent_eth  = connected_wallets.total_spent_eth + p_spent_eth,
          checks_purchased = connected_wallets.checks_purchased + p_checks_count;
  end;
  $function$;

-- ─── set_updated_at ─────────────────────────────────────────────────────────
-- Generic updated_at trigger function. Currently attached to NO triggers
-- (verified against information_schema.triggers), so it is inert — captured
-- only so the schema is reproducible.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end
$function$;
