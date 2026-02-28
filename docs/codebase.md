# Checks Infinite — Codebase Reference

## Project Overview

Checks Infinite is a tool for exploring composite permutations of [Checks VV](https://checks.art) NFTs. Given a set of Checks tokens, it computes every valid 2-level composite tree (A+B → L1a, C+D → L1b, L1a+L1b → ABCD) and displays the results in an infinite scrollable grid. The app supports two modes:

- **Chain mode** — user enters token IDs; data is fetched live from Ethereum via Alchemy
- **DB mode** — permutations are precomputed and stored in Supabase; the frontend queries and renders client-side SVGs

The inventory source is the **TokenStrategy wallet** (`0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc`), which holds all listed Checks NFTs. Transfers into/out of this wallet are synced in real-time via an Alchemy webhook.

---

## Directory Structure

```
Infinite/
├── frontend/          React app (Vite + TypeScript + wagmi)
│   └── src/
│       ├── App.tsx                     Root component, mode switching
│       ├── main.tsx                    React entry point (WagmiProvider + QueryClientProvider)
│       ├── index.css                   All styles
│       ├── wagmiConfig.ts              wagmi config (mainnet, injected connector, Alchemy RPC)
│       ├── tokenStrategyAbi.ts         ABI for TokenStrategy contract (nftForSale, sellTargetNFT)
│       ├── client.ts                   Viem Ethereum RPC client
│       ├── checksAbi.ts                Checks contract ABI fragments
│       ├── checksArtJS.ts              JS port of ChecksArt.sol (rendering engine)
│       ├── utils.ts                    Types, parseTokenURI, mapCheckAttributes
│       ├── supabaseClient.ts           Supabase JS client (DB mode)
│       ├── useAllPermutations.ts       Chain mode hook (fetch + compute on client)
│       ├── usePermutationsDB.ts        DB mode hook (query Supabase)
│       ├── test-utils.tsx              WagmiWrapper helper for tests
│       └── components/
│           ├── Navbar.tsx              Top bar: token input (chain) or count (DB) + wallet connect
│           ├── FilterBar.tsx           5 dropdowns: Checks/ColorBand/Gradient/Speed/Shift
│           ├── InfiniteGrid.tsx        Torus infinite scroll grid of PermutationCards
│           ├── PermutationCard.tsx     Single card showing the ABCD composite SVG
│           ├── CheckCard.tsx           Reusable card: SVG + attribute list
│           └── TreeModal.tsx           Full composite tree overlay + "Buy All 4" button
│
├── backend/           Node.js scripts (tsx, no bundler)
│   ├── .env.example                   Required env vars template
│   ├── package.json                   Scripts: backfill, compute-permutations
│   ├── tsconfig.json
│   ├── lib/
│   │   └── engine.ts                  Backend port of checksArtJS + utils (Buffer-safe)
│   └── scripts/
│       ├── backfill.ts                Fetch checks from TokenStrategy wallet → tokenstr_checks table
│       └── compute-permutations.ts    Compute P(n,4) attributes → permutations table
│
├── supabase/
│   ├── functions/
│   │   ├── checks-webhook/
│   │   │   └── index.ts               Deno edge function: Alchemy Transfer events → tokenstr_checks sync
│   │   └── tokenstr-webhook/
│   │       └── index.ts               Deno edge function: TokenStrategy wallet activity → tokenstr_checks
│   └── migrations/
│       ├── 001_checks_backend.sql     Base schema: checks, permutations, listed_checks, sync_log
│       ├── 002_permutations_nullable_svgs.sql
│       ├── 003_drop_abcd_svg.sql      Drop SVG columns from permutations; switch to client-side render
│       ├── 004_...                    (earlier migrations)
│       ├── 005_rename_checks_table.sql  ALTER TABLE checks RENAME TO tokenstr_checks
│       └── 006_drop_listed_checks_view.sql  DROP VIEW listed_checks (replaced by direct table query)
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
Entry point. Wraps `<App>` in `WagmiProvider` (with `wagmiConfig`) and `QueryClientProvider` (for wagmi's internal React Query usage), inside React `StrictMode`.

---

### `src/wagmiConfig.ts`
Creates the wagmi config for Ethereum mainnet with the injected connector (MetaMask / browser wallet).

```typescript
export const wagmiConfig  // wagmi Config: mainnet, injected(), Alchemy HTTP transport
```

Uses `VITE_ALCHEMY_API_KEY` for the RPC transport. Falls back to the public RPC if no key is set.

---

### `src/tokenStrategyAbi.ts`
ABI fragments and contract address for the TokenStrategy contract.

```typescript
export const TOKEN_STRATEGY_ADDRESS  // '0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc'

export const tokenStrategyAbi = [
  // nftForSale(tokenId) → uint256 — returns listed price in wei
  // sellTargetNFT(payableAmount, tokenId) — payable, buys the NFT at the listed price
]
```

Used by `TreeModal` to read prices and execute buys.

---

### `src/App.tsx`
Root component. Detects mode via `hasSupabase()` and renders the right data source.

**DB mode behaviour:**
- On mount → `loadRandom()` (random page of permutations)
- On filter change → `load(filters)` (server-side filtering)
- No filter active → `loadRandom()` on shuffle button click
- `Navbar` shows nothing in center (no token input)

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
| `dbMode` | `boolean` | `true` when Supabase env vars are present |

`dbMode` is passed down the tree: `App → InfiniteGrid → TreeModal`.

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

// L2 helpers:
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
- Computes ABCD via `computeL2` + `generateSVGJS` (JS only)
- Updates all permutation results

**`generatePermDefs(ids)`** — generates all P(n,4) ordered 4-tuples as `PermutationDef[]`.

---

### `src/usePermutationsDB.ts`
**DB mode hook.** Queries the Supabase `permutations` table (joined to `tokenstr_checks`).

**`load(filters)`** — initial load / filter change:
- Resets state, queries with server-side filter pushdown (all 5 attributes)
- Converts rows → `PermutationResult[]` via `rowToPermutationResult`

**`loadRandom()`** — loads a random page of permutations (no filters).

**`rowToPermutationResult(row)`** — converts a Supabase row to `PermutationResult`:
- Uses `tokenstr_checks.svg` (pre-fetched via join) for nodeA/B/C/D
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
       keeper_1:tokenstr_checks!keeper_1_id(svg, check_struct),
       burner_1:tokenstr_checks!burner_1_id(svg, check_struct),
       keeper_2:tokenstr_checks!keeper_2_id(svg, check_struct),
       burner_2:tokenstr_checks!burner_2_id(svg, check_struct)
FROM permutations
[WHERE abcd_checks=? AND ...]
ORDER BY random()
LIMIT page_size
```

---

## Components

### `Navbar.tsx`
Fixed top bar (48px height).
- **Chain mode:** Token ID text input + "Preview →" submit button
- **DB mode:** Center is empty (no input needed)
- Wallet connect button (right side) — uses wagmi `useAccount` / `useConnect` / `useDisconnect`
  - Disconnected: shows "Connect Wallet"
  - Connected: shows abbreviated address (`0x1234…abcd`)
- Shows error string below the form when set

### `FilterBar.tsx`
5 `<select>` dropdowns: Checks, Color Band, Gradient, Speed, Shift. Includes a count of visible results and a "Shuffle" button (DB mode only, when no filters active).

```typescript
export function matchesFilters(attributes: Attribute[], filters: Filters): boolean
// Used in chain mode for client-side filtering.
// AND logic: all active filters must match. Missing attributes pass all filters.
```

In DB mode, filters are applied server-side in the Supabase query — `matchesFilters` is not called.

### `InfiniteGrid.tsx`
**Torus infinite scroll** with virtual rendering. Maintains a 3×3 grid of tile copies for the illusion of infinite content. On scroll, teleports by one tile dimension when the edge is crossed.

- `N < 25` → plain CSS grid (no looping), renders all cards directly
- `N ≥ 25` → virtual torus: only cards in viewport + overscan are mounted (`~55 DOM nodes` for a 2500-item grid)
- Click on a card → `setSelected(i)` → renders `<TreeModal>`
- Passes `dbMode` prop down to `TreeModal`

Props:
```typescript
interface Props {
  permutations: PermutationResult[]
  ids: string[]
  showFlags: boolean[]
  hasFilters?: boolean
  dbMode?: boolean
}
```

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

Layout (3 rows + buy row):
```
Row 1: [Keeper A] [Burn B]     [Keeper C] [Burn D]
Row 2:     [L1a composite]         [L1b composite]
Row 3:           [ABCD final composite]
Row 4:         [Buy All 4 (X ETH)]   ← DB mode only
```

Labels come from `def.tokenIds` (DB mode) or `ids[def.indices[i]]` (chain mode).

In **DB mode**, lazy-loads individual check SVGs from `tokenstr_checks` (they are omitted from the grid query to keep payloads small).

**Buy button (DB mode only):**
- Uses `useReadContracts` to call `nftForSale(tokenId)` for all 4 tokens → gets price in wei
- Shows total price formatted as ETH
- On click: calls `sellTargetNFT(price, tokenId)` with `value: price` for each token sequentially (4 wallet prompts)
- States: fetching prices → ready (shows total ETH) → buying N/4 → done / error
- Disabled if wallet not connected or prices not yet loaded

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

### `backend/scripts/backfill.ts`
Populates `tokenstr_checks` from the TokenStrategy wallet holdings.

**Flow:**
1. Call Alchemy `getNFTsForOwner(TOKEN_STRATEGY_ADDRESS, { contractAddresses: [CHECKS_CONTRACT] })` → get all token IDs held by the wallet
2. In `--incremental` mode: skip tokens with `last_synced_at > 24h ago`
3. For each batch of 500:
   - **Phase A (multicall client):** `ownerOf` + `getCheck` — cheap, aggregate fine
   - **Phase B (direct client, 20 concurrent):** `tokenURI` — expensive SVG gen on-chain, must NOT use multicall (gas limit: 550M; each tokenURI ~2M gas)
4. Build row objects, upsert to `tokenstr_checks` table

**Two viem clients:**
- `viemClient` — `batch: { multicall: true }` — for cheap calls
- `viemClientDirect` — no multicall — for `tokenURI`

**Run:**
```bash
cd backend
node --env-file=.env node_modules/.bin/tsx scripts/backfill.ts
node --env-file=.env node_modules/.bin/tsx scripts/backfill.ts --incremental
```

### `backend/scripts/compute-permutations.ts`
Generates all P(n,4) composite attribute combinations and stores them in `permutations`.

**Flow:**
1. Load all non-burned tokens from `tokenstr_checks` (`.eq('is_burned', false)`)
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
node --env-file=.env node_modules/.bin/tsx scripts/compute-permutations.ts
node --env-file=.env node_modules/.bin/tsx scripts/compute-permutations.ts --incremental
MAX_GROUP_SIZE=10 node --env-file=.env node_modules/.bin/tsx scripts/compute-permutations.ts
```

---

## Supabase

### Schema

**`tokenstr_checks` table** — one row per Checks NFT held by the TokenStrategy wallet
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
keeper_1_id     bigint REFERENCES tokenstr_checks
burner_1_id     bigint REFERENCES tokenstr_checks
keeper_2_id     bigint REFERENCES tokenstr_checks
burner_2_id     bigint REFERENCES tokenstr_checks
abcd_checks     smallint
abcd_color_band text
abcd_gradient   text
abcd_speed      text
abcd_shift      text
computed_at     timestamptz
UNIQUE(keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
```
No SVG columns — all SVGs computed client-side from `check_struct` data.

**`sync_log` table** — audit trail for script runs
```sql
id, job ('backfill'|'permutations'|'tokenstr-webhook'|'checks-webhook'),
status ('running'|'done'|'error'),
tokens_processed, perms_computed, error_message, started_at, finished_at
```

### Edge Function: `tokenstr-webhook`
Deno function deployed to Supabase. Receives Alchemy "Address Activity" webhooks watching the **TokenStrategy wallet** (`0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc`) for Checks ERC-721 transfers.

**Trigger:** Any ERC-721 transfer where `from` or `to` is the TokenStrategy wallet

**Logic:**
- Token received (to = TokenStrategy) → `refetchAndUpsert` into `tokenstr_checks` via Alchemy NFT API + `tokenURI` + `getCheck`
- Token sent (from = TokenStrategy) → delete from `tokenstr_checks` + clean up related `permutations` rows
- Logs to `sync_log` with job `'tokenstr-webhook'`

**Important:** JWT verification must be **disabled** in Supabase dashboard (Edge Functions → tokenstr-webhook → disable JWT verification). Alchemy sends unsigned requests.

**Deploy:**
```bash
supabase functions deploy tokenstr-webhook
```

**Required secrets:**
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALCHEMY_API_KEY
```
(No signing key — verification is disabled.)

### Edge Function: `checks-webhook`
Deno function watching the Checks contract (`0x036721e5a769cc48b3189efbb9cce4471e8a48b1`) for Transfer events. Still active for catching burns and general token movement. Writes to `tokenstr_checks`.

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
App loads → usePermutationsDB.loadRandom()
  → Supabase query: permutations JOIN tokenstr_checks × 4
  → rowToPermutationResult × PAGE_SIZE
      tokenstr_checks.svg → nodeA/B/C/D (pre-stored)
      computeAllNodes: simulateCompositeJS × 2 + computeL2 + generateSVGJS × 3 (JS)
  → InfiniteGrid renders results

Filter change → load(newFilters)
  → Supabase: WHERE abcd_checks=? AND ... (server-side)
  → fresh results replace previous

TreeModal opened → loads individual SVGs for the 4 leaf tokens
  → useReadContracts: nftForSale(tokenId) × 4 → prices in wei
  → Buy All 4 button shows total ETH price
  → Click → sellTargetNFT(price, tokenId) × 4 (sequential wallet prompts)
```

### Sync Pipeline (real-time + backfill)
```
NFT transferred into/out of TokenStrategy wallet
  → Alchemy Address Activity webhook
  → tokenstr-webhook edge function
  → tokenstr_checks: upsert (received) or delete + cleanup permutations (sent)

One-time / periodic backfill:
  → backfill.ts
      Alchemy getNFTsForOwner(TOKEN_STRATEGY_ADDRESS)
      tokenURI + getCheck per token (concurrent eth_call, no multicall)
  → tokenstr_checks table

tokenstr_checks
  → compute-permutations.ts
      groups by checks_count
      simulateCompositeJS × 2 per 4-tuple (JS only, no RPC)
      computeL2 → mapCheckAttributes → 5 attribute values
  → permutations table (50 rows/batch)
```

---

## Environment Variables

**`frontend/.env`**
```
VITE_ALCHEMY_API_KEY=    # RPC key (chain mode + wagmi transport)
VITE_SUPABASE_URL=       # Supabase project URL (DB mode, optional)
VITE_SUPABASE_ANON_KEY=  # Supabase anon key (DB mode, optional)
```

**`backend/.env`** (copy from `.env.example`)
```
SUPABASE_URL=            # Same Supabase project URL
SUPABASE_SERVICE_KEY=    # Service role key (full DB access)
ALCHEMY_API_KEY=         # RPC key + NFT API key for backfill script
```

**Supabase edge function secrets** (set via `supabase secrets set`)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ALCHEMY_API_KEY
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| SVGs not stored in `permutations` | ~10KB/row × 657k rows = ~6.5GB. Computed client-side in ~1ms/SVG using the JS engine |
| `tokenURI` NOT multicalled | Each call generates SVG on-chain (~2M gas). 500 × 2M = 1B gas > 550M limit. Uses concurrent direct `eth_call` instead |
| `seed` stored as string in jsonb | `CheckStruct.seed` is `uint256` (bigint in JS). JSON.stringify loses precision on large ints. String survives the round-trip |
| `tokenstr_checks` not `listed_checks` view | Data source is now the TokenStrategy wallet directly — `backfill.ts` uses Alchemy `getNFTsForOwner` and the webhook watches wallet activity. No external listings table needed |
| Webhook JWT verification disabled | Alchemy webhook requests have no Supabase JWT. The function is not sensitive (it re-fetches data from the chain before upserting), so disabling JWT is safe |
| `burnerVirtualId` parameter | The on-chain composite stores the burner's token ID in `composites[divisorIndex]`. The JS engine needs this to build the recursive color resolution map |
| DB mode filters server-side | With 657k+ rows, client-side filtering would require loading all rows. Supabase index on each attribute column makes server-side filters fast |
| `sellTargetNFT` not `buyTargetNFT` | The TokenStrategy contract uses `sellTargetNFT(payableAmount, tokenId)` as the public buy function. Price is read via `nftForSale(tokenId)` and sent as both the function arg and `msg.value` |
