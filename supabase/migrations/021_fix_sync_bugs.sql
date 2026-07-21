-- Migration 021: fix sync bugs
--
-- 1. Backfill is_tokenstr = true for tokens already tracked by sync-tokenstr.
--    Tokens inserted before the is_tokenstr flag was set correctly have
--    is_tokenstr = false (default), causing sync-market-prices to overwrite
--    their contract prices with OpenSea data (or clear them as unlisted).
--
--    Heuristic: any token with price_source = 'contract' is definitely tokenstr.
--    Tokens inserted before price_source existed have price_source = NULL and
--    is_tokenstr = false — we can't safely backfill those without knowing which
--    wallet they're in. Run sync-tokenstr manually after deploying to pick them up.

UPDATE all_checks
SET is_tokenstr = true
WHERE price_source = 'contract'
  AND is_tokenstr = false;

-- 2. Sync is_listed for all tokens to match eth_price reality.
--    is_listed may be stale from before the column was being set correctly.

UPDATE all_checks
SET is_listed = (eth_price IS NOT NULL);

-- 3. Re-sync is_all_listed on all_permutations.

SELECT sync_all_listed_permutations();
