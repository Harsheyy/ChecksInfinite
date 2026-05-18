-- ─── checks ──────────────────────────────────────────────────────────────────
-- One row per token. check_struct is the raw output of getCheck() as JSON,
-- needed by the JS computation engine (simulateCompositeJS / generateSVGJS).
-- svg is the pre-rendered tokenURI SVG for display.

CREATE TABLE checks (
  token_id        bigint      PRIMARY KEY,
  owner           text        NOT NULL,
  is_burned       boolean     NOT NULL DEFAULT false,

  -- Attributes (from tokenURI metadata)
  checks_count    smallint    NOT NULL,  -- 1 | 5 | 10 | 20 | 40 | 80
  color_band      text,                  -- 'Eighty' | 'Sixty' | 'Forty' | 'Twenty' | 'Ten' | 'Five' | 'One'
  gradient        text,                  -- 'None' | 'Linear' | 'Double Linear' | 'Reflected' | 'Double Angled' | 'Angled' | 'Linear Z'
  speed           text,                  -- '0.5x' | '1x' | '2x'
  shift           text,                  -- 'IR' | 'UV' | null (only on composites)

  -- Pre-rendered SVG string (from tokenURI, base64-decoded)
  svg             text,

  -- Full CheckStruct JSON — required by simulateCompositeJS / generateSVGJS
  -- Shape matches the CheckStruct type in frontend/src/utils.ts
  -- Note: seed (uint256) is stored as a string to survive JSON round-trips.
  check_struct    jsonb       NOT NULL,

  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Tokens must share checks_count to be compositable — this is the primary filter
CREATE INDEX idx_checks_count       ON checks (checks_count) WHERE NOT is_burned;
CREATE INDEX idx_checks_owner       ON checks (owner)        WHERE NOT is_burned;
CREATE INDEX idx_checks_last_synced ON checks (last_synced_at);


-- ─── permutations ────────────────────────────────────────────────────────────
-- One row per ordered 4-tuple (keeper_1, burner_1, keeper_2, burner_2).
-- L1a = simulateComposite(keeper_1, burner_1)
-- L1b = simulateComposite(keeper_2, burner_2)
-- ABCD = simulateComposite(L1a, L1b)
-- All four input tokens must share the same checks_count.

CREATE TABLE permutations (
  id              bigserial   PRIMARY KEY,

  -- Input token IDs
  keeper_1_id     bigint      NOT NULL REFERENCES checks(token_id),
  burner_1_id     bigint      NOT NULL REFERENCES checks(token_id),
  keeper_2_id     bigint      NOT NULL REFERENCES checks(token_id),
  burner_2_id     bigint      NOT NULL REFERENCES checks(token_id),

  -- Intermediate SVGs (used in the tree detail modal)
  l1a_svg         text        NOT NULL,
  l1b_svg         text        NOT NULL,

  -- Final ABCD composite output
  abcd_svg        text        NOT NULL,
  abcd_checks     smallint,
  abcd_color_band text,
  abcd_gradient   text,
  abcd_speed      text,
  abcd_shift      text,

  computed_at     timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate computation
  UNIQUE (keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
);

-- Attribute filtering — matches the 5 FilterBar dropdowns
CREATE INDEX idx_perm_abcd_checks     ON permutations (abcd_checks);
CREATE INDEX idx_perm_abcd_color_band ON permutations (abcd_color_band);
CREATE INDEX idx_perm_abcd_gradient   ON permutations (abcd_gradient);
CREATE INDEX idx_perm_abcd_speed      ON permutations (abcd_speed);
CREATE INDEX idx_perm_abcd_shift      ON permutations (abcd_shift);

-- "Show all permutations containing token X" queries
CREATE INDEX idx_perm_keeper_1_id ON permutations (keeper_1_id);
CREATE INDEX idx_perm_keeper_2_id ON permutations (keeper_2_id);

-- Compound filter (most common client query pattern)
CREATE INDEX idx_perm_attrs_compound ON permutations (abcd_checks, abcd_color_band, abcd_gradient);


-- ─── listed_checks (view) ───────────────────────────────────────────────────
-- Convenience view: checks that are currently listed on TokenWorks.
-- Used by the permutation script and client queries.
-- Re-evaluates automatically as vv_checks_listings is updated by the daily cron.

CREATE OR REPLACE VIEW listed_checks AS
SELECT c.*
FROM checks c
INNER JOIN vv_checks_listings l ON l.token_id = c.token_id::text
WHERE l.source = 'tokenworks'
  AND c.is_burned = false;


-- ─── sync_log ────────────────────────────────────────────────────────────────
-- Tracks backfill and permutation script runs for incremental processing.

CREATE TABLE sync_log (
  id          bigserial   PRIMARY KEY,
  job         text        NOT NULL,  -- 'backfill' | 'permutations' | 'webhook'
  status      text        NOT NULL,  -- 'running' | 'done' | 'error'
  tokens_processed  int,
  perms_computed    bigint,
  error_message     text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
