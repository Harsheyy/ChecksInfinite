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
frontend/          React + Vite UI
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

backend/           Node.js data pipeline (tsx + viem)
  scripts/
    backfill.ts                      Fetch all TokenStrategy checks → Supabase
    backfill-market-checks.ts        Fetch all market (non-TokenStrategy) Checks → Supabase
    backfill-market-prices.ts        One-time: populate OpenSea prices for market checks
    populate-ranked-permutations.ts  Nightly (GitHub Actions): refresh Token Works pool
    populate-market-permutations.ts  Run when listings change: rebuild OpenSea permutation pool

supabase/
  functions/
    sync-tokenstr/        Hourly: reconcile TokenStrategy wallet + refresh prices via nftForSale()
    sync-market-prices/   Hourly: refresh OpenSea listing prices for all market checks
    tokenstr-webhook/     Alchemy webhook: real-time TokenStrategy transfer events
    checks-webhook/       Alchemy webhook: real-time burn/transfer events for all checks
  migrations/             001–023: full DB schema history

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
| **Real-time transfers** | Alchemy webhooks → edge functions | Instant |

---

## Setup

### 1. Supabase

1. Create a [Supabase](https://supabase.com) project.
2. Run all migrations in order (`001` → `023`) via `supabase db push`.
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

```bash
cd frontend
cp .env.example .env
# fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
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
