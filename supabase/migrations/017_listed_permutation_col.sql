-- Migration 017: is_all_listed column on all_permutations
-- Tracks whether every child token in a permutation is currently listed on the market,
-- so the OpenSea feed can filter to purchasable-right-now combos.

ALTER TABLE all_permutations
  ADD COLUMN IF NOT EXISTS is_all_listed BOOLEAN NOT NULL DEFAULT false;

-- Partial index: efficient sorted scan for the OpenSea feed
-- (abcd_checks ASC = rarest first among listed permutations)
CREATE INDEX IF NOT EXISTS idx_all_perm_listed_band
  ON all_permutations(abcd_checks)
  WHERE is_all_listed = true;

-- Sync function — called by the price backfill script after each run.
-- Uses correlated subqueries so missing all_checks rows are treated as unlisted (NULL → false).
CREATE OR REPLACE FUNCTION sync_all_listed_permutations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE all_permutations p
  SET is_all_listed = (
    (SELECT eth_price FROM all_checks WHERE token_id = p.keeper_1_id LIMIT 1) IS NOT NULL AND
    (SELECT eth_price FROM all_checks WHERE token_id = p.burner_1_id LIMIT 1) IS NOT NULL AND
    (SELECT eth_price FROM all_checks WHERE token_id = p.keeper_2_id LIMIT 1) IS NOT NULL AND
    (SELECT eth_price FROM all_checks WHERE token_id = p.burner_2_id LIMIT 1) IS NOT NULL
  );
$$;

-- Initial backfill of existing rows
SELECT sync_all_listed_permutations();
