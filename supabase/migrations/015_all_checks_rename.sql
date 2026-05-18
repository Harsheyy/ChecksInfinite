-- supabase/migrations/015_all_checks_rename.sql
-- Rename tokenstr_checks → all_checks.
-- FK constraints follow the rename automatically (PostgreSQL tracks by OID).
-- BUT stored SQL function bodies reference the old name by string — recreate them below.

ALTER TABLE tokenstr_checks RENAME TO all_checks;

-- ── New columns ───────────────────────────────────────────────────────────────
ALTER TABLE all_checks
  ADD COLUMN is_tokenstr  boolean NOT NULL DEFAULT false,
  ADD COLUMN price_source text,        -- 'contract' | 'opensea' | 'blur'
  ADD COLUMN is_listed    boolean NOT NULL DEFAULT false;

-- Backfill: mark the existing tokenstr rows
UPDATE all_checks SET is_tokenstr = true, price_source = 'contract';

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_all_checks_is_tokenstr ON all_checks (is_tokenstr) WHERE NOT is_burned;
CREATE INDEX idx_all_checks_is_listed   ON all_checks (is_listed)   WHERE NOT is_burned;

-- ── Recreate SQL functions whose bodies reference tokenstr_checks by name ─────
-- PostgreSQL resolves table names in function bodies at execution time, not
-- definition time. Renaming the table does NOT update stored function bodies.

-- update_permutation_costs (originally from 008_prices.sql)
CREATE OR REPLACE FUNCTION update_permutation_costs(p_token_id integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE permutations p
  SET total_cost =
    tc1.eth_price + tc2.eth_price + tc3.eth_price + tc4.eth_price
  FROM
    all_checks tc1, all_checks tc2, all_checks tc3, all_checks tc4
  WHERE
    tc1.token_id = p.keeper_1_id AND
    tc2.token_id = p.burner_1_id AND
    tc3.token_id = p.keeper_2_id AND
    tc4.token_id = p.burner_2_id AND
    tc1.eth_price IS NOT NULL AND
    tc2.eth_price IS NOT NULL AND
    tc3.eth_price IS NOT NULL AND
    tc4.eth_price IS NOT NULL AND
    (
      p.keeper_1_id = p_token_id OR
      p.burner_1_id = p_token_id OR
      p.keeper_2_id = p_token_id OR
      p.burner_2_id = p_token_id
    );
$$;

-- backfill_permutation_costs (originally from 008_prices.sql)
CREATE OR REPLACE FUNCTION backfill_permutation_costs()
RETURNS integer LANGUAGE sql AS $$
  UPDATE permutations p
  SET total_cost =
    tc1.eth_price + tc2.eth_price + tc3.eth_price + tc4.eth_price
  FROM
    all_checks tc1, all_checks tc2, all_checks tc3, all_checks tc4
  WHERE
    tc1.token_id = p.keeper_1_id AND
    tc2.token_id = p.burner_1_id AND
    tc3.token_id = p.keeper_2_id AND
    tc4.token_id = p.burner_2_id AND
    tc1.eth_price IS NOT NULL AND
    tc2.eth_price IS NOT NULL AND
    tc3.eth_price IS NOT NULL AND
    tc4.eth_price IS NOT NULL;

  SELECT count(*)::integer FROM permutations WHERE total_cost IS NOT NULL;
$$;
