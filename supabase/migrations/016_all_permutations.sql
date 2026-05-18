-- supabase/migrations/016_all_permutations.sql
-- New table for market-wide permutations (500K rows, refreshed nightly).
-- color_family = colorIndexes()[0] / 10 → hue bucket 0-7 for diversity sampling.

CREATE TABLE all_permutations (
  id              bigserial   PRIMARY KEY,
  keeper_1_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  burner_1_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  keeper_2_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  burner_2_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  abcd_checks     smallint,
  abcd_color_band text,
  abcd_gradient   text,
  abcd_speed      text,
  abcd_shift      text,
  color_family    smallint,
  total_cost      float,
  rand_key        float       NOT NULL DEFAULT random(),
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
);

CREATE INDEX idx_all_perm_fingerprint ON all_permutations (abcd_color_band, abcd_gradient, color_family);
CREATE INDEX idx_all_perm_rand_key    ON all_permutations (rand_key);
CREATE INDEX idx_all_perm_checks      ON all_permutations (abcd_checks);
CREATE INDEX idx_all_perm_color_band  ON all_permutations (abcd_color_band);
CREATE INDEX idx_all_perm_gradient    ON all_permutations (abcd_gradient);
CREATE INDEX idx_all_perm_speed       ON all_permutations (abcd_speed);
CREATE INDEX idx_all_perm_shift       ON all_permutations (abcd_shift);
CREATE INDEX idx_all_perm_total_cost  ON all_permutations (total_cost);
CREATE INDEX idx_all_perm_keeper_1    ON all_permutations (keeper_1_id);
CREATE INDEX idx_all_perm_keeper_2    ON all_permutations (keeper_2_id);

-- RLS: public read only
ALTER TABLE all_permutations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read all_permutations" ON all_permutations FOR SELECT USING (true);

-- Truncate helper (mirrors the one for permutations)
CREATE OR REPLACE FUNCTION truncate_all_permutations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  TRUNCATE TABLE all_permutations RESTART IDENTITY;
END;
$$;
