-- 1. Sweep counts: how many tokens actually went into each sweep sum.
--    Editions won't always have 64 listed on OpenSea, so the raw ETH total
--    alone can misleadingly look like a full 64-token sweep when it isn't.
ALTER TABLE checkmath_snapshots
  ADD COLUMN checks_sweep_count   integer,
  ADD COLUMN editions_sweep_count integer;

-- 2. Bulk SVG-backfill RPC for backend/scripts/backfill-market-svg.ts — same
-- batched-update shape as bulk_update_check_prices (022) and
-- bulk_update_editions_prices (042).
CREATE OR REPLACE FUNCTION bulk_update_check_svg(
  p_updates jsonb  -- [{token_id: number, svg: string}]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE all_checks ac
  SET svg = (u.val->>'svg')
  FROM jsonb_array_elements(p_updates) AS u(val)
  WHERE ac.token_id = (u.val->>'token_id')::bigint;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION bulk_update_check_svg(jsonb) FROM PUBLIC, anon, authenticated;
