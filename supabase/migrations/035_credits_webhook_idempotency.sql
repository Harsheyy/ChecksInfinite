-- supabase/migrations/035_credits_webhook_idempotency.sql
-- Safe to re-run: uses IF NOT EXISTS throughout

CREATE TABLE IF NOT EXISTS credited_transfers (
  tx_hash    text        PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE credited_transfers ENABLE ROW LEVEL SECURITY;

-- Atomically dedups on tx_hash before crediting — a duplicate/retried
-- delivery of the same transfer is a silent no-op (returns the
-- already-current balance) rather than double-crediting.
CREATE OR REPLACE FUNCTION credit_wallet_from_transfer(
  p_wallet_address text,
  p_amount_wei     numeric,
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
    -- Already credited for this transfer — return current balance unchanged.
    RETURN COALESCE((SELECT balance_wei FROM wallet_credits WHERE wallet_address = lower(p_wallet_address)), 0);
  END IF;

  INSERT INTO wallet_credits (wallet_address, balance_wei, updated_at)
  VALUES (lower(p_wallet_address), p_amount_wei, now())
  ON CONFLICT (wallet_address)
  DO UPDATE SET balance_wei = wallet_credits.balance_wei + EXCLUDED.balance_wei, updated_at = now()
  RETURNING balance_wei INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;
REVOKE EXECUTE ON FUNCTION credit_wallet_from_transfer(text, numeric, text) FROM PUBLIC, anon, authenticated;
