-- supabase/migrations/031_curated_outputs_order_tiebreaker.sql
-- Safe to re-run: CREATE OR REPLACE, same function signature/return type as 011.

-- get_curated_outputs' ORDER BY (like_count DESC, first_liked_at DESC) has no
-- unique tiebreaker. useCuratedOutputs.ts now pages through this RPC with
-- LIMIT/OFFSET across multiple calls (see frontend/src/useCuratedOutputs.ts);
-- two rows tied on both columns could land inconsistently across page
-- boundaries (silently skipped or duplicated). Adding co.id DESC gives the
-- ordering a stable total order so pagination is deterministic.

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
  k1_struct       jsonb,
  b1_struct       jsonb,
  k2_struct       jsonb,
  b2_struct       jsonb,
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
    co.k1_struct,
    co.b1_struct,
    co.k2_struct,
    co.b2_struct,
    COUNT(cl.id)::bigint                                   AS like_count,
    COALESCE(BOOL_OR(cl.wallet_address = p_wallet), false) AS user_liked,
    co.first_liked_at
  FROM curated_outputs co
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
  ORDER BY like_count DESC, co.first_liked_at DESC, co.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
