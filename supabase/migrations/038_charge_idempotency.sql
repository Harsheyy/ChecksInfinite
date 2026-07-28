-- supabase/migrations/038_charge_idempotency.sql
-- Safe to re-run: ADD COLUMN IF NOT EXISTS / DROP+CREATE guards throughout
--
-- Fix 5: charge_credits has no idempotency protection. If the client never
-- receives the RPC response (network drop, timeout) after a charge
-- succeeded server-side, the client shows a charge-failed error and a user
-- retry produces a real second charge. An idempotency key scoped to one
-- logical charge attempt lets a retry-of-the-same-attempt replay the
-- original result instead of charging twice.
--
-- Fix 6: get_wallet_balance returns NULL (no row) for a wallet that has
-- never been funded, so Navbar hides the balance chip entirely for
-- never-funded wallets — contradicting the "always visible before a charge
-- can happen" requirement. Make it always return '0' instead.

-- ── Fix 5: idempotency columns + constraint ─────────────────────────────────

ALTER TABLE credit_charges ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE credit_charges ADD COLUMN IF NOT EXISTS resulting_balance_wei text;

-- Partial unique index: charges without a key (if any legacy path exists)
-- are unaffected; a given key can produce at most one successful charge row
-- per wallet.
CREATE UNIQUE INDEX IF NOT EXISTS credit_charges_wallet_idempotency_key_idx
  ON credit_charges (wallet_address, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS charge_credits(text, text, text);

CREATE OR REPLACE FUNCTION charge_credits(
  p_wallet_address    text,
  p_action_type       text,
  p_session_token     text,
  p_idempotency_key   text DEFAULT NULL
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
  v_replay_balance text;
BEGIN
  -- Idempotent replay: if this exact (wallet, key) already produced a
  -- successful charge, return that recorded result rather than charging
  -- again. Checked before the session check — the original attempt already
  -- proved session validity and completed the charge; a replay shouldn't
  -- fail just because the session token has since expired.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT resulting_balance_wei INTO v_replay_balance
    FROM credit_charges
    WHERE wallet_address = lower(p_wallet_address)
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN QUERY SELECT true, v_replay_balance, 'ok'::text;
      RETURN;
    END IF;
  END IF;

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

  INSERT INTO credit_charges (wallet_address, action_type, amount_wei, idempotency_key, resulting_balance_wei)
  VALUES (lower(p_wallet_address), p_action_type, v_price, p_idempotency_key, v_new_balance::text);

  RETURN QUERY SELECT true, v_new_balance::text, 'ok'::text;
END;
$$;

-- ── Fix 6: never-funded wallets should still show a 0 balance chip ─────────
-- Return type (text) is unchanged from 036_fix_balance_precision.sql, only
-- the body logic changes (NULL row -> literal '0' via COALESCE on the
-- already-COALESCE'd numeric before the ::text cast), so CREATE OR REPLACE
-- is safe without a DROP.

CREATE OR REPLACE FUNCTION get_wallet_balance(p_wallet_address text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT balance_wei FROM wallet_credits WHERE wallet_address = lower(p_wallet_address)), 0)::text;
$$;
