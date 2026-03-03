# Checks Infinite

Browse and filter every possible two-step composite from the [Checks VV](https://checks.art) NFT collection. Given four tokens (A, B, C, D) the app simulates the on-chain merge tree:

```
A + B → L1a      C + D → L1b
         L1a + L1b → ABCD (final composite)
```

SVG rendering is done entirely client-side via a JS port of `ChecksArt.sol`, producing pixel-identical output to the contract.

---

## Features

- **Token Works** — randomly sampled feed of 2500 pre-computed composites from a nightly-refreshed 500K pool
- **My Checks** — connect your wallet to see composites generated from checks you own
- **Explore** — enter any token IDs to compute composites on the fly (no wallet required)
- **Curated Checks** — community-liked outputs; heart any composite to add it; toggle between Community and Mine views
- **Search Wallet** — gated mode to explore any wallet's permutations on-the-fly (no DB writes)
- **Filters** — by Checks count, Color Band, Gradient, Speed, Shift, Token IDs, and ETH cost range
- **Buy** — purchase all four leaf checks in one flow via the TokenStrategy contract
- **Infinite torus grid** — seamlessly looping virtualised grid for large result sets
- **Responsive** — inline filter bar on desktop, collapsible side panel on mobile

---

## Architecture

```
frontend/          React + Vite UI
  src/
    checksArtJS.ts             JS port of the on-chain rendering engine
    usePermutationsDB.ts       DB mode: loads from Supabase, price bounds hook
    useAllPermutations.ts      Chain mode: live RPC calls via viem
    useMyChecks.ts             Fetches tokens owned by connected wallet
    useMyCheckPermutations.ts  Generates composites from owned checks
    useExplorePermutations.ts  Explore mode: arbitrary token ID search (no DB writes)
    useCuratedOutputs.ts       Curated mode: loads liked outputs from Supabase
    useMyLikedKeys.ts          Tracks which outputs the connected wallet has liked
    components/
      InfiniteGrid.tsx       Looping torus grid (√N × √N layout)
      TreePanel.tsx          Merge tree detail view + like button + buy flow
      FilterBar.tsx          Filters + price slider + Community/Mine toggle
      Navbar.tsx             View toggle, wallet connect

backend/           Node.js data pipeline (tsx + viem)
  scripts/
    backfill.ts                      Fetch all TokenStrategy checks → Supabase
    backfill-prices.ts               Populate eth_price in tokenstr_checks; backfill total_cost in permutations
    compute-permutations.ts          Pre-compute all valid permutations (general, reference)
    populate-ranked-permutations.ts  Nightly: low-band/gradient only, ranked + random, total_cost inline

.github/workflows/
  nightly-permutations.yml  GitHub Actions cron (2 AM UTC) — runs populate-ranked
```

---

## Modes

| Mode | When | Data source |
|------|------|-------------|
| **DB / Token Works** | `VITE_SUPABASE_*` env vars set | Supabase — random 2500 from 500K nightly pool |
| **My Checks** | DB mode + wallet connected | Client-side from owned tokens |
| **Explore** | DB mode (any connection state) | Client-side from entered token IDs |
| **Curated Checks** | DB mode (any connection state) | Supabase `curated_outputs` — community-liked composites |
| **Search Wallet** | DB mode + specific wallet connected | Client-side from any entered address (no DB writes) |
| **Chain mode** | Only `VITE_ALCHEMY_API_KEY` set | Live RPC — enter token IDs manually |

---

## Setup

### 1. Supabase

1. Create a [Supabase](https://supabase.com) project.
2. Run all migrations in order (`001` → `012`) via the SQL Editor in the Supabase Dashboard.
3. In **Settings → API**, set **Max Rows** to `5000`.
4. Note your **Project URL** and **publishable key** (Settings → API).

### 2. Backend — backfill + populate

```bash
cd backend
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY
npm install

# Fetch all TokenStrategy checks from chain into Supabase
npx tsx scripts/backfill.ts

# Populate ETH prices and backfill total_cost on existing permutation rows
npx tsx scripts/backfill-prices.ts

# Populate ranked permutations (low-band + gradient only, 500K cap, total_cost inline)
npm run populate-ranked
```

### 3. Nightly cron (GitHub Actions)

Add two repository secrets (**Settings → Secrets and variables → Actions**):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

The workflow `.github/workflows/nightly-permutations.yml` runs at 2 AM UTC, wiping and repopulating the permutations table with a fresh random sample (including `total_cost`).

### 4. Frontend

```bash
cd frontend
cp .env.example .env
# DB mode:    fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# Chain mode: fill in VITE_ALCHEMY_API_KEY only
npm install
npm run dev
```

---

## Contracts

| Contract | Address |
|----------|---------|
| Checks VV | `0x036721e5a769cc48b3189efbb9cce4471e8a48b1` |
| TokenStrategy | `0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc` |

---

## Tech Stack

- **Frontend** — React 19, Vite, TypeScript, wagmi v3, viem, `@supabase/supabase-js`
- **Backend scripts** — Node 20+, `tsx`, viem (multicall batching)
- **Database** — Supabase (Postgres + RLS + SECURITY DEFINER RPCs)
- **Rendering** — client-side JS port of `ChecksArt.sol`
