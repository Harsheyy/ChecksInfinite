-- supabase/migrations/037_fix_charge_credits_precision.sql
-- Safe to re-run: DROP IF EXISTS guards the return-type change
--
-- Same issue as 036_fix_balance_precision.sql: charge_credits' new_balance_wei
-- column was `numeric`, which PostgREST serializes as an unquoted JSON number
-- and which JS then parses through a lossy IEEE-754 double before BigInt()
-- ever sees it — losing precision above Number.MAX_SAFE_INTEGER (~0.009 ETH).
-- Cast to text so the frontend gets an exact numeric string instead.

DROP FUNCTION IF EXISTS charge_credits(text, text, text);

CREATE OR REPLACE FUNCTION charge_credits(
  p_wallet_address text,
  p_action_type    text,
  p_session_token  text
)
RETURNS TABLE (success boolean, new_balance_wei text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price       numeric;
  v_new_balance numeric;
  v_session_ok  boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM wallet_sessions
    WHERE session_token = p_session_token
      AND wallet_address = lower(p_wallet_address)
      AND expires_at > now()
  ) INTO v_session_ok;

  IF NOT v_session_ok THEN
    RETURN QUERY SELECT false, NULL::text, 'invalid_session'::text;
    RETURN;
  END IF;

  SELECT price_wei INTO v_price FROM pricing_config WHERE action_type = p_action_type;
  IF v_price IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'unknown_action_type'::text;
    RETURN;
  END IF;

  UPDATE wallet_credits
  SET balance_wei = balance_wei - v_price, updated_at = now()
  WHERE wallet_address = lower(p_wallet_address) AND balance_wei >= v_price
  RETURNING balance_wei INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      COALESCE((SELECT balance_wei FROM wallet_credits WHERE wallet_address = lower(p_wallet_address)), 0)::text,
      'insufficient_balance'::text;
    RETURN;
  END IF;

  INSERT INTO credit_charges (wallet_address, action_type, amount_wei)
  VALUES (lower(p_wallet_address), p_action_type, v_price);

  RETURN QUERY SELECT true, v_new_balance::text, 'ok'::text;
END;
$$;
