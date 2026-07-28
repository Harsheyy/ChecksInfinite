-- supabase/migrations/033_siwe_auth.sql
-- Safe to re-run: uses IF NOT EXISTS throughout

CREATE TABLE IF NOT EXISTS siwe_nonces (
  nonce      text        PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  session_token  text        PRIMARY KEY,
  wallet_address text        NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_sessions_wallet_idx ON wallet_sessions(wallet_address);

-- Both tables are written only by edge functions using the service-role key
-- (which bypasses RLS) — no anon/authenticated policies needed, matching
-- 026_enable_rls_internal_tables.sql's convention for internal-only tables.
ALTER TABLE siwe_nonces    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_sessions ENABLE ROW LEVEL SECURITY;
