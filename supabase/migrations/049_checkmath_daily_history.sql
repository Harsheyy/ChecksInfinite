-- supabase/migrations/049_checkmath_daily_history.sql
-- Daily aggregate over checkmath_snapshots for the price-history chart.
--
-- Why an RPC instead of selecting the raw rows: snapshots land hourly, so a
-- 90-day window is ~2,160 rows. Aggregating in Postgres keeps the payload at
-- one row per day and — more importantly — puts the two aggregation rules
-- below in one place instead of trusting every caller to get them right.
--
-- Rule 1 — MIN, not avg or last-of-day. The page answers "what's the cheapest
-- way to own a Check," so each point should answer "what was the best price
-- available that day." A last-of-day sample would swing on whatever happened
-- to be listed at 23:30.
--
-- Rule 2 — the premium ratio is computed PER SNAPSHOT ROW and then aggregated,
-- never by dividing the two aggregated minima. MIN(compose)/MIN(buy) can pair
-- numbers from two different hours and would describe a gap that never existed
-- at any single moment.

CREATE OR REPLACE FUNCTION get_checkmath_daily_history(p_days integer DEFAULT 90)
RETURNS TABLE (
  day                 date,
  buy_low             double precision,
  compose_low         double precision,
  compose_premium_low double precision,
  snapshots           integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (s.computed_at AT TIME ZONE 'UTC')::date AS day,
    MIN(s.cheapest_single_price)             AS buy_low,
    MIN(s.optimal_combination_cost)          AS compose_low,
    MIN(
      CASE
        WHEN s.cheapest_single_price > 0 AND s.optimal_combination_cost IS NOT NULL
        THEN s.optimal_combination_cost / s.cheapest_single_price
      END
    )                                        AS compose_premium_low,
    COUNT(*)::integer                        AS snapshots
  FROM checkmath_snapshots s
  WHERE s.computed_at >= now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 90), 1), 365))
  GROUP BY 1
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION get_checkmath_daily_history(integer) TO anon, authenticated;
