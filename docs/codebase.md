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
│       ├── usePermutationsDB.ts        DB mode hook (query Supabase, serializeCheckStruct)
│       ├── useMyChecks.ts              Fetches Checks tokens owned by connected wallet
│       ├── useMyCheckPermutations.ts   Generates all permutations from owned checks
│       ├── useCuratedOutputs.ts        Curated mode hook (load liked outputs from Supabase)
│       ├── useMyLikedKeys.ts           Tracks which outputs the wallet has liked (set + RPC)
│       ├── useWalletTracking.ts        Logs wallet connects to connected_wallets via RPC
│       ├── permutationsCache.ts        sessionStorage cache for the random permutations load
│       ├── test-utils.tsx              WagmiWrapper helper for tests
│       └── components/
│           ├── Navbar.tsx              Top bar: token input (chain) or view toggle (DB) + wallet connect
│           ├── FilterBar.tsx           Filter dropdowns + Community/Mine toggle (curated mode)
│           ├── InfiniteGrid.tsx        Torus infinite scroll grid of PermutationCards
│           ├── PermutationCard.tsx     Single card: ABCD composite SVG + heart button
│           ├── CheckCard.tsx           Reusable card: SVG + attribute list
│           └── TreePanel.tsx           Full composite tree side panel + like button + Buy All 4
│
├── backend/           Node.js scripts (tsx, no bundler)
│   ├── .env.example                   Required env vars template
│   ├── package.json                   Scripts: backfill, compute-permutations
│   ├── tsconfig.json
│   ├── lib/
│   │   └── engine.ts                  Backend port of checksArtJS + utils (Buffer-safe)
│   └── scripts/
│       ├── backfill.ts                Fetch checks from TokenStrategy wallet → tokenstr_checks table
│       ├── compute-permutations.ts    Compute P(n,4) attributes → permutations table (general)
│       └── populate-ranked-permutations.ts  Nightly populate: eligible-only, ranked, 500K cap, rand_key
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
│       ├── 005_rename_checks_table.sql  ALTER TABLE checks RENAME TO tokenstr_checks
│       ├── 006_drop_listed_checks_view.sql
│       ├── 009_rank_score.sql         ADD COLUMN rank_score smallint + index
│       ├── 010_truncate_permutations_fn.sql
│       ├── 011_curated_outputs.sql    curated_outputs + curated_likes tables + toggle_like / get_curated_outputs RPCs
│       └── 012_wallet_like_count.sql  ADD COLUMN total_likes to connected_wallets; update toggle_like to maintain it
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

Used by `TreePanel` to read prices and execute buys.

---

### `src/App.tsx`
Root component. Detects mode via `hasSupabase()` and renders the right data source.

**DB mode behaviour:**
- On mount → `loadRandom()` (random 2500 from permutations pool via `rand_key` index)
- On filter change → `load(filters)` (server-side filtering)
- Shuffle button → `shuffleDB()` (re-fetches a fresh random 2500)
- `Navbar` shows view toggle when wallet connected

**Chain mode behaviour:**
- User types token IDs → `handlePreview()` validates and calls `preview(ids)`
- Filters applied client-side via `matchesFilters()`

**Key state:**
| Variable | Type | Purpose |
|---|---|---|
| `idsRaw` | `string` | Raw comma-separated token ID input |
| `filters` | `Filters` | Active filter values for all 5 dropdowns |
| `viewMode` | `'token-works' \| 'my-checks' \| 'curated' \| 'search-wallet'` | Active view in DB mode |
| `walletOnly` | `boolean` | Curated mode: show only the wallet's own likes |
| `searchWalletAddress` | `string` | Raw 0x address entered in Search Wallet mode |
| `chainState` | `AllPermutationsState` | All permutation results from chain hook |
| `dbState` | `DBPermutationsState` | Results from DB hook |
| `likedKeys` | `Set<string>` | Keys of outputs the wallet has liked (`k1-b1-k2-b2`) |
| `likeCounts` | `Map<string, number>` | Per-key like counts (populated from curated outputs) |
| `dbMode` | `boolean` | `true` when Supabase env vars are present |

**Like flow (`handleToggleLike`):**
1. Optimistic UI update (immediate) before any async work
2. Gather `CheckStructJSON` for all 4 tokens:
   - `my-checks` / `search-wallet` → `serializeCheckStruct` from in-memory checks map
   - `token-works` → `fetchCheckStructMap` from `tokenstr_checks`
   - `curated` → pass null (row already has stored structs)
3. Call `toggle_like` RPC with structs; revert optimistic state on error

**Search Wallet gate:** `SEARCH_WALLET_GATE = '0x6ab9b2ae58bc7eb5c401deae86fc095467c6d3e4'` — the 4th toggle only appears when this address is connected.

`dbMode` is passed down the tree: `App → InfiniteGrid → TreePanel`.

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
**DB mode hook.** Queries the Supabase `permutations` table.

**`loadRandom(force?)`** — loads a random 2500 permutations:
- Counts total rows, picks a random offset, fetches 2500 rows ordered by `rand_key` (fast index scan)
- Results cached in sessionStorage (`checks-infinite-perms-v2`)
- `force=true` bypasses cache

**`shuffle()`** — calls `loadRandom(true)`: fetches a brand new random 2500 from the pool.

**`rowToPermutationResult(row)`** — converts a Supabase row to `PermutationResult`:
- Lazy SVG getters: SVGs only computed when the card first scrolls into view
- Calls `computeAllNodes(row)` for L1a, L1b, ABCD

**`computeAllNodes(row)`** — client-side computation:
```
k1, b1 = fromJSON(keeper_1.check_struct), fromJSON(burner_1.check_struct)
k2, b2 = fromJSON(keeper_2.check_struct), fromJSON(burner_2.check_struct)
l1a = simulateCompositeJS(k1, b1, burner_1_id)
l1b = simulateCompositeJS(k2, b2, burner_2_id)
abcd = computeL2(l1a, l1b)
→ generateSVGJS for each (lazy getter)
```

**`fromJSON(CheckStructJSON)`** — deserializes from Supabase: converts `seed` string → `BigInt`.

**`serializeCheckStruct(cs: CheckStruct): CheckStructJSON`** — serializes for Supabase storage: converts `bigint seed` → string, spreads typed arrays to plain arrays. Used by `App.tsx` before calling `toggle_like`.

**`fetchCheckStructMap(ids: number[]): Promise<Map<number, CheckStructJSON>>`** — batch-fetches `check_struct` from `tokenstr_checks` (500 IDs/batch). Used for Token Works likes.

---

### `src/useCuratedOutputs.ts`
**Curated mode hook.** Calls the `get_curated_outputs` RPC and converts rows to `CuratedPermutationResult`.

```typescript
export interface CuratedPermutationResult extends PermutationResult {
  outputId: number
  likeCount: number
  userLiked: boolean
}
```

**`load(filters, walletOnly, wallet)`** — fetches curated outputs with optional filters and wallet-only flag. Results include stored `k1/b1/k2/b2_struct` JSONB columns — no secondary fetch to `tokenstr_checks` is needed. `buildCuratedResult` calls `fromJSON` on each struct and uses lazy SVG getters identical to Token Works.

Outputs from any source (Token Works, My Checks, Search Wallet) appear here because structs are stored at like time.

---

### `src/useMyLikedKeys.ts`
Calls the `get_my_liked_keys` RPC on mount (when wallet is connected) and returns a set of `"k1-b1-k2-b2"` string keys for all outputs the wallet has liked.

```typescript
export function likedKey(k1, b1, k2, b2): string  // "k1-b1-k2-b2"
export function useMyLikedKeys(wallet: string | undefined): { likedKeys: Set<string>, setLikedKeys }
```

`setLikedKeys` is exposed so `App.tsx` can apply optimistic updates and sync from curated output loads.

---

### `src/useMyChecks.ts`
Fetches Checks VV tokens owned by a wallet address.

**Flow:**
1. Try localStorage cache (`ci:myChecks:<address>`, 48h TTL)
2. Call Alchemy `getNFTsForOwner` to get token IDs
3. `getCheck(tokenId)` via viem for each token (multicall batched)
4. Returns `{ tokenIds, checks: Record<string, CheckStruct>, loading, error }`

The resulting `checks` map is used by `App.tsx` to serialize structs for `toggle_like`.

---

### `src/useWalletTracking.ts`
Calls `log_wallet_connect` RPC once per session per address (guarded by a ref). Records address, ENS name, and bumps `visit_count` / `last_seen` in `connected_wallets`.

---

## Components

### `Navbar.tsx`
Fixed top bar (48px height).
- **Chain mode:** Token ID text input + "Preview →" submit button
- **DB mode:** View toggle `[Token Works | My Checks | Curated Checks]` (or `[... | Search Wallet]` when gated wallet connected)
  - **Search Wallet active:** inline address input appears to the right of the toggle
  - Input shows red border on invalid address; fetch only fires on valid 42-char `0x` address
- Wallet connect button (right side) — uses wagmi `useAccount` / `useConnect` / `useDisconnect`
  - Disconnected: shows "Connect Wallet"
  - Connected: shows ENS name if resolved, otherwise abbreviated address (`0x1234…abcd`)
- Shows error string below the form when set

### `FilterBar.tsx`
5 `<select>` dropdowns: Checks, Color Band, Gradient, Speed, Shift. Includes visible count and (DB mode) a Shuffle button.

**Curated mode extras:**
- **Community / Mine toggle** — two-button pill (matches navbar toggle style: bordered container, `#eee` active background)
- Community: shows all liked outputs; Mine: shows only this wallet's likes (disabled when not connected)
- Toggle fires `onWalletOnlyChange` which re-triggers the curated load in `App.tsx`

**Responsive:** inline row on desktop, collapsible side panel on mobile (slide-in overlay with Escape key dismiss).

```typescript
export function matchesFilters(attributes: Attribute[], filters: Filters, tokenIds?: string[]): boolean
// AND logic: all active filters must match. Missing attributes pass all filters.
// In DB mode (curated/token-works), filters are applied server-side — matchesFilters not called.
```

### `InfiniteGrid.tsx`
**Torus infinite scroll** with virtual rendering. Maintains a 3×3 grid of tile copies for the illusion of infinite content. On scroll, teleports by one tile dimension when the edge is crossed.

- `N < 25` → plain CSS grid (no looping), renders all cards directly
- `N ≥ 25` → virtual torus: only cards in viewport + overscan are mounted (`~55 DOM nodes` for a 2500-item grid)
- Click on a card → `setSelected(i)` → renders `<TreePanel>`
- Passes `getLikeInfo` prop down to both `PermutationCard` and `TreePanel`

Props:
```typescript
interface Props {
  permutations: PermutationResult[]
  ids: string[]
  showFlags: boolean[]
  hasFilters?: boolean
  dbMode?: boolean
  hideBuy?: boolean
  getLikeInfo?: (result: PermutationResult) => LikeInfo | undefined
}
```

### `PermutationCard.tsx`
Single card in the grid. Shows the ABCD composite SVG and an optional heart button.

- `visible=false` → renders a transparent spacer div (preserves grid layout, no rendering cost)
- `IntersectionObserver` → lazy-loads SVG only when card enters viewport (+ 200px margin)
- Heart button: always visible when liked (`perm-card-heart--liked`), visible on hover otherwise
- `LikeInfo.alwaysShow=true` (curated mode) → heart always shown even when not hovered

### `CheckCard.tsx`
Reusable display card with optional label. Shows:
- Loading state text
- Error text
- Name (`<h2>`), SVG (`dangerouslySetInnerHTML`), attributes (`<dl>`)

### `TreePanel.tsx`
Side panel showing the complete composite tree for a selected permutation.

Layout:
```
Header: Recipe  #id0 #id1 + #id2 #id3    [♥ like]  [✕ close]
Body:
  [Keeper A] [Burn B]     [Keeper C] [Burn D]
      [L1a composite]         [L1b composite]
            [ABCD final composite]
Footer (DB mode, not hideBuy):
      [Buy All 4 (X ETH)]
```

- **Like button** in header: heart icon, shows like count in curated mode. Calls `likeInfo.onLike`.
- Labels come from `def.tokenIds` (DB mode) or `ids[def.indices[i]]` (chain mode).
- In **DB mode**, lazy-loads individual check SVGs + attributes from `tokenstr_checks`.

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
General-purpose permutation compute script. Kept for reference/incremental use.

### `backend/scripts/populate-ranked-permutations.ts`
**Nightly populate script** — the primary data pipeline for Token Works mode.

**Flow:**
1. Delete all existing rows from `permutations`
2. Load all non-burned checks from `tokenstr_checks`
3. Filter to eligible only: `color_band IN ('Twenty','Ten','Five','One') OR gradient != 'None'`
4. Group by `checks_count`
5. Fisher-Yates shuffle tokens within each group (different sample each night)
6. Generate P(n,4) 4-tuples in shuffled order, stop at `MAX_PERMS_PER_GROUP = 500_000`
7. For each 4-tuple: compute L1a, L1b, ABCD attributes + `rank_score` + `rand_key = Math.random()`
8. Batch-insert to `permutations` (500 rows/batch)

**`rank_score`** = `(gradient_count × 4) + rarity_score`
- `gradient_count`: number of checks with `gradient > 0` (0–4)
- `rarity_score`: `sum(max(0, colorBand - 2))` per check — Twenty=1, Ten=2, Five=3, One=4
- Range: 0 (four Twenty-band, no gradients) → 32 (four One-band, all gradients)

**`rand_key`**: random float `[0,1)` assigned per row at insert time. Indexed. Used by the frontend for fast random window sampling without `ORDER BY random()`.

**Run:**
```bash
cd backend && npm run populate-ranked
```

**Automated:** `.github/workflows/nightly-permutations.yml` runs this at 2 AM UTC via GitHub Actions. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` repository secrets.

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
rank_score      smallint NOT NULL DEFAULT 0  -- (gradient_count × 4) + rarity_score, range 0–32
rand_key        float NOT NULL DEFAULT random() -- random [0,1) for fast random window queries
computed_at     timestamptz
UNIQUE(keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
```
No SVG columns — all SVGs computed client-side from `check_struct` data.
Indexes: `idx_perm_rank_score (rank_score DESC)`, `idx_perm_rand_key (rand_key)`.

**`curated_outputs` table** — one row per liked 4-tuple recipe
```sql
id              bigserial PRIMARY KEY
keeper_1_id     bigint NOT NULL
burner_1_id     bigint NOT NULL
keeper_2_id     bigint NOT NULL
burner_2_id     bigint NOT NULL
abcd_checks     smallint NOT NULL
abcd_color_band text NOT NULL
abcd_gradient   text NOT NULL
abcd_speed      text NOT NULL
abcd_shift      text
k1_struct       jsonb   -- CheckStructJSON for keeper 1 (stored at like time)
b1_struct       jsonb   -- CheckStructJSON for burner 1
k2_struct       jsonb   -- CheckStructJSON for keeper 2
b2_struct       jsonb   -- CheckStructJSON for burner 2
first_liked_at  timestamptz NOT NULL DEFAULT now()
UNIQUE(keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
```
No FK references to `tokenstr_checks` — supports My Checks tokens not in that table. Struct columns are filled at like time via `toggle_like`; `ON CONFLICT DO UPDATE SET k_struct = COALESCE(existing, excluded)` fills in any nulls without overwriting existing data. Row is auto-deleted when `like_count` reaches 0.

**`curated_likes` table** — one row per (output, wallet) like
```sql
id             bigserial PRIMARY KEY
output_id      bigint NOT NULL REFERENCES curated_outputs(id) ON DELETE CASCADE
wallet_address text NOT NULL
source         text NOT NULL CHECK (source IN ('token-works', 'my-checks', 'search-wallet'))
created_at     timestamptz NOT NULL DEFAULT now()
UNIQUE(output_id, wallet_address)
```
Indexes: `curated_likes_output_id_idx`, `curated_likes_wallet_address_idx`.

**`connected_wallets` table** — one row per wallet that has connected
```sql
address         text PRIMARY KEY
first_seen      timestamptz NOT NULL DEFAULT now()
last_seen       timestamptz NOT NULL DEFAULT now()
visit_count     integer NOT NULL DEFAULT 0
total_spent_eth numeric NOT NULL DEFAULT 0
checks_purchased integer NOT NULL DEFAULT 0
ens_name        text
total_likes     integer NOT NULL DEFAULT 0  -- maintained by toggle_like
```

**`sync_log` table** — audit trail for script runs
```sql
id, job ('backfill'|'permutations'|'tokenstr-webhook'|'checks-webhook'),
status ('running'|'done'|'error'),
tokens_processed, perms_computed, error_message, started_at, finished_at
```

### RPCs (SECURITY DEFINER)

**`toggle_like(...)`** — insert or remove a like for a 4-tuple
- Upserts `curated_outputs` row (fills missing struct columns via COALESCE on conflict)
- Delete-first toggle with `GET DIAGNOSTICS ROW_COUNT` — race-condition safe
- Inserts `curated_likes`; if `like_count` drops to 0, deletes the `curated_outputs` row
- Upserts `connected_wallets(address, total_likes)` — increments or decrements by 1
- Returns `(output_id, like_count, user_liked)`

**`get_curated_outputs(...)`** — paginated feed of liked outputs
- Filters by `p_checks`, `p_color_band`, `p_gradient`, `p_speed`, `p_shift`
- `p_wallet_only=true` → `HAVING BOOL_OR(wallet_address = p_wallet)` for Mine view
- Returns struct columns directly — no join to `tokenstr_checks`
- Ordered by `like_count DESC, first_liked_at DESC`

**`get_my_liked_keys(p_wallet)`** — returns all 4-tuples a wallet has liked (for heart state init)

**`log_wallet_connect(p_address, p_ens_name)`** — upserts `connected_wallets`, bumps `visit_count`

**`log_wallet_purchase(p_address, p_spent_eth, p_checks_count)`** — adds to `total_spent_eth` + `checks_purchased`

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
  → COUNT permutations → random offset → SELECT 2500 rows ORDER BY rand_key (index scan)
  → fetchCheckStructMap: batch-fetch check_structs for all unique token IDs
  → rowToPermutationResult × 2500
      computeAllNodes: simulateCompositeJS × 2 + computeL2 (JS, lazy SVG getters)
  → InfiniteGrid renders results

Shuffle → loadRandom(force=true) → fresh random 2500 from pool

Filter change → load(newFilters)
  → Supabase: WHERE abcd_checks=? AND ... (server-side)
  → fresh results replace previous

TreePanel opened → loads individual SVGs for the 4 leaf tokens
  → useReadContracts: nftForSale(tokenId) × 4 → prices in wei
  → Buy All 4 button shows total ETH price
  → Click → sellTargetNFT(price, tokenId) × 4 (sequential wallet prompts)
```

### Curated Mode
```
viewMode → 'curated' → loadCurated(filters, walletOnly, wallet)
  → supabase.rpc('get_curated_outputs', params)
      returns rows with k1/b1/k2/b2_struct stored inline
  → buildCuratedResult per row (no secondary fetch needed)
      fromJSON(struct) → simulateCompositeJS × 2 → computeL2 → lazy SVG getters
  → CuratedPermutationResult[] rendered in InfiniteGrid

Heart click → handleToggleLike(result, source)
  Optimistic update → gather structs (in-memory for My Checks, DB fetch for Token Works)
  → supabase.rpc('toggle_like', { ...params, p_k1_struct, ... })
      toggle_like upserts curated_outputs (struct stored / COALESCE filled)
      deletes or inserts curated_likes row
      deletes curated_outputs if like_count = 0
      updates connected_wallets.total_likes
  → likedKeys / likeCounts state updated; revert on error
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
SUPABASE_SERVICE_KEY=    # Secret API key (full DB access — NOT the legacy JWT service_role)
ALCHEMY_API_KEY=         # RPC key + NFT API key for backfill script
```

> **Note:** Supabase now uses a new API key system. The `SUPABASE_SERVICE_KEY` should be the **secret key** from Settings → API, not the legacy JWT `service_role` token. The frontend `VITE_SUPABASE_ANON_KEY` should be the **publishable key**.

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
| No FK on `curated_outputs` token IDs | My Checks tokens are not in `tokenstr_checks`. FKs would block liking from My Checks mode. Token identity is validated implicitly via the stored struct data |
| Structs stored in `curated_outputs` | Enables SVG rendering for any token source (Token Works, My Checks, Search Wallet) without a secondary DB fetch. Filled via COALESCE so re-liking after unlike doesn't lose existing data |
| Delete-first toggle in `toggle_like` | `DELETE … GET DIAGNOSTICS ROW_COUNT` is atomic. Avoids the TOCTOU race of `SELECT … IF EXISTS … INSERT` under rapid double-clicks |
| `total_likes` in `connected_wallets` | Maintained by `toggle_like` for analytics. Uses `INSERT … ON CONFLICT DO UPDATE` to handle wallets that liked before formally connecting |
