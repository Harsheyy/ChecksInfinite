-- Migration 030: add 'patterns' to curated_likes source CHECK constraint
-- Old values: token-works, my-checks, opensea, search
-- New values: token-works, my-checks, opensea, search, patterns

ALTER TABLE curated_likes DROP CONSTRAINT IF EXISTS curated_likes_source_check;

ALTER TABLE curated_likes ADD CONSTRAINT curated_likes_source_check
  CHECK (source IN ('token-works', 'my-checks', 'opensea', 'search', 'patterns'));
