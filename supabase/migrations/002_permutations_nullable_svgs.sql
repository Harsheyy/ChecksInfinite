-- l1a_svg and l1b_svg are computed on-demand in the detail modal.
-- Storing them triples row size and causes statement timeouts on bulk upserts.
ALTER TABLE permutations
  ALTER COLUMN l1a_svg DROP NOT NULL,
  ALTER COLUMN l1b_svg DROP NOT NULL;
