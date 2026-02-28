-- Rename checks → tokenstr_checks.
-- PostgreSQL auto-migrates FK constraints, indexes, sequences, and RLS policies.
-- Only the listed_checks view must be explicitly recreated (its body has the literal name).

ALTER TABLE checks RENAME TO tokenstr_checks;

DROP VIEW IF EXISTS listed_checks;

CREATE OR REPLACE VIEW listed_checks AS
SELECT c.*
FROM tokenstr_checks c
INNER JOIN vv_checks_listings l ON l.token_id = c.token_id::text
WHERE l.source = 'tokenworks'
  AND c.is_burned = false;
