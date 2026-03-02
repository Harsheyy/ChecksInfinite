-- supabase/migrations/011_curated_outputs.sql
-- Safe to re-run: uses IF NOT EXISTS and DROP IF EXISTS throughout

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS curated_outputs (
  id              bigserial    PRIMARY KEY,
  keeper_1_id     bigint       NOT NULL REFERENCES tokenstr_checks(token_id),
  burner_1_id     bigint       NOT NULL REFERENCES tokenstr_checks(token_id),
  keeper_2_id     bigint       NOT NULL REFERENCES tokenstr_checks(token_id),
  burner_2_id     bigint       NOT NULL REFERENCES tokenstr_checks(token_id),
  abcd_checks     smallint     NOT NULL,
  abcd_color_band text         NOT NULL,
  abcd_gradient   text         NOT NULL,
  abcd_speed      text         NOT NULL,
  abcd_shift      text,
  first_liked_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
);

CREATE TABLE IF NOT EXISTS curated_likes (
  id             bigserial    PRIMARY KEY,
  output_id      bigint       NOT NULL REFERENCES curated_outputs(id) ON DELETE CASCADE,
  wallet_address text         NOT NULL,
  source         text         NOT NULL CHECK (source IN ('token-works', 'my-checks', 'search-wallet')),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(output_id, wallet_address)
);

-- Indexes
CREATE INDEX IF NOT EXISTS curated_likes_output_id_idx        ON curated_likes(output_id);
CREATE INDEX IF NOT EXISTS curated_likes_wallet_address_idx   ON curated_likes(wallet_address);
CREATE INDEX IF NOT EXISTS curated_outputs_abcd_checks_idx    ON curated_outputs(abcd_checks);

-- ── RLS: public read, no direct write (only via RPCs) ────────────────────────

ALTER TABLE curated_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_likes   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read curated_outputs" ON curated_outputs;
DROP POLICY IF EXISTS "public read curated_likes"   ON curated_likes;
CREATE POLICY "public read curated_outputs" ON curated_outputs FOR SELECT USING (true);
CREATE POLICY "public read curated_likes"   ON curated_likes   FOR SELECT USING (true);

-- ── RPC: get_curated_outputs ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_curated_outputs(
  p_wallet       text     DEFAULT NULL,
  p_wallet_only  boolean  DEFAULT false,
  p_checks       smallint DEFAULT NULL,
  p_color_band   text     DEFAULT NULL,
  p_gradient     text     DEFAULT NULL,
  p_speed        text     DEFAULT NULL,
  p_shift        text     DEFAULT NULL,
  p_limit        int      DEFAULT 200,
  p_offset       int      DEFAULT 0
)
RETURNS TABLE (
  id              bigint,
  keeper_1_id     bigint,
  burner_1_id     bigint,
  keeper_2_id     bigint,
  burner_2_id     bigint,
  abcd_checks     smallint,
  abcd_color_band text,
  abcd_gradient   text,
  abcd_speed      text,
  abcd_shift      text,
  like_count      bigint,
  user_liked      boolean,
  first_liked_at  timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    co.id,
    co.keeper_1_id,
    co.burner_1_id,
    co.keeper_2_id,
    co.burner_2_id,
    co.abcd_checks,
    co.abcd_color_band,
    co.abcd_gradient,
    co.abcd_speed,
    co.abcd_shift,
    COUNT(cl.id)::bigint                                   AS like_count,
    COALESCE(BOOL_OR(cl.wallet_address = p_wallet), false) AS user_liked,
    co.first_liked_at
  FROM curated_outputs co
  INNER JOIN tokenstr_checks t1 ON t1.token_id = co.keeper_1_id AND NOT t1.is_burned
  INNER JOIN tokenstr_checks t2 ON t2.token_id = co.burner_1_id AND NOT t2.is_burned
  INNER JOIN tokenstr_checks t3 ON t3.token_id = co.keeper_2_id AND NOT t3.is_burned
  INNER JOIN tokenstr_checks t4 ON t4.token_id = co.burner_2_id AND NOT t4.is_burned
  LEFT JOIN curated_likes cl ON cl.output_id = co.id
  WHERE
    (p_checks     IS NULL OR co.abcd_checks     = p_checks)     AND
    (p_color_band IS NULL OR co.abcd_color_band = p_color_band) AND
    (p_gradient   IS NULL OR co.abcd_gradient   = p_gradient)   AND
    (p_speed      IS NULL OR co.abcd_speed      = p_speed)      AND
    (p_shift      IS NULL OR co.abcd_shift      = p_shift)
  GROUP BY co.id
  HAVING
    COUNT(cl.id) > 0
    AND (NOT p_wallet_only OR BOOL_OR(cl.wallet_address = p_wallet))
  ORDER BY like_count DESC, co.first_liked_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── RPC: toggle_like ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION toggle_like(
  p_keeper_1_id     bigint,
  p_burner_1_id     bigint,
  p_keeper_2_id     bigint,
  p_burner_2_id     bigint,
  p_wallet          text,
  p_source          text,
  p_abcd_checks     smallint,
  p_abcd_color_band text,
  p_abcd_gradient   text,
  p_abcd_speed      text,
  p_abcd_shift      text DEFAULT NULL
)
RETURNS TABLE (output_id bigint, like_count bigint, user_liked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_output_id  bigint;
  v_like_count bigint;
  v_user_liked boolean;
BEGIN
  INSERT INTO curated_outputs
    (keeper_1_id, burner_1_id, keeper_2_id, burner_2_id,
     abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift)
  VALUES
    (p_keeper_1_id, p_burner_1_id, p_keeper_2_id, p_burner_2_id,
     p_abcd_checks, p_abcd_color_band, p_abcd_gradient, p_abcd_speed, p_abcd_shift)
  ON CONFLICT (keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
  DO NOTHING;

  SELECT id INTO v_output_id
  FROM curated_outputs
  WHERE keeper_1_id = p_keeper_1_id AND burner_1_id = p_burner_1_id
    AND keeper_2_id = p_keeper_2_id AND burner_2_id = p_burner_2_id;

  IF EXISTS (
    SELECT 1 FROM curated_likes
    WHERE curated_likes.output_id = v_output_id AND curated_likes.wallet_address = p_wallet
  ) THEN
    DELETE FROM curated_likes
    WHERE curated_likes.output_id = v_output_id AND curated_likes.wallet_address = p_wallet;
    v_user_liked := false;
  ELSE
    INSERT INTO curated_likes (output_id, wallet_address, source)
    VALUES (v_output_id, p_wallet, p_source);
    v_user_liked := true;
  END IF;

  SELECT COUNT(*) INTO v_like_count
  FROM curated_likes WHERE curated_likes.output_id = v_output_id;

  IF v_like_count = 0 THEN
    DELETE FROM curated_outputs WHERE id = v_output_id;
  END IF;

  RETURN QUERY SELECT v_output_id, v_like_count, v_user_liked;
END;
$$;

-- ── RPC: get_my_liked_keys ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_liked_keys(p_wallet text)
RETURNS TABLE (
  keeper_1_id bigint,
  burner_1_id bigint,
  keeper_2_id bigint,
  burner_2_id bigint
)
LANGUAGE sql
AS $$
  SELECT co.keeper_1_id, co.burner_1_id, co.keeper_2_id, co.burner_2_id
  FROM curated_likes cl
  JOIN curated_outputs co ON co.id = cl.output_id
  WHERE cl.wallet_address = p_wallet;
$$;
