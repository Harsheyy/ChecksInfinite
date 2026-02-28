# Checks Infinite — Codebase Reference

## Project Overview

Checks Infinite is a tool for exploring composite permutations of [Checks VV](https://checks.art) NFTs. Given a set of Checks tokens, it computes every valid 2-level composite tree (A+B → L1a, C+D → L1b, L1a+L1b → ABCD) and displays the results in an infinite scrollable grid. The app supports two modes:

- **Chain mode** — user enters token IDs; data is fetched live from Ethereum via Alchemy
- **DB mode** — permutations are precomputed and stored in Supabase; the frontend just queries

---

## Directory Structure

```
Infinite/
├── frontend/          React app (Vite + TypeScript)
│   └── src/
│       ├── App.tsx                     Root component, mode switching
│       ├── main.tsx                    React entry point
│       ├── index.css                   All styles
│       ├── client.ts                   Viem Ethereum RPC client
│       ├── checksAbi.ts                Checks contract ABI fragments
│       ├── checksArtJS.ts              JS port of ChecksArt.sol (rendering engine)
│       ├── utils.ts                    Types, parseTokenURI, mapCheckAttributes
│       ├── supabaseClient.ts           Supabase JS client (DB mode)
│       ├── useAllPermutations.ts       Chain mode hook (fetch + compute on client)
│       ├── usePermutationsDB.ts        DB mode hook (query Supabase)
│       └── components/
│           ├── Navbar.tsx              Top bar: token input (chain) or count (DB)
│           ├── FilterBar.tsx           5 dropdowns: Checks/ColorBand/Gradient/Speed/Shift
│           ├── InfiniteGrid.tsx        Torus infinite scroll grid of PermutationCards
│           ├── PermutationCard.tsx     Single card showing the ABCD composite SVG
│           ├── CheckCard.tsx           Reusable card: SVG + attribute list
│           └── TreeModal.tsx           Full composite tree overlay on card click
│
├── backend/           Node.js scripts (tsx, no bundler)
│   ├── .env.example                   Required env vars template
│   ├── package.json                   Scripts: backfill, compute-permutations
│   ├── tsconfig.json
│   ├── lib/
│   │   └── engine.ts                  Backend port of checksArtJS + utils (Buffer-safe)
│   └── scripts/
│       ├── backfill.ts                Fetch checks from chain → Supabase checks table
│       └── compute-permutations.ts    Compute P(n,4) attributes → permutations table
│
├── supabase/
│   ├── functions/
│   │   └── checks-webhook/
│   │       └── index.ts               Deno edge function: Alchemy → checks table sync
│   └── migrations/
│       ├── 001_checks_backend.sql     Base schema: checks, permutations, listed_checks, sync_log
│       ├── 002_permutations_nullable_svgs.sql  (superseded by 003)
│       └── 003_drop_abcd_svg.sql      Drop SVG columns; truncate; switch to client-side render
│
├── Source/            Solidity source files (reference only, not compiled here)
│   └── *.sol          checks.sol, ChecksArt.sol, ChecksMetadata.sol, etc.
│
└── docs/
    ├── plans/         Implementation plan markdown files
    └── codebase.md    This file
```

---

## Frontend

### `src/main.tsx`
Entry point. Mounts `<App>` inside React `StrictMode`.

---

### `src/App.tsx`
Root component. Detects mode via `hasSupabase()` and renders the right data source.

**DB mode behaviour:**
- On mount → `load(emptyFilters())`
- On filter change → `load(filters)` (server-side filtering)
- `IntersectionObserver` on a 1px sentinel div at the bottom → calls `loadMore()` to paginate
- `Navbar` shows permutation count instead of token ID input

**Chain mode behaviour:**
- User types token IDs → `handlePreview()` validates and calls `preview(ids)`
- Filters applied client-side via `matchesFilters()`

**Key state:**
| Variable | Type | Purpose |
|---|---|---|
| `idsRaw` | `string` | Raw comma-separated token ID input |
| `filters` | `Filters` | Active filter values for all 5 dropdowns |
| `chainState` | `AllPermutationsState` | All permutation results from chain hook |
| `dbState` | `DBPermutationsState` | Paginated results from DB hook |

---

### `src/client.ts`
Creates the viem `PublicClient` for Ethereum mainnet.

```typescript
export const checksClient   // viem PublicClient with multicall batching enabled
export const CHECKS_CONTRACT  // '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
export function hasAlchemyKey(): boolean
```

Uses `VITE_ALCHEMY_API_KEY` from `.env`. Multicall batching is on by default — all `readContract` calls in the same tick are batched into a single `eth_call` to Multicall3.

---

### `src/checksAbi.ts`
ABI fragments for 4 contract functions used by the app:

| Function | Signature | Used for |
|---|---|---|
| `tokenURI(uint256)` | → `string` | Base64-encoded JSON with SVG + attributes |
| `getCheck(uint256)` | → `CheckStruct` | Full stored check state for JS engine |
| `simulateComposite(uint256, uint256)` | → `CheckStruct` | On-chain L1 composite simulation (chain mode) |
| `simulateCompositeSVG(uint256, uint256)` | → `string` | Not currently used |

---

### `src/utils.ts`
Pure utility functions and shared types.

**Types:**
```typescript
interface Attribute { trait_type: string; value: string }
interface ParsedTokenURI { name: string; svg: string; attributes: Attribute[] }
interface CheckStruct { stored: { composites, colorBands, gradients, divisorIndex, epoch, seed, day }, isRevealed, seed: bigint, checksCount, hasManyChecks, composite, isRoot, colorBand, gradient, direction, speed }
interface CardState { name: string; svg: string; attributes: Attribute[]; loading: boolean; error: string }
```

**Functions:**
```typescript
parseTokenURI(dataUri: string): ParsedTokenURI
// Decodes a data:application/json;base64,... URI → { name, svg, attributes }
// Uses atob() — browser only. Backend uses Buffer.from() version in engine.ts.

mapCheckAttributes(check: CheckStruct): Attribute[]
// Converts CheckStruct fields to display attributes array.
// Only includes Color Band / Gradient if hasManyChecks; Speed/Shift if checksCount > 0.

colorBandName(index: number): string   // 0–6 → 'Eighty'…'One'
gradientName(index: number): string    // 0–6 → 'None'…'Linear Z'
formatSpeed(speed: number): string     // 4→'2x', 2→'1x', 1→'0.5x'
formatShift(direction: number): string // 0→'IR', 1→'UV'
parseIds(raw: string): string[]        // "1,2, 3" → ["1","2","3"]
validateIds(ids, hasKey): string       // returns error string or ''
```

---

### `src/checksArtJS.ts`
**The rendering engine** — a faithful JS port of `ChecksArt.sol` and `Utilities.sol`. Every function mirrors its Solidity counterpart exactly (except `minGt0` which fixes an on-chain bug).

**Constants:**
```typescript
DIVISORS   // [80, 40, 20, 10, 5, 4, 1, 0] — checks count at each divisorIndex
COLOR_BANDS // [80, 60, 40, 20, 10, 5, 1] — palette sizes
GRADIENTS_TABLE // [0, 1, 2, 5, 8, 9, 10] — gradient step sizes
EIGHTY_COLORS   // 80 hex color strings — the full checks palette
```

**Core functions:**

```typescript
random(input: bigint, max: bigint): bigint
// keccak256(abi.encodePacked(uint256)) % max

randomSalted(input: bigint, salt: string, max: bigint): bigint
// keccak256(abi.encodePacked(uint256, string)) % max

simulateCompositeJS(keeper: CheckStruct, burner: CheckStruct, burnerVirtualId: number): CheckStruct
// Produces the CheckStruct that results from compositing keeper+burner.
// burnerVirtualId: the virtual map key to store in composites[divisorIndex].
//   → For L1: use the burner's actual token ID
//   → For L2: use CD_VIRTUAL_ID (65535)

colorIndexes(divisorIndex, check, virtualMap): number[]
// Resolves each check's color index array by recursively traversing the composite tree.
// virtualMap maps composite pointer values → their CheckStructs.

generateSVGJS(check: CheckStruct, virtualMap: Map<number, CheckStruct>): string
// Produces the full animated SVG string for a check.
// Mirrors ChecksArt.generateSVG exactly.

colorBandIndex(check, divisorIndex): number
computeGenesJS(keeper, burner): { gradient, colorBand }
gradientIndex(check, divisorIndex): number

// L2 helpers (added for DB mode):
CD_VIRTUAL_ID = 65535
computeL2(l1a, l1b): CheckStruct
// Wires l1a's composite pointer to CD_VIRTUAL_ID, then simulateCompositeJS(l1a, l1b, CD_VIRTUAL_ID)

buildL2RenderMap(l1a, l1b, burner1, burner2): Map<number, CheckStruct>
// Returns the virtualMap needed by generateSVGJS for the ABCD composite:
// { CD_VIRTUAL_ID → l1b, l1a.composite → burner1, l1b.composite → burner2 }
```

---

### `src/supabaseClient.ts`
```typescript
export const supabase  // SupabaseClient | null (null if env vars not set)
export function hasSupabase(): boolean
```
Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`. When either is missing, `supabase` is `null` and the app falls back to chain mode.

---

### `src/useAllPermutations.ts`
**Chain mode hook.** All data comes from Ethereum RPC.

**Types:**
```typescript
interface PermutationDef {
  indices: [number, number, number, number]  // indexes into the global ids[] array
  label: string                              // "#A▸#B, #C▸#D"
  tokenIds?: [string, string, string, string] // DB mode: embedded token IDs
}

interface PermutationResult {
  def: PermutationDef
  nodeA, nodeB, nodeC, nodeD: CardState  // leaf tokens
  nodeL1a, nodeL1b: CardState            // L1 composites
  nodeAbcd: CardState                    // final ABCD composite
}
```

**`preview(ids: string[])` — two-phase fetch:**

Phase 1 (parallel multicall):
- `tokenURI × n` → leaf card SVGs + attributes
- `getCheck × n` → CheckStructs for JS computation
- Updates UI with leaf cards immediately

Phase 2 (parallel multicall):
- `simulateComposite × n(n-1)` ordered pairs → all L1 CheckStructs
- Builds L1 SVGs via `generateSVGJS` (no additional RPC needed)
- Computes ABCD via `computeL2JS` (local function, same logic as `computeL2` in checksArtJS)
- Updates all permutation results

**`generatePermDefs(ids)`** — generates all P(n,4) ordered 4-tuples as `PermutationDef[]`.

---

### `src/usePermutationsDB.ts`
**DB mode hook.** Queries the Supabase `permutations` table.

**`load(filters)`** — initial load / filter change:
- Resets state, queries page 0
- Server-side filter pushdown (all 5 attributes)
- Converts rows → `PermutationResult[]` via `rowToPermutationResult`

**`loadMore()`** — pagination:
- Fetches next PAGE_SIZE (100) rows from `offsetRef.current`
- Appends to existing permutations

**`rowToPermutationResult(row)`** — converts a Supabase row to `PermutationResult`:
- Uses `checks.svg` (pre-fetched via join) for nodeA/B/C/D
- Calls `computeAllNodes(row)` for L1a, L1b, ABCD SVGs

**`computeAllNodes(row)`** — client-side SVG computation:
```
k1, b1 = fromJSON(keeper_1.check_struct), fromJSON(burner_1.check_struct)
k2, b2 = fromJSON(keeper_2.check_struct), fromJSON(burner_2.check_struct)
l1a = simulateCompositeJS(k1, b1, burner_1_id)
l1b = simulateCompositeJS(k2, b2, burner_2_id)
abcd = computeL2(l1a, l1b)
→ generateSVGJS for each
```

**`fromJSON(CheckStructJSON)`** — deserializes from Supabase: converts `seed` string → `BigInt`.

**Supabase query shape:**
```sql
SELECT keeper_1_id, burner_1_id, keeper_2_id, burner_2_id,
       abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift,
       keeper_1:checks!keeper_1_id(svg, check_struct),
       burner_1:checks!burner_1_id(svg, check_struct),
       keeper_2:checks!keeper_2_id(svg, check_struct),
       burner_2:checks!burner_2_id(svg, check_struct)
FROM permutations
[WHERE abcd_checks=? AND ...]
RANGE(offset, offset+99)
```

---

## Components

### `Navbar.tsx`
Fixed top bar (48px height).
- **Chain mode:** Token ID text input + "Preview →" submit button
- **DB mode:** Shows `"{total} permutations"` count (no input)
- Shows error string below the form when set

### `FilterBar.tsx`
5 `<select>` dropdowns: Checks, Color Band, Gradient, Speed, Shift.

```typescript
export function matchesFilters(attributes: Attribute[], filters: Filters): boolean
// Used in chain mode for client-side filtering.
// AND logic: all active filters must match. Missing attributes pass all filters.
```

In DB mode, filters are applied server-side in the Supabase query — `matchesFilters` is not called.

### `InfiniteGrid.tsx`
**Torus infinite scroll** — renders a 3×3 grid of identical `GridTile` instances. On scroll, the viewport teleports by one tile dimension when the edge is crossed, creating the illusion of infinite content.

- Center tile gets `divRef` (used to measure tile dimensions)
- `handleScroll` — if `scrollLeft < tileWidth`, jump forward by tileWidth; if `scrollLeft >= 2×tileWidth`, jump back
- On `permutations.length` change: scroll to center tile
- Click on a card → sets `selectedIndex` → renders `TreeModal`

### `PermutationCard.tsx`
Single card in the grid. Shows the ABCD composite SVG.

- `visible=false` → renders a transparent spacer div (preserves grid layout, no rendering cost)
- `IntersectionObserver` → lazy-loads SVG only when card enters viewport (+ 200px margin)
- Renders loading pulse / error ✕ / SVG once in view

### `CheckCard.tsx`
Reusable display card with optional label. Shows:
- Loading state text
- Error text
- Name (`<h2>`), SVG (`dangerouslySetInnerHTML`), attributes (`<dl>`)

### `TreeModal.tsx`
Full-screen overlay showing the complete composite tree for a selected permutation.

Layout (3 rows):
```
Row 1: [Keeper A] [Burn B]     [Keeper C] [Burn D]
Row 2:     [L1a composite]         [L1b composite]
Row 3:           [ABCD final composite]
```

Labels come from `def.tokenIds` (DB mode) or `ids[def.indices[i]]` (chain mode).
Close: click overlay, click ✕ button, or press Escape.

---

## Backend Scripts

### `backend/lib/engine.ts`
Node.js port of `checksArtJS.ts` + `utils.ts`. Identical logic, two differences:
1. `parseTokenURI` uses `Buffer.from(base64, 'base64')` instead of `atob()`
2. Exports `CheckStructJSON` type + serialization helpers for Supabase

```typescript
checkStructToJSON(c: CheckStruct): CheckStructJSON
// Converts bigint seed → string for safe JSON/jsonb storage

checkStructFromJSON(j: CheckStructJSON): CheckStruct
// Converts string seed → BigInt; restores full CheckStruct
```

Everything else (`simulateCompositeJS`, `generateSVGJS`, `colorIndexes`, etc.) is identical to the frontend version.

### `backend/scripts/backfill.ts`
Populates the `checks` table from on-chain data.

**Flow:**
1. Query `vv_checks_listings` WHERE `source = 'tokenworks'` → get token IDs
2. In `--incremental` mode: skip tokens with `last_synced_at > 24h ago`
3. For each batch of 500:
   - **Phase A (multicall client):** `ownerOf` + `getCheck` for all 500 — cheap, aggregate fine
   - **Phase B (direct client, 20 concurrent):** `tokenURI` for valid tokens only — expensive SVG gen on-chain, must NOT use multicall (gas limit: 550M; each tokenURI ~2M gas)
4. Build row objects, upsert to `checks` table

**Two viem clients:**
- `viemClient` — `batch: { multicall: true }` — for cheap calls
- `viemClientDirect` — no multicall — for `tokenURI`

**Run:**
```bash
cd backend && npm run backfill
npm run backfill:incremental  # skip recently synced
```

### `backend/scripts/compute-permutations.ts`
Generates all P(n,4) composite attribute combinations.

**Flow:**
1. Load `listed_checks` view (joins `checks` + `vv_checks_listings`)
2. Group by `checks_count` (only tokens with same count can be composited)
3. Cap each group at `MAX_GROUP_SIZE` (default 30) to limit P(n,4) scale
4. For each ordered 4-tuple (p0, p1, p2, p3):
   - `simulateCompositeJS(p0, p1, p1.id)` → L1a
   - `simulateCompositeJS(p2, p3, p3.id)` → L1b
   - `computeL2(L1a, L1b)` → ABCD
   - `mapCheckAttributes(ABCD)` → extract 5 attribute values
5. Batch-upsert to `permutations` (50 rows/batch to avoid statement timeout)

**SVGs are NOT stored** — computed client-side when displayed. This keeps rows ~150B each vs ~10KB with SVGs.

**Run:**
```bash
npm run compute-permutations
npm run compute-permutations:incremental  # skip already-computed rows
MAX_GROUP_SIZE=10 npm run compute-permutations  # small test run
```

---

## Supabase

### Schema

**`checks` table** — one row per on-chain token
```sql
token_id        bigint PRIMARY KEY
owner           text
is_burned       boolean DEFAULT false
checks_count    smallint          -- 1|5|10|20|40|80
color_band      text              -- 'Eighty'…'One'
gradient        text              -- 'None'…'Linear Z'
speed           text              -- '0.5x'|'1x'|'2x'
shift           text              -- 'IR'|'UV'|null
svg             text              -- pre-rendered SVG from tokenURI
check_struct    jsonb             -- full CheckStruct (seed as string)
last_synced_at  timestamptz
created_at      timestamptz
```

**`permutations` table** — one row per ordered (keeper1, burner1, keeper2, burner2) 4-tuple
```sql
id              bigserial PRIMARY KEY
keeper_1_id     bigint REFERENCES checks
burner_1_id     bigint REFERENCES checks
keeper_2_id     bigint REFERENCES checks
burner_2_id     bigint REFERENCES checks
abcd_checks     smallint
abcd_color_band text
abcd_gradient   text
abcd_speed      text
abcd_shift      text
computed_at     timestamptz
UNIQUE(keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
```
No SVG columns — all SVGs computed client-side from `check_struct` data.

**`listed_checks` view**
```sql
SELECT checks.* FROM checks
JOIN vv_checks_listings ON vv_checks_listings.token_id = checks.token_id::text
WHERE source = 'tokenworks' AND NOT is_burned
```

**`sync_log` table** — audit trail for script runs
```sql
id, job ('backfill'|'permutations'|'webhook'), status ('running'|'done'|'error'),
tokens_processed, perms_computed, error_message, started_at, finished_at
```

### Edge Function: `checks-webhook`
Deno function deployed to Supabase. Receives Alchemy "Address Activity" webhooks for the Checks contract.

**Trigger:** Any Transfer event on `0x036721e5a769cc48b3189efbb9cce4471e8a48b1`

**Logic:**
- Verifies Alchemy HMAC signature (`WEBHOOK_SIGNING_KEY`)
- Parses `Transfer(from, to, tokenId)` events from log topics
- `to == 0x0` → mark token burned, delete permutations where it was a burner
- Otherwise → re-fetch `ownerOf` + `tokenURI` + `getCheck` via raw JSON-RPC, upsert to `checks`
- Logs to `sync_log`

**Deploy:** `supabase functions deploy checks-webhook`

**Required secrets:**
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALCHEMY_API_KEY, WEBHOOK_SIGNING_KEY
```

---

## Data Flow

### Chain Mode (live, no Supabase)
```
User enters IDs
  → useAllPermutations.preview(ids)
      Phase 1: tokenURI × n + getCheck × n (multicall)
      → leaf CardStates rendered
      Phase 2: simulateComposite × n(n-1) (multicall)
      → L1 SVGs via generateSVGJS (JS, no RPC)
      → ABCD SVGs via computeL2 + generateSVGJS (JS, no RPC)
  → InfiniteGrid renders all PermutationResults
```

### DB Mode (Supabase-backed)
```
App loads → usePermutationsDB.load(emptyFilters())
  → Supabase query: permutations JOIN checks × 4 (with joins for check_struct + svg)
  → rowToPermutationResult × PAGE_SIZE
      checks.svg → nodeA/B/C/D (pre-stored)
      computeAllNodes: simulateCompositeJS × 2 + computeL2 + generateSVGJS × 3 (JS)
  → InfiniteGrid renders results
  → scroll to bottom → loadMore() → next page

Filter change → load(newFilters)
  → Supabase: WHERE abcd_checks=? AND ... (server-side)
  → fresh results replace previous page
```

### Backfill Pipeline (one-time + cron)
```
vv_checks_listings (external, daily cron)
  → backfill.ts reads token IDs WHERE source='tokenworks'
      ownerOf + getCheck via multicall (batch 500)
      tokenURI via direct parallel eth_call (concurrent 20)
  → checks table

checks table
  → compute-permutations.ts reads listed_checks view
      groups by checks_count
      simulateCompositeJS × 2 per tuple (JS only, no RPC)
      computeL2 (JS only)
      mapCheckAttributes → 5 attribute values
  → permutations table (50 rows/batch)

Transfer events on-chain
  → Alchemy webhook → checks-webhook edge function
  → updates checks table (owner, is_burned, check_struct)
  → deletes stale permutation rows for burned tokens
```

---

## Environment Variables

**`frontend/.env`**
```
VITE_ALCHEMY_API_KEY=    # RPC key (chain mode)
VITE_SUPABASE_URL=       # Supabase project URL (DB mode, optional)
VITE_SUPABASE_ANON_KEY=  # Supabase anon key (DB mode, optional)
```

**`backend/.env`** (copy from `.env.example`)
```
SUPABASE_URL=            # Same Supabase project URL
SUPABASE_SERVICE_KEY=    # Service role key (full DB access)
ALCHEMY_API_KEY=         # RPC key for backfill script
```

**Supabase edge function secrets** (set via `supabase secrets set`)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ALCHEMY_API_KEY
WEBHOOK_SIGNING_KEY      # From Alchemy webhook settings
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| SVGs not stored in `permutations` | ~10KB/row × 657k rows = ~6.5GB. Computed client-side in ~1ms/SVG using the JS engine |
| `tokenURI` NOT multicalled | Each call generates SVG on-chain (~2M gas). 500 × 2M = 1B gas > 550M limit. Uses concurrent direct `eth_call` instead |
| `seed` stored as string in jsonb | `CheckStruct.seed` is `uint256` (bigint in JS). JSON.stringify loses precision on large ints. String survives the round-trip |
| `listed_checks` view not a materialized view | Re-evaluates against live `vv_checks_listings` automatically when the cron updates listings |
| `burnerVirtualId` parameter | The on-chain composite stores the burner's token ID in `composites[divisorIndex]`. The JS engine needs this to build the recursive color resolution map |
| DB mode filters server-side | With 657k+ rows, client-side filtering would require loading all rows. Supabase index on each attribute column makes server-side filters fast |
