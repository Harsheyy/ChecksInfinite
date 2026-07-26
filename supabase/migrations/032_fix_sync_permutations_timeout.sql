-- Migration 032: fix sync_all_listed_permutations() silently timing out
--
-- Diagnosis: the function has been failing with "canceling statement due to
-- statement timeout" (code 57014) on every single hourly invocation since
-- 2026-07-21 — a full-table UPDATE across ~250K+ all_permutations rows
-- exceeds the role's default statement_timeout (a few seconds). The calling
-- edge function (sync-market-prices) only console.warns on this error and
-- continues, so sync_log has been reporting "done" the whole time even
-- though is_all_listed/total_cost silently stopped updating.
--
-- Fix: attach a generous statement_timeout to this specific function via
-- ALTER FUNCTION ... SET, which applies whenever it's called (including via
-- RPC from the edge function) regardless of the caller's own session
-- timeout. This is a background/cron-triggered recompute with nothing
-- interactive waiting on it, so a few minutes is safe.

ALTER FUNCTION sync_all_listed_permutations() SET statement_timeout = '5min';
