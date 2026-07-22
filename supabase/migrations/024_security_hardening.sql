-- Migration 024: security hardening before going public
--
-- 1. Revoke anon/authenticated EXECUTE on internal admin RPCs.
--    Supabase grants EXECUTE to PUBLIC on every function in the public schema
--    by default, and exposes them all via PostgREST (/rest/v1/rpc/<name>).
--    These functions are SECURITY DEFINER and must only be callable by
--    service_role (edge functions + backend scripts), never the anon key.
--
-- 2. Add CHECK constraints validating data written through the public RPCs
--    (toggle_like, log_wallet_connect, log_explore_query). Constraints are
--    used instead of rewriting the functions because they cover every write
--    path and don't risk clobbering function bodies that were edited in prod.
--    NOT VALID = existing rows are not re-checked; only new writes.

-- ── 1. Lock down admin RPCs ───────────────────────────────────────────────────
-- service_role bypasses these revokes, so edge functions and the nightly
-- GitHub Actions scripts (which use the service key) keep working.

REVOKE EXECUTE ON FUNCTION truncate_permutations()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION truncate_all_permutations()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION bulk_update_check_prices(jsonb)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_all_listed_permutations()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_permutation_costs(integer)      FROM PUBLIC, anon, authenticated;

-- ── 2. Validate wallet addresses on all spam-facing tables ───────────────────
-- Frontend always lowercases addresses before calling RPCs, so the strict
-- lowercase pattern is correct for new writes.

ALTER TABLE curated_likes
  DROP CONSTRAINT IF EXISTS curated_likes_wallet_format;
ALTER TABLE curated_likes
  ADD CONSTRAINT curated_likes_wallet_format
  CHECK (wallet_address ~ '^0x[0-9a-f]{40}$') NOT VALID;

ALTER TABLE connected_wallets
  DROP CONSTRAINT IF EXISTS connected_wallets_address_format;
ALTER TABLE connected_wallets
  ADD CONSTRAINT connected_wallets_address_format
  CHECK (address ~ '^0x[0-9a-f]{40}$') NOT VALID;

-- ── 3. Sanity-bound curated_outputs writes (toggle_like is anon-callable) ────
-- Token IDs must be plausible Checks VV ids; attribute strings must be short;
-- struct jsonb payloads are capped so nobody can stuff megabytes per row.

ALTER TABLE curated_outputs
  DROP CONSTRAINT IF EXISTS curated_outputs_token_range;
ALTER TABLE curated_outputs
  ADD CONSTRAINT curated_outputs_token_range
  CHECK (
    keeper_1_id BETWEEN 1 AND 1000000 AND
    burner_1_id BETWEEN 1 AND 1000000 AND
    keeper_2_id BETWEEN 1 AND 1000000 AND
    burner_2_id BETWEEN 1 AND 1000000
  ) NOT VALID;

ALTER TABLE curated_outputs
  DROP CONSTRAINT IF EXISTS curated_outputs_attr_length;
ALTER TABLE curated_outputs
  ADD CONSTRAINT curated_outputs_attr_length
  CHECK (
    char_length(abcd_color_band) <= 32 AND
    char_length(abcd_gradient)   <= 32 AND
    char_length(abcd_speed)      <= 32 AND
    (abcd_shift IS NULL OR char_length(abcd_shift) <= 32)
  ) NOT VALID;

ALTER TABLE curated_outputs
  DROP CONSTRAINT IF EXISTS curated_outputs_struct_size;
ALTER TABLE curated_outputs
  ADD CONSTRAINT curated_outputs_struct_size
  CHECK (
    (k1_struct IS NULL OR pg_column_size(k1_struct) <= 16384) AND
    (b1_struct IS NULL OR pg_column_size(b1_struct) <= 16384) AND
    (k2_struct IS NULL OR pg_column_size(k2_struct) <= 16384) AND
    (b2_struct IS NULL OR pg_column_size(b2_struct) <= 16384)
  ) NOT VALID;

-- ── Optional (commented out): safe-by-default for FUTURE functions ───────────
-- Uncomment to make every function created from now on private by default.
-- After enabling, any new public-facing RPC needs an explicit:
--   GRANT EXECUTE ON FUNCTION my_new_rpc(...) TO anon;
--
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
