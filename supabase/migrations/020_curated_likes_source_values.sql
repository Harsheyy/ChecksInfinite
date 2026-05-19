-- Migration 020: expand curated_likes source CHECK constraint
-- Old values: token-works, my-checks, search-wallet
-- New values: token-works, my-checks, opensea, search

-- Drop old constraint first so the data migration can run
ALTER TABLE curated_likes DROP CONSTRAINT IF EXISTS curated_likes_source_check;

-- Migrate existing rows
UPDATE curated_likes SET source = 'search' WHERE source = 'search-wallet';

-- Add new constraint
ALTER TABLE curated_likes ADD CONSTRAINT curated_likes_source_check
  CHECK (source IN ('token-works', 'my-checks', 'opensea', 'search'));
