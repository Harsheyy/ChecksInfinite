# All Checks Market Explorer — Design Spec

**Date:** 2026-05-18  
**Status:** Approved

## Overview

Add a second browsing mode ("All Checks") that runs permutations across all 5,360 checks in the Checks VV market (not just the 693 TokenWorks-held checks). The page surfaces visually diverse 20-check composite outputs — one for every possible combination of 4 × 80-check market tokens — sampled nightly and refreshed each day so users see a rotating window of the combinatorial space.

---

## Goals

- Show 20-check composites from any 4 × 80-check market tokens, not just TokenWorks inventory
- Maximize visual diversity: weight rare-attribute tokens (One-band, gradient) higher in nightly sampling so they appear proportionally more than their ~5% market share
- Keep storage flat: reduce tokenstr permutations from 500K → 100K; add 500K market permutations; net ~330 MB total (less than today's 500K alone at ~275 MB)
- All Checks tab is wallet-gated (any connected wallet unlocks it)
- Prices shown for both tokenstr (from contract) and market checks (from OpenSea/Blur)
- Checks data stays fresh in real-time via webhooks; permutations refresh nightly

---

## Database

### Migration 015 — rename + extend `tokenstr_checks`

Rename to `all_checks`. PostgreSQL FK constraints follow the rename by OID — no FK surgery needed anywhere.

Add three columns:
- `is_tokenstr boolean NOT NULL DEFAULT false` — true for the 693 TokenWorks-held tokens
- `price_source text` — `'contract'` | `'opensea'` | `'blur'` | null
- `is_listed boolean NOT NULL DEFAULT false`

Backfill existing 693 rows: `is_tokenstr = true`, `price_source = 'contract'`.

Add indexes: `idx_all_checks_is_tokenstr`, `idx_all_checks_is_listed`.

### Migration 016 — `all_permutations` table

New table, same shape as `permutations` but:
- References `all_checks(token_id)` on all four FK columns
- Adds `color_family smallint` — the dominant hue bucket of the output (`colorIndexes()[0] / 10`, range 0–7)
- No `rank_score` (replaced by weighted sampling at generation time)

Cap: **500K rows**, refreshed nightly via truncate + repopulate.

Storage estimate: 500K rows × ~550 bytes (heap + indexes) = ~275 MB.

### `permutations` table (existing)

Reduce `MAX_PERMS_PER_GROUP` from 500,000 → 100,000 in `populate-ranked-permutations.ts`.  
Cap: **100K rows**. Storage: ~55 MB.

Add `WHERE is_tokenstr = true` guard to the initial load query so it never accidentally pulls market checks after migration.

---

## Sync Layer

### Existing code — `tokenstr_checks` → `all_checks`

**Edge functions** (string replace):
- `supabase/functions/sync-tokenstr/index.ts` (4 references)
- `supabase/functions/tokenstr-webhook/index.ts` (3 references)
- `supabase/functions/checks-webhook/index.ts` (2 references)

**Backend scripts** (string replace + add `is_tokenstr` filter):
- `backend/scripts/populate-ranked-permutations.ts` — replace table name + add `WHERE is_tokenstr = true` to initial load
- `backend/scripts/backfill.ts` (2 references)
- `backend/scripts/backfill-prices.ts` (3 references)

**Frontend** (string replace):
- `frontend/src/usePermutationsDB.ts` (3 references — fetchCheckStructMap and price bounds)
- `frontend/src/useCuratedOutputs.ts` (1 reference)
- `frontend/src/components/TreePanel.tsx` (1 reference)
- `frontend/src/App.tsx` (1 comment reference)

**Stored SQL functions** — must be recreated in migration 015 because PostgreSQL resolves table names in function bodies at execution time, not definition time; renaming the table does NOT auto-update function bodies:
- `update_permutation_costs` — references `tokenstr_checks` in FROM clause (migration 008)
- `backfill_permutation_costs` — same

Note: `get_curated_outputs`, `toggle_like`, and `get_my_liked_keys` do NOT reference `tokenstr_checks` — they are safe.

### New: `sync-market-checks` edge function

One-time backfill + periodic refresh (weekly or on-demand).

Flow:
1. Call Alchemy `getNFTsForContract` on the Checks VV contract (`0x036721e5a769cc48b3189efbb9cce4471e8a48b1`) to enumerate all token IDs
2. Batch-call `getCheck(tokenId)` via viem **Multicall3** (all calls in one RPC round-trip, or batches of 1,000 if over limit)
3. Parse `check_struct`, derive `checks_count`, `color_band`, `gradient`, `speed`, `shift` from the struct
4. Upsert into `all_checks` with `is_tokenstr = false` (skip or mark correctly if token is owned by tokenstr wallet)
5. Mark burned tokens (`is_burned = true`) for any IDs no longer in the contract

### New: `sync-market-prices` edge function

Daily price sync for non-tokenstr checks.

Flow:
1. Query `all_checks WHERE is_tokenstr = false AND is_burned = false`
2. For each token: call OpenSea v2 listings API + Blur listings API
3. Take the lower price; set `eth_price`, `price_source`, `is_listed`
4. Tokens with no listing: `is_listed = false`, `eth_price = null`

Requires `OPENSEA_API_KEY` env var (user to provide).

### Real-time: webhook on Checks VV contract events

When a check is minted or composited, the existing `checks-webhook` (or a new Alchemy webhook subscription on the Checks VV contract) fires:
1. Fetch the new/changed token via `getCheck(tokenId)`
2. Upsert into `all_checks`
3. Mark burned tokens as `is_burned = true`

Permutations are **not** updated in real-time — the nightly batch picks up the change next run.

---

## Backend Script — `populate-market-permutations.ts`

Nightly truncate + repopulate for `all_permutations`.

**Algorithm:**
1. Load all non-burned 80-check tokens from `all_checks`
2. Assign selection weights by `color_band`: One → 10, Five → 8, Ten → 6, Twenty → 4, Forty → 3, Sixty → 2, Eighty → 1
3. Build a weighted-shuffled pool of tokens
4. Enumerate 4-tuples (i0, i1, i2, i3) from the shuffled pool, skipping repeated tokens
5. For each 4-tuple: compute L1a, L1b, ABCD using the JS engine
6. Compute `color_family = colorIndexes(abcdStruct.stored.divisorIndex, abcdStruct, virtualMap)[0] / 10 | 0`
7. Insert row; stop when 500K rows committed
8. Flush in batches of 500

**Cron:** Nightly at 02:00 UTC, separate from the existing tokenstr cron (which runs at a different time).

---

## Frontend

### Navbar

Add "All Checks" tab alongside "Token Works".  
- If wallet not connected: tab is visible but clicking shows a "Connect wallet to explore" prompt  
- If connected: loads `all_permutations` browse experience

### New hook: `useAllChecksPermutations`

Mirrors `usePermutationsDB` but queries `all_permutations`:
- Random page of 2,500 rows (ORDER BY rand_key, range offset)
- Fetches `check_struct` for all 4 token IDs via `fetchCheckStructMap` (hits `all_checks`, same function after rename)
- Uses same `computeAllNodes` + `rowToPermutationResult` pattern
- Shuffle re-queries with a new random offset

### FilterBar

Same five filters (Checks, Color Band, Gradient, Speed, Shift). Price filter enabled.

### Price display (TreePanel)

Show per-token price with source label:
- `is_tokenstr = true`: existing "Buy on TokenWorks" behavior
- `price_source = 'opensea'`: "X ETH (OpenSea)"
- `price_source = 'blur'`: "X ETH (Blur)"
- `is_listed = false`: no price shown

### `App.tsx`

Add `viewMode = 'all-checks'` alongside existing modes. Wire up `useAllChecksPermutations`. All Checks tab hidden until wallet connected (same `isConnected` guard used elsewhere).

---

## What Doesn't Change

- Token Works tab: identical to today
- My Checks tab: identical
- Curated Checks tab: identical
- Explore tab: identical
- All existing curated_outputs / toggle_like / get_curated_outputs RPCs: work unchanged after table rename
- TreePanel, PermutationCard, InfiniteGrid, FilterBar components: no changes needed

---

## Storage Summary

| Table | Rows | Est. Storage |
|---|---|---|
| `all_checks` | ~5,360 | ~11 MB |
| `permutations` (tokenstr) | 100K | ~55 MB |
| `all_permutations` (market) | 500K | ~275 MB |
| `curated_outputs` | existing | unchanged |
| **Total new footprint** | | **~341 MB** |

Previous footprint: ~275 MB (`permutations` at 500K). Net change: +66 MB for full market coverage.
