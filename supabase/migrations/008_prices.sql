-- Add per-check price column
ALTER TABLE tokenstr_checks
  ADD COLUMN IF NOT EXISTS eth_price FLOAT;

-- Add denormalized total cost for all 4 leaf checks
ALTER TABLE permutations
  ADD COLUMN IF NOT EXISTS total_cost FLOAT;

-- Index for range queries on cost
CREATE INDEX IF NOT EXISTS permutations_total_cost_idx ON permutations (total_cost);

-- Helper: re-sync total_cost for all permutations involving a given token
CREATE OR REPLACE FUNCTION update_permutation_costs(p_token_id integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE permutations p
  SET total_cost =
    tc1.eth_price + tc2.eth_price + tc3.eth_price + tc4.eth_price
  FROM
    tokenstr_checks tc1,
    tokenstr_checks tc2,
    tokenstr_checks tc3,
    tokenstr_checks tc4
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

-- Helper: backfill total_cost for all permutations at once (used by backfill script)
CREATE OR REPLACE FUNCTION backfill_permutation_costs()
RETURNS integer LANGUAGE sql AS $$
  UPDATE permutations p
  SET total_cost =
    tc1.eth_price + tc2.eth_price + tc3.eth_price + tc4.eth_price
  FROM
    tokenstr_checks tc1,
    tokenstr_checks tc2,
    tokenstr_checks tc3,
    tokenstr_checks tc4
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
