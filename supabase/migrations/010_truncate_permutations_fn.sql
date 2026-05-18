-- Utility function called by the nightly populate-ranked-permutations script.
-- Wipes the permutations table cleanly (no dead tuples) before each refresh.
CREATE OR REPLACE FUNCTION truncate_permutations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE permutations RESTART IDENTITY;
END;
$$;
