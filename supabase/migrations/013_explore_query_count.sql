-- supabase/migrations/013_explore_query_count.sql
-- Adds explore_query_count to connected_wallets to track per-wallet explore searches.

ALTER TABLE connected_wallets
  ADD COLUMN IF NOT EXISTS explore_query_count integer NOT NULL DEFAULT 0;

-- ── RPC ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_explore_query(p_address text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO connected_wallets (address, explore_query_count)
  VALUES (p_address, 1)
  ON CONFLICT (address) DO UPDATE
    SET explore_query_count = connected_wallets.explore_query_count + 1,
        last_seen = now();
$$;
