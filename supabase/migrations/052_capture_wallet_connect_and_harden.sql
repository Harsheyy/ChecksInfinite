-- supabase/migrations/052_capture_wallet_connect_and_harden.sql
--
-- Follow-up to 051. That migration captured three drifted functions but missed
-- the two objects that actually matter, both found by a 2026-08-05 audit that
-- diffed production against the migration history:
--
--   1. connected_wallets (the TABLE) — created by hand, never in a migration.
--      Fixed in 012, which is the first migration to touch it.
--   2. log_wallet_connect — live, called by the app on every wallet connect
--      (apps/works/src/useWalletTracking.ts), and defined in no migration.
--
-- It also closes a grant gap left by 024_security_hardening.sql.
--
-- Definitions below were read out of production with pg_get_functiondef and are
-- reproduced verbatim, so this is a no-op against prod.

-- ─── log_wallet_connect (2-arg) ─────────────────────────────────────────────
-- The live one. SECURITY DEFINER because connected_wallets has RLS enabled with
-- no policies, so an invoker-rights insert from anon would be silently dropped.

CREATE OR REPLACE FUNCTION public.log_wallet_connect(
  p_address  text,
  p_ens_name text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
  begin
    insert into connected_wallets (address, first_seen, last_seen, visit_count, ens_name)
    values (lower(p_address), now(), now(), 1, p_ens_name)
    on conflict (address) do update
      set last_seen   = now(),
          visit_count = connected_wallets.visit_count + 1,
          ens_name    = coalesce(p_ens_name, connected_wallets.ens_name);
  end;
  $function$;

GRANT EXECUTE ON FUNCTION public.log_wallet_connect(text, text) TO anon, authenticated;

-- ─── Drop the vestigial 1-arg overload ──────────────────────────────────────
-- Production also carries log_wallet_connect(p_address text) — the pre-ENS
-- version. Nothing calls it: the app passes both arguments, and no migration
-- or edge function references it. It is worth removing rather than leaving,
-- for two reasons:
--
--   * It is SECURITY INVOKER, so its insert is dropped on the floor by the RLS
--     policy-less connected_wallets. It cannot do its job if it were called.
--   * Because the 2-arg version declares DEFAULT NULL for p_ens_name, a call
--     carrying only {p_address} matches BOTH overloads, and PostgREST rejects
--     that as ambiguous (PGRST203). Dropping it removes the trap.
--
-- Recorded here in case it ever needs restoring:
--   insert into connected_wallets (address, first_seen, last_seen, visit_count)
--   values (lower(p_address), now(), now(), 1)
--   on conflict (address) do update
--     set last_seen = now(), visit_count = connected_wallets.visit_count + 1;

DROP FUNCTION IF EXISTS public.log_wallet_connect(text);

-- ─── Close the 024 grant gap ────────────────────────────────────────────────
-- 024_security_hardening.sql revoked anon/authenticated EXECUTE on
-- update_permutation_costs(integer) but not on its sibling
-- backfill_permutation_costs(), which runs the same four-way join across the
-- whole permutations table instead of one token's rows. It is SECURITY INVOKER,
-- so RLS means an anon caller updates nothing — but Postgres still plans and
-- executes the join, so an unauthenticated client can burn database CPU on
-- demand. It is only ever called by backend scripts holding the service key.

REVOKE EXECUTE ON FUNCTION public.backfill_permutation_costs() FROM PUBLIC, anon, authenticated;

-- The three functions 051 captured are dead but reachable by anon. None can
-- write anything (all SECURITY INVOKER against RLS-protected tables), so this
-- is tidying rather than a fix — it keeps the anon-executable surface equal to
-- the set of RPCs the app actually calls.

REVOKE EXECUTE ON FUNCTION public.log_wallet_purchase(text, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_random_permutations(integer)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()                             FROM PUBLIC, anon, authenticated;
