-- supabase/migrations/054_permutations_staging_swap.sql
-- Make the nightly permutations refresh crash-safe.
--
-- Why: populate-ranked-permutations.ts truncated `permutations` and *then*
-- computed the replacement rows. On 2026-08-06 it crashed between the two
-- (one token's check_struct had no `stored` key — the edge functions write
-- `{_raw: "0x…"}` because decodeGetCheck() never decoded anything), which left
-- the table at 0 rows and the Explore feed blank until someone noticed.
--
-- The refresh now computes into a staging table and swaps only once a full run
-- has succeeded. A crash mid-run leaves yesterday's rows serving.

CREATE TABLE permutations_staging (LIKE permutations INCLUDING DEFAULTS INCLUDING IDENTITY);

-- Bookkeeping, not public data: RLS on with no policy means only service_role
-- reaches it. Readers keep hitting `permutations`, which never sees a partial
-- state.
ALTER TABLE permutations_staging ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION truncate_permutations_staging()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE TABLE permutations_staging RESTART IDENTITY;
END;
$$;

-- The swap. TRUNCATE + INSERT…SELECT inside one function body is a single
-- transaction, so readers see either the old set or the new one, never an
-- empty table or a half-written one.
--
-- Refuses to swap an empty staging table: an empty result is how the crash
-- presented, and publishing it is exactly the outcome this migration exists to
-- prevent. Returns the row count so the caller can log it.
CREATE OR REPLACE FUNCTION swap_permutations()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION truncate_permutations_staging() FROM public;
REVOKE ALL ON FUNCTION swap_permutations() FROM public;
GRANT EXECUTE ON FUNCTION truncate_permutations_staging() TO service_role;
GRANT EXECUTE ON FUNCTION swap_permutations() TO service_role;
