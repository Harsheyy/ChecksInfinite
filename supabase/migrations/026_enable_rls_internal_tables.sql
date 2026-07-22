-- Migration 026: enable RLS on internal tables that were left unrestricted
--
-- These tables have RLS DISABLED, so the anon key can read (and in the case of
-- connected_wallets, INSERT) directly via the Data API. None of them are read
-- by the frontend:
--   connected_wallets     — analytics; written only via SECURITY DEFINER RPCs
--                           (log_wallet_connect, toggle_like) → leaks wallet
--                           addresses + ENS, and anon could INSERT junk rows
--   sync_log              — job history; written only by service_role edge fns
--   vv_checks_listings    — legacy listing snapshot; not frontend-facing
--   vv_editions_listings  — legacy listing snapshot; not frontend-facing
--
-- Enabling RLS with NO policies denies the anon/authenticated roles entirely.
-- SECURITY DEFINER RPCs run as the function owner and service_role bypasses RLS,
-- so all existing write paths keep working — only direct Data API access is cut.

-- NOTE: plain ENABLE (not FORCE). The table owner remains exempt from RLS, which
-- is required so the SECURITY DEFINER RPCs (toggle_like, log_wallet_connect) —
-- which run as the owner — can still write to connected_wallets. FORCE would
-- subject those functions to the (empty) policy set and block them.
ALTER TABLE connected_wallets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vv_checks_listings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vv_editions_listings ENABLE ROW LEVEL SECURITY;
