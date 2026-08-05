-- supabase/migrations/050_checkmath_events.sql
-- Day markers for the Checkmath price-history chart: days on which a single
-- Check actually changed hands, or one was newly composed.
--
-- The chart's two lines are asking prices — what it would have cost. These
-- events are the other half: what someone actually did. A day where a single
-- sold well under the day's listed low says something the lines cannot.

CREATE TABLE checkmath_events (
  id          bigserial   PRIMARY KEY,
  kind        text        NOT NULL CHECK (kind IN ('sale', 'composite')),
  token_id    bigint      NOT NULL,
  occurred_at timestamptz NOT NULL,
  eth_price   double precision,  -- sales only; composites have no price
  -- Idempotency key, since both feeds are re-read on every sync and the
  -- backfill can be run repeatedly. Sales key on the transaction (one token
  -- can sell many times); composites key on the day (they're derived from a
  -- set difference and have no transaction hash to key on).
  --   sale:<tx_hash>:<token_id>   composite:<token_id>:<yyyy-mm-dd>
  event_key   text        NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkmath_events_occurred_at ON checkmath_events (occurred_at DESC);

ALTER TABLE checkmath_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read checkmath_events" ON checkmath_events FOR SELECT USING (true);

-- Which tokens are currently checks_count=1. A token appearing here that
-- wasn't here last hour was composed into a single in between — which is the
-- signal, without needing contract logs. Only ~70 rows.
--
-- Deliberately seeded below from the current state, so the first sync after
-- this migration reports nothing: without the seed, all 70 existing singles
-- would look like they were composed the same afternoon.
--
-- No SELECT policy: this is sync bookkeeping, not public data. RLS on with no
-- policy means only service_role reaches it.
CREATE TABLE checkmath_singles (
  token_id      bigint      PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE checkmath_singles ENABLE ROW LEVEL SECURITY;

INSERT INTO checkmath_singles (token_id)
SELECT token_id FROM all_checks WHERE checks_count = 1 AND is_burned = false
ON CONFLICT (token_id) DO NOTHING;

-- ── History RPC, now carrying the day's events ───────────────────────────────
-- Return type changes, so this is a DROP rather than a REPLACE. The two
-- aggregation rules from migration 049 are unchanged and still the point:
-- daily MIN, and the premium ratio computed per snapshot row before being
-- aggregated (MIN(compose)/MIN(buy) would pair different hours).
--
-- Events are LEFT JOINed onto snapshot days: the chart's x-axis comes from
-- the snapshots, so a day with an event but no snapshot has nowhere to be
-- drawn anyway.

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
  WITH win AS (
    SELECT now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 90), 1), 365)) AS since
  ),
  snaps AS (
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
    FROM checkmath_snapshots s, win
    WHERE s.computed_at >= win.since
    GROUP BY 1
  ),
  evts AS (
    SELECT
      (e.occurred_at AT TIME ZONE 'UTC')::date                     AS day,
      COUNT(*) FILTER (WHERE e.kind = 'sale')::integer             AS sales,
      MIN(e.eth_price) FILTER (WHERE e.kind = 'sale')              AS sale_low,
      COUNT(*) FILTER (WHERE e.kind = 'composite')::integer        AS composites
    FROM checkmath_events e, win
    WHERE e.occurred_at >= win.since
    GROUP BY 1
  )
  SELECT
    s.day, s.buy_low, s.compose_low, s.compose_premium_low, s.snapshots,
    COALESCE(e.sales, 0), e.sale_low, COALESCE(e.composites, 0)
  FROM snaps s
  LEFT JOIN evts e USING (day)
  ORDER BY s.day;
$$;

GRANT EXECUTE ON FUNCTION get_checkmath_daily_history(integer) TO anon, authenticated;
