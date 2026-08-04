-- supabase/migrations/044_checkmath_snapshots.sql
-- Hourly snapshots of the Checkmath calculation results, so a price-history
-- chart can be built later without a schema change. Written only by the
-- sync-checkmath edge function (service_role) — no anon/authenticated write
-- policy.

CREATE TABLE checkmath_snapshots (
  id                        bigserial   PRIMARY KEY,
  computed_at               timestamptz NOT NULL DEFAULT now(),
  cheapest_single_price     float,      -- null if no checks_count=1 token is listed
  cheapest_single_token_id  bigint,
  optimal_combination_cost  float,      -- null if not enough supply to reach 64 weight-units
  optimal_combination       jsonb,      -- {items: [{tokenId, checksCount, ethPrice}, ...]}
  checks_sweep_cost         float,      -- sum of the cheapest listed Checks VV tokens, up to 64
  editions_sweep_cost       float       -- sum of the cheapest listed Editions tokens, up to 64
);

CREATE INDEX idx_checkmath_snapshots_computed_at ON checkmath_snapshots (computed_at DESC);

ALTER TABLE checkmath_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read checkmath_snapshots" ON checkmath_snapshots FOR SELECT USING (true);
