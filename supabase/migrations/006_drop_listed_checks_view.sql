-- listed_checks was backed by vv_checks_listings (TokenWorks).
-- tokenstr_checks is now the source of truth for the wallet inventory.
-- The view is no longer used by any backend script or frontend query.
DROP VIEW IF EXISTS listed_checks;
