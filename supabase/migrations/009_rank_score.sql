-- Add rank_score to permutations for quality-ordered browsing.
-- score = (gradient_count × 4) + rarity_score
-- rarity: Twenty=1, Ten=2, Five=3, One=4 per check (max 16)
-- gradient: +4 per check with gradient != 'None' (max 16)
-- Range: 0 (four Twenty-band, no gradient) → 32 (four One-band, all gradient)

ALTER TABLE permutations ADD COLUMN rank_score smallint NOT NULL DEFAULT 0;
CREATE INDEX idx_perm_rank_score ON permutations (rank_score DESC);
