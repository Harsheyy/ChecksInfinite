-- supabase/migrations/056_pattern_variations.sql
-- Move the whole pattern library out of a downloaded JSON blob and into
-- Postgres, so the Patterns tab can serve everything the hunts found instead
-- of a truncated sample.
--
-- Why: build-layouts-index.ts packed layouts, colour variations AND recipes
-- into one eager 38.9 MB layouts.json that the browser fetched and parsed in
-- full. To keep that survivable it capped each layout at 4 colour variations x
-- 3 recipes, which discarded 68% of the variations and 72% of the distinct
-- recipes found across every hunt ever run (1,279,231 -> 411,488 and
-- 2,093,383 -> 576,059). The layout cards still reported the true variety, so a
-- card reading "30 colour pairs" could only ever open 4 of them.
--
-- Both halves now live here, uncapped. The composer's cell matching runs as a
-- query (search_pattern_layouts) instead of a scan over 193k parsed objects,
-- and a layout's recipes are fetched only when it is opened — already a paid
-- pattern_query, so the round-trip costs nothing in UX terms.

-- ── Layouts ──────────────────────────────────────────────────────────────────
-- cells_mask is the minority cell set as a 20-bit mask (bit i = cell i), which
-- is what every lookup matches on: set equality is `=`, overlap is a popcount
-- of the AND. cells_key keeps the canonical '7,8,10,13' text form as the join
-- key for pattern_variations and for rendering.
CREATE TABLE pattern_layouts (
  cells_mask    integer  PRIMARY KEY,
  cells_key     text     NOT NULL,
  minority_size smallint NOT NULL,
  variety       integer  NOT NULL,  -- distinct colour pairs found for this layout
  total_recipes integer  NOT NULL   -- distinct recipes across all those pairs
);

ALTER TABLE pattern_layouts ENABLE ROW LEVEL SECURITY;

-- Public read — this is the same data the public pattern-catalog bucket already
-- served, so nothing new is exposed. Writes are service-role only (the build
-- script), which bypasses RLS, so no write policy is added.
CREATE POLICY "public read pattern_layouts"
  ON pattern_layouts FOR SELECT
  USING (true);

-- ── Variations ───────────────────────────────────────────────────────────────
-- One row per (cell layout, majority colour, minority colour). `recipes` is a
-- flat int array, 4 entries per recipe (keeper_1, burner_1, keeper_2, burner_2)
-- — an array of arrays would pay a per-element header on 2M+ tuples for
-- nothing, since callers always unnest it anyway.
CREATE TABLE pattern_variations (
  cells_key    text      NOT NULL,
  maj_hex      text      NOT NULL,
  min_hex      text      NOT NULL,
  recipe_count integer   NOT NULL,  -- times this pattern was hit during hunting
  recipes      integer[] NOT NULL,
  PRIMARY KEY (cells_key, maj_hex, min_hex)
);

-- No separate index on cells_key: the primary key's btree already leads with
-- it, and that is the only lookup the app makes.

ALTER TABLE pattern_variations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read pattern_variations"
  ON pattern_variations FOR SELECT
  USING (true);

-- ── Staging + swap ───────────────────────────────────────────────────────────
-- Same shape as 054_permutations_staging_swap.sql. Loading 193k + 1.28M rows
-- over PostgREST takes minutes, and a mid-load crash against the live tables
-- would leave the Patterns tab empty for every layout already cleared.
CREATE TABLE pattern_layouts_staging    (LIKE pattern_layouts    INCLUDING DEFAULTS);
CREATE TABLE pattern_variations_staging (LIKE pattern_variations INCLUDING DEFAULTS);

ALTER TABLE pattern_layouts_staging    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_variations_staging ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION truncate_pattern_staging()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE TABLE pattern_layouts_staging, pattern_variations_staging;
END;
$$;

-- TRUNCATE + INSERT…SELECT in one function body is a single transaction:
-- readers see the old library or the new one, never an empty or half-written
-- state. Both tables swap together so layouts never reference variations that
-- aren't loaded yet. Refuses to publish empty staging for the same reason
-- swap_permutations() does.
--
-- statement_timeout is raised for the same reason 055 raised it on
-- swap_permutations(): moving ~1.47M rows blows the default and rolls the swap
-- back, correctly keeping the old library live but never publishing the new
-- one. Scoped to this function so everything else still fails fast.
CREATE OR REPLACE FUNCTION swap_pattern_library()
RETURNS TABLE (layouts bigint, variations bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
DECLARE
  n_layouts    bigint;
  n_variations bigint;
BEGIN
  SELECT count(*) INTO n_layouts    FROM pattern_layouts_staging;
  SELECT count(*) INTO n_variations FROM pattern_variations_staging;

  IF n_layouts = 0 OR n_variations = 0 THEN
    RAISE EXCEPTION 'swap_pattern_library: staging is empty (% layouts, % variations), refusing to publish an empty pattern library',
      n_layouts, n_variations;
  END IF;

  TRUNCATE TABLE pattern_layouts, pattern_variations;
  INSERT INTO pattern_layouts    SELECT * FROM pattern_layouts_staging;
  INSERT INTO pattern_variations SELECT * FROM pattern_variations_staging;
  TRUNCATE TABLE pattern_layouts_staging, pattern_variations_staging;

  layouts    := n_layouts;
  variations := n_variations;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION truncate_pattern_staging() FROM public;
REVOKE ALL ON FUNCTION swap_pattern_library()     FROM public;
GRANT EXECUTE ON FUNCTION truncate_pattern_staging() TO service_role;
GRANT EXECUTE ON FUNCTION swap_pattern_library()     TO service_role;

-- ── Read path: composer matching ─────────────────────────────────────────────
-- Replaces PatternComposer's client-side scan. Exact matches (the layout's
-- minority set IS the painted set) win outright and are all returned; only when
-- there are none does it fall back to layouts sharing at least one painted
-- cell, ranked by overlap then by how close the layout's size is to the
-- selection — the same ordering the client used.
--
-- bit_count over a bit(32) cast is the popcount; the 20-bit masks make the
-- upper bits always zero, so the cast is exact.
CREATE OR REPLACE FUNCTION search_pattern_layouts(p_mask integer, p_limit integer DEFAULT 60)
RETURNS TABLE (
  cells_key     text,
  cells_mask    integer,
  minority_size smallint,
  variety       integer,
  total_recipes integer,
  overlap       integer,
  is_exact      boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH sel AS (SELECT bit_count(p_mask::bit(32))::integer AS n),
  exact AS (
    SELECT l.cells_key, l.cells_mask, l.minority_size, l.variety, l.total_recipes,
           sel.n AS overlap, true AS is_exact
    FROM pattern_layouts l, sel
    WHERE l.cells_mask = p_mask
  ),
  related AS (
    SELECT l.cells_key, l.cells_mask, l.minority_size, l.variety, l.total_recipes,
           bit_count((l.cells_mask & p_mask)::bit(32))::integer AS overlap,
           false AS is_exact
    FROM pattern_layouts l
    WHERE NOT EXISTS (SELECT 1 FROM exact)
      AND l.cells_mask & p_mask <> 0
  )
  SELECT * FROM exact
  UNION ALL
  SELECT * FROM (
    SELECT r.* FROM related r, sel
    ORDER BY r.overlap DESC, abs(r.minority_size - sel.n), r.total_recipes DESC
    LIMIT least(greatest(p_limit, 1), 200)
  ) ranked;
$$;

-- ── Read path: a layout's recipes ────────────────────────────────────────────
-- Unnests the flat recipe arrays server-side and caps there, so a layout with
-- 7,082 recipes (today's worst case) returns a page rather than all of it.
-- Ordered by recipe_count desc so the colour pairs the hunts hit most often
-- come first, and so paging is deterministic.
CREATE OR REPLACE FUNCTION get_pattern_layout_recipes(p_cells_key text, p_limit integer DEFAULT 500)
RETURNS TABLE (
  maj_hex     text,
  min_hex     text,
  keeper_1_id integer,
  burner_1_id integer,
  keeper_2_id integer,
  burner_2_id integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT v.maj_hex,
         v.min_hex,
         v.recipes[g.i],
         v.recipes[g.i + 1],
         v.recipes[g.i + 2],
         v.recipes[g.i + 3]
  FROM pattern_variations v
  CROSS JOIN LATERAL generate_series(1, array_length(v.recipes, 1), 4) AS g(i)
  WHERE v.cells_key = p_cells_key
  ORDER BY v.recipe_count DESC, v.maj_hex, v.min_hex, g.i
  LIMIT least(greatest(p_limit, 1), 2000);
$$;
