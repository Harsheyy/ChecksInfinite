# UX Fixes Design — 2026-03-01

## Overview

Four UX improvements: click-outside panel dismiss, filter bar cleanup, ID input filter, and a price range slider for Token Works.

---

## 1. Click-outside to close side panel

**Where:** `InfiniteGrid.tsx`

Add a `mousedown` handler on the grid viewport element. If the panel is open and the click target does not land on a `.perm-card` (checked via `e.target.closest('.perm-card')`), close the panel. Card clicks already call `setSelected(i)` through the card's own `onClick`, so they update the panel without conflict. Works for both looping and non-looping grid modes.

---

## 2. Filter bar: Checks options cleanup

**Where:** `FilterBar.tsx` — `CHECKS_OPTIONS`

Change from `['1', '5', '10', '20', '40', '80']` to `['20', '10', '5', '1']`.
- Remove 40 and 80 (never appear in results)
- Reverse order so highest is first

---

## 3. ID input filter

**Where:** `FilterBar.tsx`, `Filters` interface, `usePermutationsDB.ts`, `App.tsx`

### Interface

Add two fields to `Filters`:
```ts
idInput: string       // raw comma-separated input
idMode: 'and' | 'or' // only relevant when parsed ID count > 4
```

### UI

- Text input field in the filter bar labelled "Check IDs"
- Placeholder: `e.g. 123, 456`
- When parsed ID count > 4, show an AND / OR pill toggle next to the input
- Default mode: AND when >4 IDs

### Logic

- **OR** (always used for ≤4 IDs, optional for >4): at least one of the 4 positions (keeper_1, burner_1, keeper_2, burner_2) is in the entered set
- **AND** (available for >4 IDs): all 4 positions must be in the entered set

### DB mode (Token Works)

- OR mode: PostgREST `or()` across all four ID columns: `keeper_1_id.in.(ids),burner_1_id.in.(ids),keeper_2_id.in.(ids),burner_2_id.in.(ids)`
- AND mode: four separate `.in.(ids)` filters chained

### My Checks mode

Client-side filtering in `matchesFilters` with the same AND/OR logic.

---

## 4. Price range slider (Token Works only)

### Backend

**DB migration:**
- Add `eth_price FLOAT` (nullable) to `tokenstr_checks`
- Add `total_cost FLOAT` (nullable) to `permutations` — denormalized sum of the 4 checks' prices

**Backfill script** (`backend/scripts/backfill-prices.ts`):
- For each token in `tokenstr_checks`, call `nftForSale(tokenId)` on the TokenStrategy contract
- Store result (converted from wei to ETH float) in `eth_price`
- After all prices are set, backfill `total_cost` in `permutations` via SQL:
  `UPDATE permutations SET total_cost = tc1.eth_price + tc2.eth_price + tc3.eth_price + tc4.eth_price FROM ...`

**Webhook update** (`tokenstr-webhook`):
- After upserting a check's price, also update `total_cost` for all permutations where that check appears in any of the 4 columns

### Slider bounds

Fetched once on Token Works mount:
- Min bound = `4 × MIN(eth_price)` from `tokenstr_checks`
- Max bound = `4 × MAX(eth_price)` from `tokenstr_checks`

### Frontend

- Add `minCost: number | null` and `maxCost: number | null` to `Filters`
- `FilterBar` receives optional `priceRange?: { min: number; max: number }` prop (the bounds)
- Render a dual-handle range slider (two overlapping `<input type="range">`) only when `priceRange` is provided (i.e. Token Works mode)
- Adds `.gte('total_cost', minCost).lte('total_cost', maxCost)` to the Supabase query when set
