-- supabase/migrations/055_swap_permutations_timeout.sql
-- Give swap_permutations() room to copy a full result set.
--
-- Repairing the 100 undecoded check_structs took the eligible token count from
-- 12 to 23, which takes the nightly result from 11,880 rows to the 100,000-row
-- MAX_TOTAL cap. The TRUNCATE + INSERT…SELECT then exceeded the default
-- statement timeout and the swap rolled back — correctly leaving the previous
-- set live, but never publishing the new one.
--
-- The timeout belongs on this function rather than raised globally: this is the
-- one statement in the system that is expected to move six figures of rows, and
-- everything else should still fail fast.

CREATE OR REPLACE FUNCTION swap_permutations()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM permutations_staging;

  IF n = 0 THEN
    RAISE EXCEPTION 'swap_permutations: staging is empty, refusing to publish an empty feed';
  END IF;

  TRUNCATE TABLE permutations RESTART IDENTITY;
  INSERT INTO permutations SELECT * FROM permutations_staging;
  TRUNCATE TABLE permutations_staging RESTART IDENTITY;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION swap_permutations() FROM public;
GRANT EXECUTE ON FUNCTION swap_permutations() TO service_role;
