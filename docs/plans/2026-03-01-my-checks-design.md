# My Checks View Mode — Design

**Date:** 2026-03-01
**Status:** Approved

## Goal

Add a `Token Works | My Checks` toggle to the navbar. Token Works is the existing DB-backed random permutation browse. My Checks fetches the connected wallet's Checks VV tokens on-chain, computes permutations entirely in JS, and caches results locally for 48 hours.

## Toggle

- Pill toggle rendered in the navbar, only visible when a wallet is connected
- Disconnecting wallet resets view to Token Works
- Default view when wallet connects: Token Works (no change to existing behaviour)

## My Checks — Data Layer

### `useMyChecks(address)` hook

**First load (or expired cache):**
1. Call Alchemy `getNFTsForOwner` with contract filter `0x036721e5a769cc48b3189efbb9cce4471e8a48b1`
2. Multicall `getCheck × N` via existing `checksClient` to fetch each token's `CheckStruct`
3. Persist to `localStorage` under key `ci:myChecks:{address}`:
   ```ts
   {
     tokenIds: string[]
     checks: Record<string, SerializedCheckStruct>  // seed stored as string
     cachedAt: number  // Date.now()
   }
   ```

**Subsequent loads within 48 hours:** Read from cache, no API calls.

**Cache size:** Check structs only — no SVGs. ~50 KB for a 164-token wallet. Well within the 5 MB localStorage limit.

**Leaf card SVGs:** Fetched on-demand via on-chain `tokenURI` when the tree panel opens (same lazy-load pattern as DB mode, but using `checksClient` instead of Supabase).

### Cache TTL
48 hours (`48 * 60 * 60 * 1000` ms). Stale cache is replaced on next load.

## My Checks — Permutation Layer

All computation is pure JS — no Supabase, no extra RPC calls after the initial load.

1. Group tokens by `checksCount` (only same-count tokens can be composited)
2. Randomly sample up to 2500 four-tuples from valid groups (groups with ≥ 4 tokens)
3. For each four-tuple run `simulateCompositeJS` twice (L1a, L1b) then `computeL2` + `generateSVGJS` for the final composite SVG
4. **Shuffle** re-samples a new random 2500 from the same cached check structs — no extra API calls

## Filter Bar

Client-side filtering on the computed `nodeAbcd.attributes` — same as current chain mode. No server round-trips.

## Edge Cases

| Situation | Behaviour |
|-----------|-----------|
| 0 Checks VV tokens in wallet | Show "No Checks VV tokens found in this wallet" |
| Fewer than 4 compatible checks | Show "Not enough compatible checks to generate permutations" |
| Alchemy key missing | Show existing key-missing error |
| Cache stale / expired | Silently refetch and replace |

## What Changes

| File | Change |
|------|--------|
| `Navbar.tsx` | Add `viewMode` + `onViewModeChange` props; render `Token Works \| My Checks` toggle when `isConnected` |
| `useMyChecks.ts` | New hook — Alchemy fetch, multicall `getCheck`, localStorage cache |
| `useMyCheckPermutations.ts` | New hook — groups by count, random samples 2500 permutations, JS composite compute, shuffle |
| `App.tsx` | Add `viewMode` state; wire `useMyChecks` + `useMyCheckPermutations`; swap data source when `viewMode === 'my-checks'` |
| `index.css` | Add `.view-toggle` styles for the pill toggle |

## Out of Scope

- No "force refresh cache" button (can revisit later)
- No server-side storage of user permutations
- No Supabase involvement in My Checks mode
- Mobile/responsive tweaks
