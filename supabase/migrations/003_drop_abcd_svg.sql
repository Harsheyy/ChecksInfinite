-- SVGs (~10KB each) are too large to store at scale — 657k rows × 10KB = ~6.5GB.
-- Compute abcd_svg client-side from check_struct data instead (fast JS engine).
TRUNCATE permutations;
ALTER TABLE permutations DROP COLUMN abcd_svg;
ALTER TABLE permutations DROP COLUMN l1a_svg;
ALTER TABLE permutations DROP COLUMN l1b_svg;
