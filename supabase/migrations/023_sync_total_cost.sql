-- Migration 023: upgrade sync_all_listed_permutations to also refresh total_cost.
-- Uses a JOIN-based UPDATE so prices from all_checks are read once per row (efficient
-- across 250K rows) rather than a correlated subquery per column.

CREATE OR REPLACE FUNCTION sync_all_listed_permutations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE all_permutations ap
  SET
    is_all_listed = (
      k1.eth_price IS NOT NULL AND
      b1.eth_price IS NOT NULL AND
      k2.eth_price IS NOT NULL AND
      b2.eth_price IS NOT NULL
    ),
    total_cost = CASE
      WHEN k1.eth_price IS NOT NULL AND b1.eth_price IS NOT NULL AND
           k2.eth_price IS NOT NULL AND b2.eth_price IS NOT NULL
      THEN k1.eth_price + b1.eth_price + k2.eth_price + b2.eth_price
      ELSE NULL
    END
  FROM
    all_checks k1,
    all_checks b1,
    all_checks k2,
    all_checks b2
  WHERE k1.token_id = ap.keeper_1_id
    AND b1.token_id = ap.burner_1_id
    AND k2.token_id = ap.keeper_2_id
    AND b2.token_id = ap.burner_2_id;
END;
$$;
