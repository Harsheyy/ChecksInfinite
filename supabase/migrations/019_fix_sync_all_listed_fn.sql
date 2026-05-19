-- Migration 019: redefine sync_all_listed_permutations() in plpgsql
-- PostgREST blocks bare UPDATE (no WHERE) inside LANGUAGE sql functions.
-- plpgsql is opaque to PostgREST so the UPDATE executes without error.

CREATE OR REPLACE FUNCTION sync_all_listed_permutations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE all_permutations
  SET is_all_listed = (
    SELECT COUNT(*) = 4
    FROM all_checks
    WHERE all_checks.token_id IN (
      all_permutations.keeper_1_id, all_permutations.burner_1_id,
      all_permutations.keeper_2_id, all_permutations.burner_2_id
    )
    AND all_checks.eth_price IS NOT NULL
  );
END;
$$;
