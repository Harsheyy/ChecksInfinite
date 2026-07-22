-- Migration 027: drop the stale 11-arg toggle_like overload
--
-- Two versions of toggle_like exist in the DB:
--   - an old 11-arg version (no struct params), left over from before the
--     k1/b1/k2/b2 struct columns were added
--   - the current 15-arg version (migration 012), which the frontend calls
--
-- Because the 4 struct params default to NULL, PostgREST cannot disambiguate a
-- call that omits them and returns HTTP 300 (PGRST203). The frontend currently
-- passes all 15 keys so it resolves to the 15-arg version — but if any struct is
-- ever undefined (supabase-js drops undefined keys), the call becomes ambiguous
-- and the like silently fails. Drop the redundant older overload so the 15-arg
-- version is the only candidate.

DROP FUNCTION IF EXISTS toggle_like(
  bigint, bigint, bigint, bigint,   -- keeper/burner ids
  text, text,                       -- wallet, source
  smallint,                         -- abcd_checks
  text, text, text, text            -- color_band, gradient, speed, shift
);
