# Search Page Redesign — Targeted Discovery

**Date:** 2026-05-29
**Owner:** Harsheyy
**Status:** Design (pre-implementation plan)

## Goal

Transform the Search page from a single token-ID input into a targeted-search surface that lets users find specific permutations across three composable axes: token IDs, owner wallet, and result attributes (traits). The page acts like a search-engine homepage — filters are the primary content, results appear after submit.

The Search page is for *targeted* lookup. Discovery / random / themed browsing remains the job of Explore.

## Non-goals

- No exploratory features (random shuffles as the entry point, themed starting points, "popular searches" chips). Those belong on Explore.
- No rarity-sort or uniqueness scoring in v1.
- No saved searches, shareable URLs, or search history (post-v1 candidates, not in this scope).
- No multi-select fork of FilterBar's behavior on Explore / Curated — single-select stays for those views.

## Scope summary

- New Search page composition replacing the current empty-state ID input.
- Three input axes: Token IDs (existing pattern), Wallet (address or ENS), Traits (multi-select). Input tabs (IDs / Wallet) are mutually exclusive; traits compose with either OR run on their own (global capped sample).
- Nav consolidation: **My Checks** and the gated **Search Wallet** are absorbed into Search → Wallet → "Use my wallet". Connected-user nav becomes Explore / Curated / Search.
- The current `SEARCH_WALLET_GATE` constant is removed. Search is open to any connected wallet; disconnected users see Explore / Curated only.
- Data sourcing rule: **Supabase first; on-chain RPC only for data that's not in the DB.**

## Page anatomy

Two states share the page:

### Empty state (homepage)

Vertical stack inside the main content area:

1. **Input tabs** — segmented control `[ Token IDs | Wallet ]`. Default = Token IDs.
2. **Input field** — single field that re-purposes based on the active tab.
3. **"Refine by traits"** dock — five labelled rows, each with a multi-select dropdown styled like the existing `FilterSelect`.
4. **Search button** — primary CTA, right-aligned, disabled until the query is valid (see "Submit semantics").

No results are rendered in this state. The page reads as a focused query form.

### Active state (after submit)

The full input form **collapses into a compact query bar** at the top of the page. Each active constraint is rendered as a chip (`Wallet · vitalik.eth ×`, `Checks · 1, 5 ×`, `Gradient · Linear, Reflected ×`). An `Edit` link expands the form back to the homepage layout for major changes.

Below the query bar:

- One-line result meta (`86 permutations · sorted random · ⤬ shuffle`).
- Existing `InfiniteGrid` rendering `PermutationCard`s, with all existing behaviors (like, buy, TreePanel) intact.

Each chip's `×` removes that single constraint and re-runs the query live. Removing the input-source chip (IDs or Wallet) returns to the empty homepage state.

## Input source tabs

The tabs are **mutually exclusive**: switching tabs clears the other input. Both tabs feed into the same downstream pipeline (a pool of source token IDs → `useMyCheckPermutations` → permutations).

### Token IDs tab (default)

- Comma-separated input, 4–10 numeric IDs.
- Validation states (inline below input):
  - Empty → button disabled, hint "4–10 IDs, comma separated".
  - Fewer than 4 numeric IDs → "Add at least 4 IDs".
  - More than 10 → "Maximum 10 IDs".
  - Non-existent on chain → error chip after submit ("Could not fetch: #99999. Check that these token IDs exist.").
- Matches existing `useExplorePermutations` validation, refactored to source check data from Supabase first (see "Data flow").

### Wallet tab

- Accepts:
  - `0x…` hex address (case-insensitive).
  - ENS name ending in `.eth` — resolved via viem's `publicClient.getEnsAddress()` against Ethereum mainnet.
  - **Use my wallet** shortcut (right-aligned link) that fills the connected address. Only visible when a wallet is connected (which is always true since Search is gated to connected users).
- After submit:
  - Success: meta line "Found 17 Checks · 238 permutations".
  - No Checks: "vitalik.eth doesn't own any Checks VV tokens."
  - Too few: "Found 2 Checks · need at least 4 for a permutation."
  - ENS failure: "Couldn't resolve 'foo.eth'. Try the 0x address instead."

## Trait dock (multi-select)

Five trait rows, each a multi-select dropdown styled to match the existing `FilterSelect`. Closed state shows comma-joined selections (e.g., `1, 5`) or `Any` when no values are selected. Open state shows a checkbox list. Stays open while toggling; closes on outside click. A `Clear all` link sits below the rows.

| Trait      | Options                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Checks     | 20, 10, 5, 4, 1                                                                                |
| Color band | Eighty, Sixty, Forty, Twenty, Ten, Five, One                                                   |
| Gradient   | None, Linear, Double Linear, Reflected, Double Angled, Angled, Linear Z                        |
| Speed      | 0.5x, 1x, 2x                                                                                   |
| Shift      | IR, UV                                                                                         |

**Semantics:** OR within a trait, AND across traits. Empty selection on a trait = no constraint on that trait ("Any").

**Counts in popover:** when other filters are active, each option label shows how many of the current matches have that value (e.g., `Linear (24)`). When the query hasn't been submitted yet (empty state), no counts are shown — option labels render plain.

### Component changes

- Extend the existing `FilterSelect` with an optional `multiSelect: boolean` prop and a `values: string[]` (in addition to current `value: string`). When `multiSelect` is true, render a checkbox-based popover instead of a native `<select>`.
- Search introduces a new `SearchFilters` shape (sibling to `Filters` in `FilterBar.tsx`) where each trait field is `string[]` instead of `string`. The trait-match predicate becomes `array.length === 0 || array.includes(attrValue)`.
- Explore / Curated continue to use `Filters` (single-select); FilterBar continues to render `<select>` dropdowns there. No regression risk for those views.

## Data flow

**Rule:** Supabase first. On-chain Ethereum JSON-RPC (Alchemy / public RPC) is only used for data that isn't in the DB.

Three pipelines:

### 1. Token IDs path

1. User submits 4–10 token IDs.
2. Look them up in `all_checks` via `fetchCheckStructMap(ids)` (already exists in `usePermutationsDB.ts`).
3. For any ID not returned by Supabase, fall back to on-chain `checksClient.readContract({ functionName: 'getCheck', args: [id] })` for that ID only.
4. Run `useMyCheckPermutations(checks)` over the resulting struct map.
5. Apply trait filters client-side (using the multi-select `SearchFilters` predicate).
6. Render results with `InfiniteGrid`.

If on-chain fallback for an ID errors (token doesn't exist), surface the existing error copy: "Could not fetch: #X. Check that these token IDs exist."

### 2. Wallet path

1. User submits an address (or ENS).
2. ENS: if input matches `*.eth`, resolve via viem `publicClient.getEnsAddress({ name })` on mainnet. Cache resolved addresses in module memory (last 5).
3. Ownership: Alchemy `getNFTsForOwner` (kept; ownership data isn't in our DB). This is the existing call in `useMyChecks.ts`.
4. Struct lookup: replace the existing on-chain `getCheck()` batch with `fetchCheckStructMap(tokenIds)` against `all_checks`.
5. For any wallet-owned token not returned by Supabase, fall back to on-chain `getCheck()` for that token only. (Most wallets' Checks should be fully indexed; the fallback is the edge case.)
6. Existing 48h localStorage cache (`writeMyChecksCache`) stays on the merged result.
7. Run `useMyCheckPermutations(checks)` and apply trait filters client-side.

### 3. Traits-only (global)

When no input source is set but at least one trait is selected:

1. Query the existing `permutations` table directly:
   ```ts
   supabase
     .from('permutations')
     .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost')
     .in('abcd_checks', filters.checks)        // when non-empty
     .in('abcd_color_band', filters.colorBand) // when non-empty
     .in('abcd_gradient', filters.gradient)    // when non-empty
     .in('abcd_speed', filters.speed)          // when non-empty
     .in('abcd_shift', filters.shift)          // when non-empty
     .order('rand_key')
     .limit(500)
   ```
   `.in(...)` calls are conditionally appended only for traits with non-empty selections.
2. Use the existing `attachChecks()` helper to fetch the four check structs per row from `all_checks` (same call pattern as Explore).
3. Render with `InfiniteGrid`.

A "Showing 500 of ~N matches. Add an input source to narrow." caption appears above the grid when this path is used and the unfiltered match count exceeds 500. The total `N` is obtained via a separate `count: 'exact', head: true` query using the same `.in(...)` chain.

The query above uses the standard `supabase.from(...)` query builder — no new Postgres function is required. Existing column indexes on `abcd_checks`, `abcd_color_band`, etc., are assumed; the implementation plan will confirm and add any missing indexes.

## Submit semantics

- **Input source is mutually exclusive** — Token IDs `XOR` Wallet. Switching tabs clears the other tab's input.
- **Trait selections compose** — OR within a trait, AND across traits.
- **Submit trigger** — Explicit click of the Search button on the first query. Once results are shown, edits to chips in the compact query bar (removing chips, or "Edit" → re-submit) re-run the query live.
- **Search button enabled when** at least one of:
  - ≥4 valid numeric IDs typed in the IDs tab, or
  - A non-empty wallet input (validation deferred to submit), or
  - At least one trait selected.
- **Sort** — Random shuffle by default (uses existing `rand_key` ordering for global path; Fisher-Yates for client-side pool paths). "Shuffle" affordance in the result meta re-randomizes. No rarity sort in v1.
- **Result cap** — Global trait path: 500 rows max. Pool-based paths (IDs / Wallet): capped by existing `useMyCheckPermutations` behavior.
- **Empty results** — "No permutations match these filters. Try removing a trait or widening your input."

## Edge cases and error states

| Case                                 | Copy                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Fewer than 4 IDs                     | "Add at least 4 IDs" (inline hint).                                                               |
| More than 10 IDs                     | "Maximum 10 IDs" (inline hint).                                                                   |
| Token ID not on chain and not in DB  | "Could not fetch: #X. Check that these token IDs exist." (after submit).                          |
| Wallet has no Checks                 | "vitalik.eth doesn't own any Checks VV tokens."                                                   |
| Wallet has fewer than 4 Checks       | "Found 2 Checks · need at least 4 for a permutation."                                             |
| ENS resolution failed                | "Couldn't resolve 'foo.eth'. Try the 0x address instead."                                         |
| Some wallet tokens not in `all_checks` | Silent on-chain fallback for those; if some still fail, drop them and show "12 of 17 indexed". |
| Empty result set                     | "No permutations match these filters. Try removing a trait or widening your input."               |
| Global cap notice (traits-only)      | "Showing 500 of ~12,400 matches. Add an input source to narrow." (only when total > 500).         |
| Disconnected user on Search view     | Search nav button is hidden when no wallet is connected. If `viewMode` is somehow set to `'search'` while disconnected (e.g. wallet disconnect mid-session), reset to `'explore'`. |

## Nav changes

**Before** (connected user):

> Token Works · Curated Checks · My Checks · Search · Search Wallet (gated)

**After** (connected user):

> Explore · Curated · Search

- `My Checks` button is removed; the **Use my wallet** shortcut on Search's Wallet tab replaces it.
- `Search Wallet` button is removed; the Wallet tab generalizes it.
- The `SEARCH_WALLET_GATE` constant in `App.tsx` and the `showSearchWallet` plumbing in `Navbar` are deleted.
- The Search nav button only appears when a wallet is connected (parity with the old gating, just less restrictive).
- Disconnected users see Explore and Curated only — same as today.
- The Token Works ↔ OpenSea source selector continues to live inside the Explore view (no change).

## Implementation touchpoints

A non-exhaustive list of expected changes; the implementation plan will refine.

- **`App.tsx`**
  - Replace `viewMode` union: remove `'my-checks'` and `'search-wallet'`. Keep `'explore' | 'search' | 'curated'`.
  - Remove `SEARCH_WALLET_GATE`, `showSearchWallet`, and the related `Navbar` props.
  - Search view composes: input tabs (new component) + multi-select trait dock + results grid.
  - Existing `handleToggleLike` source mapping: Wallet-tab submissions map to the existing `'search'` source value; the gated `'search-wallet'` source value is retired (or kept and routed identically — implementation choice).

- **`components/Navbar.tsx`**
  - Remove the `My Checks` and `Search Wallet` buttons.
  - Remove the `showSearchWallet` / `searchWalletAddress` / `onSearchWalletAddressChange` props.

- **`components/FilterBar.tsx`** (or a new sibling file)
  - Extend `FilterSelect` with optional `multiSelect`, `values: string[]`, and `onValuesChange(string[])` props.
  - When `multiSelect` is true, render a checkbox-based popover (custom div / role=listbox) instead of `<select>`. Keyboard accessibility deferred to a follow-up.
  - Add a `SearchFilters` shape: `{ checks: string[]; colorBand: string[]; gradient: string[]; speed: string[]; shift: string[] }`.
  - Add a `matchesSearchFilters(attrs, sf)` predicate.

- **`useExplorePermutations.ts`**
  - Replace the on-chain `getCheck()` batch with `fetchCheckStructMap(ids)` first; on-chain fallback only for IDs missing from `all_checks`.
  - Keep existing analytics call (`log_explore_query`); extend payload to include `{ mode: 'ids' | 'wallet' | 'global', traits: jsonb }`.

- **`useMyChecks.ts`**
  - Replace the on-chain `getCheck()` batch with `fetchCheckStructMap(ids)` first; on-chain fallback only for IDs missing from `all_checks`.
  - The 48h localStorage cache remains; cached entries continue to deserialize the same way.

- **New helper / hook**
  - `useGlobalTraitSearch(filters: SearchFilters)` — performs the conditional `.in(...)` query on `permutations`, attaches structs via `attachChecks`, applies Fisher-Yates, returns `PermutationResult[]`.
  - `resolveEnsToAddress(name: string): Promise<string>` — viem mainnet `getEnsAddress` with a 5-entry in-memory LRU.

- **Database / Supabase**
  - No new tables or RPCs required for the global trait path — uses the existing `permutations` table with conditional `.in(...)` filters.
  - Verify (in the implementation plan) that the following columns are indexed on `permutations`: `abcd_checks`, `abcd_color_band`, `abcd_gradient`, `abcd_speed`, `abcd_shift`. If multi-column queries are slow, consider a composite index or generated `tsvector`.
  - Extend the `log_explore_query` Postgres function signature to accept the additional payload columns.

## Open questions for the implementation plan

1. **`all_checks` coverage** — what fraction of Checks tokens is currently indexed? If coverage is below ~95%, the on-chain fallback rate on Wallet path could be significant; we may want a backfill job before launch.
2. **Index health on `permutations`** — confirm whether per-attribute indexes exist; profile a representative trait-only query with the worst-case `.in(...)` of all five traits.
3. **Existing `'search-wallet'` like-source value** — keep as a historical value in `curated_likes`, or migrate existing rows to `'search'` for consistency? (Backwards-compat decision.)
4. **Mobile layout** — the trait dock as five vertically-stacked dropdown rows is fine on mobile, but the chip-based query bar may overflow. Confirm wrap / scroll behavior.

## Out of scope (future)

- Shareable URL state (`/search?ids=…&checks=1,5&gradient=Linear`) for permalinkable queries.
- Saved searches per wallet.
- A rarity-score sort or "show me the rarest" toggle.
- Sort options beyond random / shuffle.
