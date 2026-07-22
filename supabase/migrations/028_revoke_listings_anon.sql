-- Migration 028: cut anon access to the legacy listing objects
--
-- vv_checks_listings / vv_editions_listings are not created by any migration
-- (they were made manually in the dashboard and are populated by a daily cron).
-- Migration 026 tried to lock them with ENABLE ROW LEVEL SECURITY, but that is a
-- silent no-op if either object is a VIEW rather than a table — which is why anon
-- could still read vv_checks_listings after 026.
--
-- REVOKE SELECT works regardless of whether the object is a table or a view, so
-- it definitively removes anon/authenticated read access. The only consumer was
-- the listed_checks view, which was dropped in migration 006, so nothing in the
-- app reads these. The daily cron and backend scripts use the service role,
-- which is unaffected by GRANT/REVOKE.

REVOKE SELECT ON vv_checks_listings   FROM anon, authenticated;
REVOKE SELECT ON vv_editions_listings FROM anon, authenticated;
