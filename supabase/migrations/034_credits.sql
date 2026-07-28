-- supabase/migrations/034_credits.sql
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout

-- ── Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_credits (
  wallet_address text        PRIMARY KEY,
  balance_wei    numeric     NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_charges (
  id            bigserial   PRIMARY KEY,
  wallet_address text       NOT NULL,
  action_type   text        NOT NULL CHECK (action_type IN ('search_query', 'recipe_view')),
  amount_wei    numeric     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_charges_wallet_idx ON credit_charges(wallet_address);

CREATE TABLE IF NOT EXISTS pricing_config (
  action_type text    PRIMARY KEY CHECK (action_type IN ('search_query', 'recipe_view')),
  price_wei   numeric NOT NULL
);

INSERT INTO pricing_config (action_type, price_wei) VALUES
  ('search_query', 500000000000000),
  ('recipe_view',  200000000000000)
ON CONFLICT (action_type) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE wallet_credits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_charges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_config  ENABLE ROW LEVEL SECURITY;

-- Prices are public information (not sensitive), safe to read directly.
CREATE POLICY pricing_config_read ON pricing_config FOR SELECT USING (true);

-- ── RPCs ──────────────────────────────────────────────────────────────────

-- Public read: a wallet's own credit balance isn't sensitive (comparable to
-- an on-chain balance being public), so no session check needed to read it.
CREATE OR REPLACE FUNCTION get_wallet_balance(p_wallet_address text)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(balance_wei, 0) FROM wallet_credits WHERE wallet_address = lower(p_wallet_address);
$$;

-- Atomic credit — only ever called by credits-webhook via the service-role
-- key, which bypasses this REVOKE, so it stays safe even though the
-- function itself has no other authorization check.
CREATE OR REPLACE FUNCTION credit_wallet(p_wallet_address text, p_amount_wei numeric)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO wallet_credits (wallet_address, balance_wei, updated_at)
  VALUES (lower(p_wallet_address), p_amount_wei, now())
  ON CONFLICT (wallet_address)
  DO UPDATE SET balance_wei = wallet_credits.balance_wei + EXCLUDED.balance_wei, updated_at = now()
  RETURNING balance_wei;
$$;
REVOKE EXECUTE ON FUNCTION credit_wallet(text, numeric) FROM PUBLIC, anon, authenticated;

-- Spend: requires a live wallet_sessions row proving the caller controls
-- p_wallet_address (see wallet_sessions, migration 033) — a client-supplied
-- address with no matching session is rejected before any balance check.
-- Atomic UPDATE...WHERE...RETURNING (same race-safe shape as toggle_like's
-- delete-first + ROW_COUNT pattern in 011_curated_outputs.sql) prevents
-- double-spend from concurrent requests.
CREATE OR REPLACE FUNCTION charge_credits(
  p_wallet_address text,
  p_action_type    text,
  p_session_token  text
)
RETURNS TABLE (success boolean, new_balance_wei numeric, message text)
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
    RETURN QUERY SELECT false, NULL::numeric, 'invalid_session'::text;
    RETURN;
  END IF;

  SELECT price_wei INTO v_price FROM pricing_config WHERE action_type = p_action_type;
  IF v_price IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'unknown_action_type'::text;
    RETURN;
  END IF;

  UPDATE wallet_credits
  SET balance_wei = balance_wei - v_price, updated_at = now()
  WHERE wallet_address = lower(p_wallet_address) AND balance_wei >= v_price
  RETURNING balance_wei INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      COALESCE((SELECT balance_wei FROM wallet_credits WHERE wallet_address = lower(p_wallet_address)), 0),
      'insufficient_balance'::text;
    RETURN;
  END IF;

  INSERT INTO credit_charges (wallet_address, action_type, amount_wei)
  VALUES (lower(p_wallet_address), p_action_type, v_price);

  RETURN QUERY SELECT true, v_new_balance, 'ok'::text;
END;
$$;
