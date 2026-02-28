# Supabase Checks Backend — Implementation Plan

**Goal:** Move all on-chain data into Supabase so the client never touches the RPC. Precompute every valid permutation in a backend script, store the results, and serve them via Supabase queries with real-time sync via webhook.

**Scope (Phase 1):** Only tokens currently listed on TokenWorks protocol, sourced from the existing `vv_checks_listings` table (`source = 'tokenworks'`). This keeps the initial permutation set small and immediately useful. Expand to all tokens later.

**Architecture:**
```
vv_checks_listings (updated daily via cron)
    │
    └── token_ids WHERE source = 'tokenworks'
            │
            ├── Backfill script (reads listed IDs, fetches from chain)
            │       └──▶ checks table
            │
            ├── Alchemy webhook ──▶ Supabase Edge Function
            │       └──▶ updates checks table on Composite events
            │
            ├── Permutation script (scoped to listed tokens)
            │       └──▶ permutations table
            │
            └── Daily cron hook (re-syncs new listings → checks → perms)
                    └──▶ Frontend queries Supabase directly (no viem on client)
```

---

## Scale context

| Tokens with same `checks_count` | P(n,4) permutations |
|---|---|
| 20 | 116,280 |
| 50 | 5.5 M |
| 100 | ~94 M |
| 200 | ~1.5 B (not feasible to precompute all) |

**Practical strategy:** Precompute permutations per `checks_count` group. For large groups (80-check tokens), run the script against a curated "active set" (e.g., tokens not composited in the last 30 days, or top N by recency). The schema supports full precompute; scope is a script config choice.

---

## SQL — Run in Supabase SQL Editor

```sql
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
INNER JOIN vv_checks_listings l ON l.token_id = c.token_id
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
```

---

## Phase 1 — Backfill Script

**What it does:** Iterates all token IDs (0 → max supply), calls `tokenURI` + `getCheck` for each, inserts into `checks` table.

**Location:** `backend/scripts/backfill.ts`

**Approach:**
- **Source token IDs from `vv_checks_listings`** — no full-supply scan needed
- Use the existing `checksClient` (viem singleton) with multicall batching — already in `frontend/src/client.ts`, extract to a shared package or duplicate in backend
- Process in batches of 500 (500 × 2 calls = 1000 multicall reads per batch)
- Skip already-synced tokens (check `last_synced_at`)
- Mark burned tokens (`owner == address(0)`) as `is_burned = true`

**Pseudocode:**
```typescript
const BATCH = 500

// Only fetch IDs that are listed on TokenWorks
const { data: listings } = await supabase
  .from('vv_checks_listings')
  .select('token_id')
  .eq('source', 'tokenworks')

const allIds = listings.map(l => l.token_id)

for (let start = 0; start < allIds.length; start += BATCH) {
  const ids = allIds.slice(start, start + BATCH)

  const [uriResults, checkResults, ownerResults] = await Promise.all([
    batchCall(ids, 'tokenURI'),
    batchCall(ids, 'getCheck'),
    batchCall(ids, 'ownerOf'),
  ])

  const rows = ids.map((id, i) => {
    if (ownerResults[i].status === 'rejected') return null  // token doesn't exist
    const owner = ownerResults[i].value as string
    const isBurned = owner === '0x0000000000000000000000000000000000000000'
    const parsed = parseTokenURI(uriResults[i].value)
    const checkStruct = checkResults[i].value

    return {
      token_id: id,
      owner,
      is_burned: isBurned,
      checks_count: getAttr(parsed.attributes, 'Checks'),
      color_band:   getAttr(parsed.attributes, 'Color Band'),
      gradient:     getAttr(parsed.attributes, 'Gradient'),
      speed:        getAttr(parsed.attributes, 'Speed'),
      shift:        getAttr(parsed.attributes, 'Shift') ?? null,
      svg:          parsed.svg,
      check_struct: checkStruct,
    }
  }).filter(Boolean)

  await supabase.from('checks').upsert(rows, { onConflict: 'token_id' })
}
```

**Runtime estimate:** ~16,384 tokens ÷ 500 batch = 33 batches. With Alchemy multicall, ~33 HTTP requests. Should complete in under 2 minutes.

---

## Phase 2 — Alchemy Webhook → Supabase Edge Function

**What triggers it:** Any activity on the Checks contract address.

**Setup in Alchemy:**
1. Dashboard → Notify → Create Webhook
2. Type: **Address Activity**
3. Address: `0x036721e5a769cc48b3189efbb9cce4471e8a48b1`
4. Network: Ethereum Mainnet
5. Webhook URL: `https://<project>.supabase.co/functions/v1/checks-webhook`

**What to watch for:**
- `Transfer(from, to, tokenId)` where `to == address(0)` → token burned (composited as burner)
- `Transfer(from, to, tokenId)` where `from != address(0)` → ownership change
- After any composite event, the keeper token's `check_struct` changes — re-fetch it

**Edge Function logic (`supabase/functions/checks-webhook/index.ts`):**
```typescript
// For each Transfer event in the webhook payload:
// 1. If to == address(0): mark token burned, find keeper via simulateComposite
//    context and re-fetch keeper's check_struct
// 2. If ownership change: update owner field
// 3. Re-fetch token_uri + getCheck for affected tokens
// 4. Upsert into checks table
// 5. Insert sync_log entry

// Note: Alchemy webhook includes the transaction logs. Parse the Transfer
// event from the ERC721 ABI to extract tokenId, from, to.
```

**Edge Function location:** `supabase/functions/checks-webhook/index.ts`

**Deploy:** `supabase functions deploy checks-webhook`

---

## Phase 3 — Permutation Script

**What it does:** Reads all active (non-burned) tokens from `checks` table, groups by `checks_count`, computes all P(n,4) permutations using the existing JS engine, inserts into `permutations` table.

**Location:** `backend/scripts/compute-permutations.ts`

**Reuses:** `simulateCompositeJS`, `generateSVGJS`, `mapCheckAttributes` from `frontend/src/checksArtJS.ts` and `frontend/src/utils.ts` — extract to a shared `packages/engine/` or import directly.

**Approach:**
```typescript
// 1. Load only TokenWorks-listed tokens, grouped by checks_count
//    Uses the listed_checks view (checks JOIN vv_checks_listings WHERE source='tokenworks')
const groups = await supabase
  .from('listed_checks')
  .select('token_id, checks_count, check_struct')
  .order('checks_count')

// 2. Group by checks_count
const byCount = groupBy(groups.data, row => row.check_struct.stored.divisorIndex)

// 3. For each group, generate all P(n,4) ordered 4-tuples
for (const [divisorIndex, tokens] of Object.entries(byCount)) {
  const n = tokens.length
  if (n < 4) continue

  const BATCH_SIZE = 1000
  const batch: PermutationRow[] = []

  for (const [p0, p1, p2, p3] of orderedQuadruples(tokens)) {
    const l1aStruct = simulateCompositeJS(p0.check_struct, p1.check_struct)
    const l1bStruct = simulateCompositeJS(p2.check_struct, p3.check_struct)

    const l1aRenderMap = new Map([[l1aStruct.composite, p1.check_struct]])
    const l1bRenderMap = new Map([[l1bStruct.composite, p3.check_struct]])

    // L2: same logic as computeL2JS in useAllPermutations.ts
    const abcdStruct = computeL2(l1aStruct, l1bStruct)
    const abcdRenderMap = buildL2RenderMap(l1aStruct, l1bStruct, p1, p3)

    batch.push({
      keeper_1_id:     p0.token_id,
      burner_1_id:     p1.token_id,
      keeper_2_id:     p2.token_id,
      burner_2_id:     p3.token_id,
      l1a_svg:         generateSVGJS(l1aStruct, l1aRenderMap),
      l1b_svg:         generateSVGJS(l1bStruct, l1bRenderMap),
      abcd_svg:        generateSVGJS(abcdStruct, abcdRenderMap),
      abcd_checks:     mapCheckAttributes(abcdStruct).find(a => a.trait_type === 'Checks')?.value,
      abcd_color_band: mapCheckAttributes(abcdStruct).find(a => a.trait_type === 'Color Band')?.value,
      abcd_gradient:   mapCheckAttributes(abcdStruct).find(a => a.trait_type === 'Gradient')?.value,
      abcd_speed:      mapCheckAttributes(abcdStruct).find(a => a.trait_type === 'Speed')?.value,
      abcd_shift:      mapCheckAttributes(abcdStruct).find(a => a.trait_type === 'Shift')?.value ?? null,
    })

    if (batch.length >= BATCH_SIZE) {
      await supabase.from('permutations')
        .upsert(batch, { onConflict: 'keeper_1_id,burner_1_id,keeper_2_id,burner_2_id', ignoreDuplicates: true })
      batch.length = 0
    }
  }

  if (batch.length > 0) {
    await supabase.from('permutations')
      .upsert(batch, { onConflict: 'keeper_1_id,burner_1_id,keeper_2_id,burner_2_id', ignoreDuplicates: true })
  }
}
```

**Stale permutation cleanup:** After a Composite event, permutations involving the burned token should be deleted:
```sql
DELETE FROM permutations
WHERE burner_1_id = $burned_token_id
   OR burner_2_id = $burned_token_id;
-- Permutations where the burned token was a keeper remain valid
-- (the keeper token still exists, just with updated check_struct)
-- Re-run permutation script for affected keeper to refresh its rows.
```

---

## Phase 4 — Client Integration (future)

Replace the viem-based `useAllPermutations` hook with a Supabase query:

```typescript
// Instead of computing permutations on the client:
const { data } = await supabase
  .from('permutations')
  .select(`
    keeper_1_id, burner_1_id, keeper_2_id, burner_2_id,
    l1a_svg, l1b_svg, abcd_svg,
    abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift,
    keeper_1:checks!keeper_1_id(svg, check_struct),
    burner_1:checks!burner_1_id(svg, check_struct),
    keeper_2:checks!keeper_2_id(svg, check_struct),
    burner_2:checks!burner_2_id(svg, check_struct)
  `)
  .eq('abcd_checks', filters.checks || undefined)
  .range(offset, offset + PAGE_SIZE)
```

The `InfiniteGrid` component already handles pagination via `IntersectionObserver` — wire Supabase pagination to the scroll position.

---

## Implementation Order

| Step | What | Where |
|------|------|--------|
| 1 | Run SQL in Supabase SQL Editor | Supabase dashboard |
| 2 | Add Supabase env vars to backend `.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| 3 | Extract JS engine to shared module | `packages/engine/` or `backend/lib/engine.ts` |
| 4 | Write + run backfill script | `backend/scripts/backfill.ts` |
| 5 | Deploy Alchemy webhook + Edge Function | Alchemy dashboard + `supabase functions deploy` |
| 6 | Write + run permutation script | `backend/scripts/compute-permutations.ts` |
| 7 | Verify data in Supabase table viewer | Supabase dashboard |
| 8 | Wire frontend to Supabase queries | `frontend/src/useAllPermutations.ts` |

---

## Daily Cron Integration

`vv_checks_listings` is already updated daily. Hook into that cycle to keep `checks` and `permutations` fresh:

```
existing daily cron
    └── updates vv_checks_listings
            └── trigger (Supabase DB trigger or cron step):
                    ├── 1. find token_ids newly added to tokenworks listings
                    │       → run backfill for those IDs only
                    ├── 2. find token_ids removed from tokenworks listings
                    │       → DELETE FROM permutations WHERE keeper_1_id = $id OR ...
                    │         (their checks row stays — don't delete on-chain data)
                    └── 3. rerun permutation script for affected checks_count groups
```

**Option A — Supabase DB trigger on `vv_checks_listings`:**
```sql
-- Fires after each daily upsert, enqueues a pg_net HTTP call to an Edge Function
CREATE OR REPLACE FUNCTION sync_listed_checks()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url := current_setting('app.sync_edge_fn_url'),
    body := json_build_object('token_id', NEW.token_id, 'source', NEW.source)::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_listing_change
AFTER INSERT OR UPDATE ON vv_checks_listings
FOR EACH ROW EXECUTE FUNCTION sync_listed_checks();
```

**Option B — Add a step to the existing cron job** (simpler, no trigger needed):
```bash
# After cron updates vv_checks_listings:
npx tsx backend/scripts/backfill.ts --incremental
npx tsx backend/scripts/compute-permutations.ts --incremental
# --incremental: only processes token_ids not in checks or with stale last_synced_at
```

Option B is simpler to start with. Upgrade to Option A when real-time freshness matters.

---

## Open Questions

1. **Max token ID:** What is the actual current max token ID on-chain? This bounds the backfill loop. Query `totalSupply()` on the contract.
2. **Large groups:** For 80-check tokens (likely 500+), P(n,4) is very large. Define a max group size for the initial permutation script run, or restrict to tokens active in the last N days.
3. **Supabase storage:** SVG strings average ~5-15KB each. For 1M permutation rows × 3 SVGs × 10KB = 30GB. Consider storing only `abcd_svg` and recomputing `l1a_svg`/`l1b_svg` on-demand in the detail modal.
4. **Supabase plan:** Free tier has 500MB database storage. For scale, Pro tier (8GB) or larger will be needed.
