-- supabase/migrations/048_checkmath_tokenworks_sweep.sql
-- Adds a third sweep metric for Token Works (TokenStrategy-held) Checks,
-- alongside the existing Checks VV and Checks Editions sweeps. Token Works
-- prices come from the TokenStrategy contract's nftForSale() (synced by
-- sync-tokenstr), a real, actionable price via that contract's own buy
-- flow — distinct from an OpenSea listing but still a genuine sweep target.

ALTER TABLE checkmath_snapshots
  ADD COLUMN tokenworks_sweep_cost  float,
  ADD COLUMN tokenworks_sweep_count integer;
