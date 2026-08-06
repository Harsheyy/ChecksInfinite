-- supabase/migrations/053_checkmath_daily_rollup.sql
-- Persist the daily price history instead of re-deriving it from the hourly
-- snapshots on every page load.
--
-- Why a rollup table rather than flushing the hourly table nightly (the
-- obvious alternative): row count was never the problem — hourly sync is
-- ~8,760 rows/year, which Postgres does not notice. The bulk is
-- checkmath_snapshots.optimal_combination, a 10-30 item jsonb basket written
-- every hour; that is trimmed below instead. Deleting the raw rows would make
-- every past day permanently un-recomputable, and would force the chart to
-- stitch two sources together at the day boundary.
--
-- So: checkmath_snapshots stays append-only forever and remains the source of
-- truth. checkmath_daily is a derived cache that can be rebuilt from it at any
-- time by re-running rollup_checkmath_day() over the range.

CREATE TABLE checkmath_daily (
  day                 date PRIMARY KEY,
  buy_low             double precision,
  compose_low         double precision,
  compose_premium_low double precision,
  snapshots           integer     NOT NULL DEFAULT 0,
  sales               integer     NOT NULL DEFAULT 0,
  sale_low            double precision,
  composites          integer     NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checkmath_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read checkmath_daily" ON checkmath_daily FOR SELECT USING (true);

-- ── The rollup ───────────────────────────────────────────────────────────────
-- The two aggregation rules from migrations 049 and 050 move here unchanged,
-- and this is now the only place they exist:
--
--   Rule 1 — daily MIN, not avg and not last-of-day. The page answers "what's
--   the cheapest way to own a Check," so each point answers "what was the best
--   price available that day." A last-of-day sample would swing on whatever
--   happened to be listed at 23:30.
--
--   Rule 2 — the premium ratio is computed PER SNAPSHOT ROW and then
--   aggregated, never by dividing the two aggregated minima.
--   MIN(compose)/MIN(buy) can pair numbers from two different hours and would
--   describe a gap that never existed at any single moment.
--
-- SECURITY DEFINER because the nightly cron runs as the cron role, which has
-- no direct grant on the snapshot tables. Only ever called with a date.
CREATE OR REPLACE FUNCTION rollup_checkmath_day(p_day date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO checkmath_daily AS d (
    day, buy_low, compose_low, compose_premium_low, snapshots,
    sales, sale_low, composites, updated_at
  )
  SELECT
    p_day,
    s.buy_low,
    s.compose_low,
    s.compose_premium_low,
    COALESCE(s.snapshots, 0),
    COALESCE(e.sales, 0),
    e.sale_low,
    COALESCE(e.composites, 0),
    now()
  FROM (
    SELECT
      MIN(cheapest_single_price)    AS buy_low,
      MIN(optimal_combination_cost) AS compose_low,
      MIN(
        CASE
          WHEN cheapest_single_price > 0 AND optimal_combination_cost IS NOT NULL
          THEN optimal_combination_cost / cheapest_single_price
        END
      )                             AS compose_premium_low,
      COUNT(*)::integer             AS snapshots
    FROM checkmath_snapshots
    WHERE (computed_at AT TIME ZONE 'UTC')::date = p_day
  ) s
  LEFT JOIN (
    SELECT
      COUNT(*) FILTER (WHERE kind = 'sale')::integer      AS sales,
      MIN(eth_price) FILTER (WHERE kind = 'sale')         AS sale_low,
      COUNT(*) FILTER (WHERE kind = 'composite')::integer AS composites
    FROM checkmath_events
    WHERE (occurred_at AT TIME ZONE 'UTC')::date = p_day
  ) e ON true
  -- A day with no snapshots has no x-position on the chart, so it is not
  -- worth a row even if events landed on it.
  WHERE COALESCE(s.snapshots, 0) > 0
  ON CONFLICT (day) DO UPDATE SET
    buy_low             = EXCLUDED.buy_low,
    compose_low         = EXCLUDED.compose_low,
    compose_premium_low = EXCLUDED.compose_premium_low,
    snapshots           = EXCLUDED.snapshots,
    sales               = EXCLUDED.sales,
    sale_low            = EXCLUDED.sale_low,
    composites          = EXCLUDED.composites,
    updated_at          = now();
$$;

REVOKE ALL ON FUNCTION rollup_checkmath_day(date) FROM public;
GRANT EXECUTE ON FUNCTION rollup_checkmath_day(date) TO service_role;

-- ── Backfill every day already in the snapshots ──────────────────────────────
DO $$
DECLARE d date;
BEGIN
  FOR d IN
    SELECT DISTINCT (computed_at AT TIME ZONE 'UTC')::date
    FROM checkmath_snapshots
    ORDER BY 1
  LOOP
    PERFORM rollup_checkmath_day(d);
  END LOOP;
END $$;

-- ── Read path ────────────────────────────────────────────────────────────────
-- Same signature and same column list as migration 050, so useCheckmathHistory
-- is untouched. It now reads one indexed row per day instead of aggregating
-- ~2,160 snapshot rows on every page load.

DROP FUNCTION IF EXISTS get_checkmath_daily_history(integer);

CREATE FUNCTION get_checkmath_daily_history(p_days integer DEFAULT 90)
RETURNS TABLE (
  day                 date,
  buy_low             double precision,
  compose_low         double precision,
  compose_premium_low double precision,
  snapshots           integer,
  sales               integer,
  sale_low            double precision,
  composites          integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.day, d.buy_low, d.compose_low, d.compose_premium_low, d.snapshots,
    d.sales, d.sale_low, d.composites
  FROM checkmath_daily d
  WHERE d.day >= (now() AT TIME ZONE 'UTC')::date
                 - LEAST(GREATEST(COALESCE(p_days, 90), 1), 365)
  ORDER BY d.day;
$$;

GRANT EXECUTE ON FUNCTION get_checkmath_daily_history(integer) TO anon, authenticated;

-- ── Nightly maintenance ──────────────────────────────────────────────────────
-- Re-roll yesterday once more at 00:35 UTC. The sync job rolls up the current
-- day on every run, so yesterday is almost always already correct — this
-- exists so a failed 23:30 sync doesn't leave a day permanently short of its
-- last hours. Also trims the jsonb baskets, which are ~95% of the table's
-- bytes and are read only for the current snapshot.
CREATE OR REPLACE FUNCTION checkmath_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM rollup_checkmath_day(((now() AT TIME ZONE 'UTC')::date - 1));

  UPDATE checkmath_snapshots
  SET optimal_combination = NULL
  WHERE computed_at < now() - interval '7 days'
    AND optimal_combination IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION checkmath_nightly_maintenance() FROM public;
GRANT EXECUTE ON FUNCTION checkmath_nightly_maintenance() TO service_role;

-- To remove:  SELECT cron.unschedule('checkmath-nightly');
SELECT cron.schedule(
  'checkmath-nightly',
  '35 0 * * *',
  $$ SELECT checkmath_nightly_maintenance(); $$
);
