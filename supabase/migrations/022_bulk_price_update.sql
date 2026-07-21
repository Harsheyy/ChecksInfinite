-- Migration 022: bulk price update RPC for sync-tokenstr
-- Replaces N individual UPDATE calls (one per token) with a single SQL statement,
-- reducing Supabase REST round-trips from O(N) to O(batches).
--
-- Input: array of {token_id, eth_price (null for unlisted), is_listed} objects
-- Returns: number of rows updated

CREATE OR REPLACE FUNCTION bulk_update_check_prices(
  p_updates jsonb  -- [{token_id: number, eth_price: number|null, is_listed: bool}]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE all_checks ac
  SET
    eth_price      = (u.val->>'eth_price')::float,
    is_listed      = (u.val->>'is_listed')::boolean,
    last_synced_at = now()
  FROM jsonb_array_elements(p_updates) AS u(val)
  WHERE ac.token_id = (u.val->>'token_id')::bigint;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
