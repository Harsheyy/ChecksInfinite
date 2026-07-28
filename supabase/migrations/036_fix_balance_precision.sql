-- supabase/migrations/036_fix_balance_precision.sql
-- Safe to re-run: DROP IF EXISTS guards the type change

DROP FUNCTION IF EXISTS get_wallet_balance(text);

-- Returns text instead of numeric — PostgREST quotes text in its JSON
-- response, so the frontend gets a numeric string (no precision loss above
-- Number.MAX_SAFE_INTEGER) instead of an unquoted JSON number that gets
-- parsed through a lossy IEEE-754 double before BigInt() ever sees it.
CREATE OR REPLACE FUNCTION get_wallet_balance(p_wallet_address text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(balance_wei, 0)::text FROM wallet_credits WHERE wallet_address = lower(p_wallet_address);
$$;
