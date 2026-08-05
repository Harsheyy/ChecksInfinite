# Checks Infinite

Browse every possible two-step composite from the [Checks VV](https://checks.art) NFT collection. Given four tokens (A, B, C, D) the app simulates the on-chain merge tree:

```
A + B → L1a      C + D → L1b
         L1a + L1b → ABCD (final composite)
```

SVG rendering is done entirely client-side via a JS port of `ChecksArt.sol`, producing pixel-identical output to the contract.

---

## Features

- **Token Works** — randomly sampled feed of pre-computed composites from a nightly-refreshed pool of TokenStrategy-held checks
- **OpenSea** — browse buyable 4-token recipes built from checks currently listed on OpenSea, with per-token prices and direct OS links
- **My Checks** — connect your wallet to see composites generated from checks you own
- **Explore** — enter any token IDs to compute composites on the fly (no wallet required)
- **Curated Checks** — community-liked outputs; heart any composite to add it; toggle between Community and Mine views
- **Search Wallet** — explore any wallet's permutations on-the-fly (no DB writes)
- **Filters** — by Checks count, Color Band, Gradient, Speed, Shift, Token IDs, and ETH cost range
- **Mint** — purchase all four leaf checks and composite them in one transaction via the ChecksRecipeMinter contract (Token Works)
- **Infinite torus grid** — seamlessly looping virtualised grid for large result sets
- **Responsive** — inline filter bar on desktop, collapsible side panel on mobile

---

## Architecture

```
apps/works/        React + Vite UI (permutation browser) — explore.checks.wiki
  src/
    checksArtJS.ts                JS port of the on-chain rendering engine
    usePermutationsDB.ts          Token Works feed: loads from Supabase, price hooks
    useAllChecksPermutations.ts   OpenSea feed: listed-only permutations from all_permutations
    useAllPermutations.ts         Chain mode: live RPC calls via viem
    useMyChecks.ts                Fetches tokens owned by connected wallet
    useMyCheckPermutations.ts     Generates composites from owned checks
    useExplorePermutations.ts     Explore mode: arbitrary token ID search
    useCuratedOutputs.ts          Curated mode: loads liked outputs from Supabase
    useMyLikedKeys.ts             Tracks which outputs the connected wallet has liked
    permutationsCache.ts          sessionStorage cache (10 min TTL) for both feeds
    components/
      InfiniteGrid.tsx       Looping torus grid
      TreePanel.tsx          Merge tree detail view + like button + mint/buy flow
      FilterBar.tsx          Filters + price slider + source switcher
      Navbar.tsx             View toggle, wallet connect
      SearchPage.tsx         Search by IDs / wallet / traits, plus the Patterns browser
      PatternsBrowse.tsx     Pattern catalog + composer (layouts index from Supabase Storage)

apps/checkmath/    React + Vite UI (Buy vs. Build calculator) — checkmath.checks.wiki
  src/
    useCheckmathSnapshot.ts       Latest hourly snapshot: cheapest single vs. optimal combination
    useCheckmathHistory.ts        Daily price history + sale/composite event markers
    components/                   Verdict, CheapestSingle, OptimalCombination,
                                  SweepCalculator, PriceHistory

apps/landing/      React + Vite landing page — checks.wiki
packages/shared/   Supabase client + Footer shared across all three apps

backend/           Node.js data pipeline (tsx + viem)
  scripts/
    backfill.ts                      Fetch all TokenStrategy checks → Supabase
    backfill-market-checks.ts        Fetch all market (non-TokenStrategy) Checks → Supabase
    backfill-market-prices.ts        One-time: populate OpenSea prices for market checks
    backfill-prices.ts               One-time: populate on-chain prices + permutation costs
    backfill-editions.ts             One-time: populate the editions_checks table
    backfill-market-svg.ts           One-time: recompute stored SVGs for market checks
    backfill-check-sales.ts          One-time: seed checkmath_events from historical sales
    populate-ranked-permutations.ts  Nightly (GitHub Actions): refresh Token Works pool
    populate-market-permutations.ts  Run when listings change: rebuild OpenSea permutation pool
    hunt-diversity.ts                Offline search for diverse pattern recipes
    build-layouts-index.ts           Build the pattern layouts index consumed by PatternsBrowse
    upload-layouts-index.ts          Upload that index to Supabase Storage

supabase/
  functions/
    sync-tokenstr/        Hourly (:05): reconcile TokenStrategy wallet + prices via nftForSale()
    sync-market-prices/   Hourly (:15): refresh OpenSea listing prices for all market checks
    sync-editions-prices/ Hourly (:20): refresh OpenSea listing prices for editions
    sync-checkmath/       Hourly (:30): recompute the Checkmath snapshot + event markers
    tokenstr-webhook/     Alchemy webhook: real-time TokenStrategy transfer events
    checks-webhook/       Alchemy webhook: real-time burn/transfer events for all checks
    credits-webhook/      Alchemy webhook: credits a wallet on inbound ETH transfer
    siwe-nonce/           Issues a nonce for Sign-In With Ethereum
    siwe-verify/          Verifies the SIWE signature and opens a session
  migrations/             001–052: full DB schema history

  All four hourly jobs are pg_cron entries calling the functions over pg_net;
  their schedules live in migrations 025, 043 and 045.

contracts/
  src/ChecksRecipeMinter.sol   Purchases 4 TokenStrategy checks + composites in one tx
  deployments/mainnet.json     Deployed addresses

.github/workflows/
  nightly-permutations.yml  2 AM UTC cron — refreshes Token Works pool
  keep-alive.yml            1st of each month — prevents GitHub disabling scheduled workflows
```

---

## Data flows

| Feed | Source | Refresh cadence |
|------|--------|-----------------|
| **Token Works** | `permutations` table — TokenStrategy-held checks | Nightly (GitHub Actions) |
| **OpenSea** | `all_permutations` table — listed market checks | Manual re-run of `populate-market` when listings change significantly |
| **TokenStrategy prices** | `all_checks.eth_price` via `nftForSale()` on-chain | Hourly (`sync-tokenstr` edge function) |
| **OpenSea prices** | `all_checks.eth_price` via OpenSea listings API | Hourly (`sync-market-prices` edge function) |
| **Editions prices** | `editions_checks.eth_price` via OpenSea listings API | Hourly (`sync-editions-prices` edge function) |
| **Checkmath** | `checkmath_snapshots` / `checkmath_singles` / `checkmath_events` | Hourly (`sync-checkmath` edge function) |
| **Real-time transfers** | Alchemy webhooks → edge functions | Instant |

---

## Setup

### 1. Supabase

1. Create a [Supabase](https://supabase.com) project.
2. Run all migrations in order (`001` → `052`) via `supabase db push`.
3. Deploy edge functions: `supabase functions deploy`.
4. Note your **Project URL** and **anon key** (Settings → API).

### 2. Backend — initial backfill

```bash
cd backend
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY
npm install

# Fetch all TokenStrategy wallet checks into Supabase
npm run backfill

# Fetch all market (non-TokenStrategy) checks into Supabase
npm run backfill-market

# Populate the Token Works permutation pool
npm run populate-ranked

# Populate the OpenSea permutation pool (re-run whenever listing landscape changes)
npm run populate-market
```

### 3. GitHub Actions secrets

Add to **Settings → Secrets and variables → Actions**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

### 4. Supabase edge function secrets

Set in **Supabase Dashboard → Edge Functions → Secrets**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALCHEMY_API_KEY`
- `OPENSEA_API_KEY`
- `ALCHEMY_WEBHOOK_SECRET` (for webhook signature verification)

### 5. Frontend

The three apps are npm workspaces, so install once from the repo root.

```bash
npm install                       # from the repo root — installs all workspaces

cp apps/works/.env.example apps/works/.env
# fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, and for the works app also
# VITE_ALCHEMY_API_KEY, VITE_WALLETCONNECT_PROJECT_ID,
# VITE_CHECKS_RECIPE_MINTER_ADDRESS

npm run dev -w apps/works         # permutation browser  — explore.checks.wiki
npm run dev -w apps/checkmath     # Buy vs. Build calc   — checkmath.checks.wiki
npm run dev -w apps/landing       # landing page         — checks.wiki
```

---

## Contracts

| Contract | Address |
|----------|---------|
| Checks VV | `0x036721e5a769cc48b3189efbb9cce4471e8a48b1` |
| TokenStrategy | `0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc` |
| ChecksRecipeMinter | See `contracts/deployments/mainnet.json` |

---

## Tech Stack

- **Frontend** — React 19, Vite, TypeScript, wagmi v3, viem, `@supabase/supabase-js`
- **Backend scripts** — Node 20+, `tsx`, viem
- **Database** — Supabase (Postgres + RLS + pg_cron + SECURITY DEFINER RPCs)
- **Edge functions** — Supabase (Deno runtime)
- **Rendering** — client-side JS port of `ChecksArt.sol`
