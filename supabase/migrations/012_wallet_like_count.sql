-- supabase/migrations/012_wallet_like_count.sql
-- Adds total_likes to connected_wallets and keeps it in sync via toggle_like.
-- Safe to re-run: uses IF NOT EXISTS and CREATE OR REPLACE throughout.

-- ── Add column ────────────────────────────────────────────────────────────────

ALTER TABLE connected_wallets
  ADD COLUMN IF NOT EXISTS total_likes int NOT NULL DEFAULT 0;

-- ── Backfill from existing likes ──────────────────────────────────────────────

UPDATE connected_wallets cw
SET total_likes = (
  SELECT COUNT(*)
  FROM curated_likes cl
  WHERE cl.wallet_address = cw.address
);

-- ── Update toggle_like to maintain total_likes ────────────────────────────────
-- Identical signature — CREATE OR REPLACE is safe here (return type unchanged).

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
  p_abcd_shift      text  DEFAULT NULL,
  p_k1_struct       jsonb DEFAULT NULL,
  p_b1_struct       jsonb DEFAULT NULL,
  p_k2_struct       jsonb DEFAULT NULL,
  p_b2_struct       jsonb DEFAULT NULL
)
RETURNS TABLE (output_id bigint, like_count bigint, user_liked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_output_id    bigint;
  v_like_count   bigint;
  v_user_liked   boolean;
  v_rows_deleted int;
BEGIN
  -- Insert output row if new; if it exists, fill in any missing struct columns
  INSERT INTO curated_outputs
    (keeper_1_id, burner_1_id, keeper_2_id, burner_2_id,
     abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift,
     k1_struct, b1_struct, k2_struct, b2_struct)
  VALUES
    (p_keeper_1_id, p_burner_1_id, p_keeper_2_id, p_burner_2_id,
     p_abcd_checks, p_abcd_color_band, p_abcd_gradient, p_abcd_speed, p_abcd_shift,
     p_k1_struct, p_b1_struct, p_k2_struct, p_b2_struct)
  ON CONFLICT (keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
  DO UPDATE SET
    k1_struct = COALESCE(curated_outputs.k1_struct, EXCLUDED.k1_struct),
    b1_struct = COALESCE(curated_outputs.b1_struct, EXCLUDED.b1_struct),
    k2_struct = COALESCE(curated_outputs.k2_struct, EXCLUDED.k2_struct),
    b2_struct = COALESCE(curated_outputs.b2_struct, EXCLUDED.b2_struct);

  SELECT id INTO v_output_id
  FROM curated_outputs
  WHERE keeper_1_id = p_keeper_1_id AND burner_1_id = p_burner_1_id
    AND keeper_2_id = p_keeper_2_id AND burner_2_id = p_burner_2_id;

  -- Delete-first toggle: avoids race conditions from rapid double-clicks.
  DELETE FROM curated_likes
  WHERE curated_likes.output_id = v_output_id
    AND curated_likes.wallet_address = p_wallet;
  GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

  IF v_rows_deleted = 0 THEN
    INSERT INTO curated_likes (output_id, wallet_address, source)
    VALUES (v_output_id, p_wallet, p_source)
    ON CONFLICT ON CONSTRAINT curated_likes_output_id_wallet_address_key DO NOTHING;
    v_user_liked := true;
  ELSE
    v_user_liked := false;
  END IF;

  SELECT COUNT(*) INTO v_like_count
  FROM curated_likes WHERE curated_likes.output_id = v_output_id;

  IF v_like_count = 0 THEN
    DELETE FROM curated_outputs WHERE id = v_output_id;
  END IF;

  -- Keep connected_wallets.total_likes in sync.
  -- Uses INSERT ... ON CONFLICT so wallets that liked before formally connecting are handled.
  INSERT INTO connected_wallets (address, total_likes)
  VALUES (p_wallet, CASE WHEN v_user_liked THEN 1 ELSE 0 END)
  ON CONFLICT (address) DO UPDATE
    SET total_likes = GREATEST(0,
      connected_wallets.total_likes + CASE WHEN v_user_liked THEN 1 ELSE -1 END
    );

  RETURN QUERY SELECT v_output_id, v_like_count, v_user_liked;
END;
$$;
