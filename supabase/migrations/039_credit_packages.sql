-- supabase/migrations/039_credit_packages.sql
-- Safe to re-run: ADD/RENAME COLUMN IF EXISTS-style guards, DROP+CREATE for functions
--
-- Pivots the credit system from a continuous ETH (wei) balance to a discrete
-- credit count, funded via fixed USD packages ($10/$25/$50 -> 10/25/50
-- credits) rather than an arbitrary top-up. Since payment is still in ETH,
-- credits-webhook converts incoming ETH to a USD value using a live
-- Chainlink ETH/USD price feed (read via eth_call, same RPC pattern already
-- used elsewhere in this app) and matches it against a known package amount
-- — the oracle read happens once at deposit time, not per-charge, so
-- charge_credits stays simple arithmetic with no oracle dependency on the
-- hot path.
--
-- Pricing: search_query = 1 credit ($1), recipe_view = 0.5 credit ($0.50).
-- At these magnitudes (max realistic balance ~50, priced in increments of
-- 0.5) there's no JS float-precision concern the way wei amounts had —
-- balances/prices are returned as plain numeric, no more text-casting.

-- ── Packages ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing_packages (
  usd_amount numeric PRIMARY KEY,
  credits    numeric NOT NULL
);

INSERT INTO pricing_packages (usd_amount, credits) VALUES
  (10, 10),
  (25, 25),
  (50, 50)
ON CONFLICT (usd_amount) DO UPDATE SET credits = EXCLUDED.credits;

ALTER TABLE pricing_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_packages_read ON pricing_packages FOR SELECT USING (true);

-- ── Rename wei-denominated columns to credit-denominated ────────────────────

ALTER TABLE wallet_credits  RENAME COLUMN balance_wei TO balance_credits;
ALTER TABLE credit_charges  RENAME COLUMN amount_wei TO amount_credits;
ALTER TABLE credit_charges  RENAME COLUMN resulting_balance_wei TO resulting_balance_credits;
ALTER TABLE pricing_config  RENAME COLUMN price_wei TO price_credits;

-- Re-seed pricing_config with credit amounts instead of wei amounts.
UPDATE pricing_config SET price_credits = 1   WHERE action_type = 'search_query';
UPDATE pricing_config SET price_credits = 0.5 WHERE action_type = 'recipe_view';

-- ── RPCs, recreated against the renamed/credit-denominated columns ─────────

DROP FUNCTION IF EXISTS get_wallet_balance(text);
CREATE OR REPLACE FUNCTION get_wallet_balance(p_wallet_address text)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT balance_credits FROM wallet_credits WHERE wallet_address = lower(p_wallet_address)), 0);
$$;

-- credit_wallet_from_transfer now takes a credit amount directly (already
-- matched against a known package by credits-webhook) instead of a wei
-- amount — the ETH->USD->package conversion happens in the edge function,
-- not here, so this stays a simple atomic add + idempotency dedup.
DROP FUNCTION IF EXISTS credit_wallet_from_transfer(text, numeric, text);
CREATE OR REPLACE FUNCTION credit_wallet_from_transfer(
  p_wallet_address text,
  p_credits        numeric,
  p_tx_hash        text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
  v_inserted    int;
BEGIN
  INSERT INTO credited_transfers (tx_hash) VALUES (p_tx_hash)
  ON CONFLICT (tx_hash) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN COALESCE((SELECT balance_credits FROM wallet_credits WHERE wallet_address = lower(p_wallet_address)), 0);
  END IF;

  INSERT INTO wallet_credits (wallet_address, balance_credits, updated_at)
  VALUES (lower(p_wallet_address), p_credits, now())
  ON CONFLICT (wallet_address)
  DO UPDATE SET balance_credits = wallet_credits.balance_credits + EXCLUDED.balance_credits, updated_at = now()
  RETURNING balance_credits INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;
REVOKE EXECUTE ON FUNCTION credit_wallet_from_transfer(text, numeric, text) FROM PUBLIC, anon, authenticated;

-- credit_wallet (the old 2-arg wei version) is fully superseded — drop it,
-- nothing calls it anymore (credits-webhook was already updated to call
-- credit_wallet_from_transfer back in migration 035).
DROP FUNCTION IF EXISTS credit_wallet(text, numeric);

DROP FUNCTION IF EXISTS charge_credits(text, text, text, text);
CREATE OR REPLACE FUNCTION charge_credits(
  p_wallet_address    text,
  p_action_type       text,
  p_session_token     text,
  p_idempotency_key   text DEFAULT NULL
)
RETURNS TABLE (success boolean, new_balance numeric, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price          numeric;
  v_new_balance    numeric;
  v_session_ok     boolean;
  v_replay_balance numeric;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT resulting_balance_credits INTO v_replay_balance
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
    RETURN QUERY SELECT false, NULL::numeric, 'invalid_session'::text;
    RETURN;
  END IF;

  SELECT price_credits INTO v_price FROM pricing_config WHERE action_type = p_action_type;
  IF v_price IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'unknown_action_type'::text;
    RETURN;
  END IF;

  UPDATE wallet_credits
  SET balance_credits = balance_credits - v_price, updated_at = now()
  WHERE wallet_address = lower(p_wallet_address) AND balance_credits >= v_price
  RETURNING balance_credits INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      COALESCE((SELECT balance_credits FROM wallet_credits WHERE wallet_address = lower(p_wallet_address)), 0),
      'insufficient_balance'::text;
    RETURN;
  END IF;

  INSERT INTO credit_charges (wallet_address, action_type, amount_credits, idempotency_key, resulting_balance_credits)
  VALUES (lower(p_wallet_address), p_action_type, v_price, p_idempotency_key, v_new_balance);

  RETURN QUERY SELECT true, v_new_balance, 'ok'::text;
END;
$$;
