-- supabase/migrations/042_editions_checks.sql
-- New table for the Checks Editions collection (contract
-- 0x34eebee6942d8def3c125458d1a86e0a897fd6f9), a separate, non-mergeable
-- collection this repo hasn't tracked before. Needed for the Checkmath
-- rebuild's "sweep 64 editions" comparison.

CREATE TABLE editions_checks (
  token_id        bigint      PRIMARY KEY,
  eth_price       float,                      -- null when unlisted
  is_listed       boolean     NOT NULL DEFAULT false,
  image_url       text,
  last_synced_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_editions_checks_is_listed ON editions_checks (is_listed);

ALTER TABLE editions_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read editions_checks" ON editions_checks FOR SELECT USING (true);

-- Same shape as bulk_update_check_prices (migration 022), for editions_checks.
CREATE OR REPLACE FUNCTION bulk_update_editions_prices(
  p_updates jsonb  -- [{token_id: number, eth_price: number|null, is_listed: bool}]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE editions_checks ec
  SET
    eth_price      = (u.val->>'eth_price')::float,
    is_listed      = (u.val->>'is_listed')::boolean,
    last_synced_at = now()
  FROM jsonb_array_elements(p_updates) AS u(val)
  WHERE ec.token_id = (u.val->>'token_id')::bigint;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
