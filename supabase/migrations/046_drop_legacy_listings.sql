-- supabase/migrations/046_drop_legacy_listings.sql
-- vv_checks_listings and vv_editions_listings are legacy one-off listing
-- snapshots (last synced 2026-03-01, per their last_seen_at values), not
-- created by any migration in this repo, and not referenced by any live
-- code, view, or function as of this migration:
--   - vv_checks_listings backed the `listed_checks` view, dropped in
--     migration 006 — nothing has depended on it since.
--   - vv_editions_listings was never referenced by any view/function; it
--     was purely a manual one-time snapshot. Its data shape informed the
--     design of the new editions_checks table (migration 042), which has
--     a live hourly sync and supersedes it.
-- Both were already locked down (RLS enabled, anon/authenticated SELECT
-- revoked) by migrations 026 and 028.

DROP TABLE IF EXISTS vv_checks_listings;
DROP TABLE IF EXISTS vv_editions_listings;
