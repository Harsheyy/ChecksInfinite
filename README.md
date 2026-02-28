# Infinite — Checks VV Permutation Browser

Browse every possible two-step composite from the [Checks VV](https://checks.art) NFT collection.
Given four tokens (A, B, C, D) the viewer simulates the on-chain merge tree:

```
A + B → L1a      C + D → L1b
         L1a + L1b → ABCD (final composite)
```

The frontend renders all composites client-side using a JS port of `ChecksArt.sol`, so SVG output is pixel-identical to the contract.

---

## Architecture

```
frontend/          React + Vite UI
  src/
    checksArtJS.ts       JS port of the on-chain rendering engine
    usePermutationsDB.ts DB mode: loads from Supabase
    useAllPermutations.ts Chain mode: live RPC calls via viem
    components/
      InfiniteGrid.tsx   Looping torus grid (√N × √N layout)
      TreeModal.tsx      Merge tree detail view
      FilterBar.tsx      Server-side attribute filters

backend/           Node.js data pipeline (tsx + viem)
  scripts/
    backfill.ts          Fetches all listed tokens from chain → Supabase
    compute-permutations.ts  Pre-computes all P(n,4) permutations

supabase/
  migrations/      SQL schema & RLS policies
  functions/
    checks-webhook/  Alchemy webhook → keeps data fresh on transfers

Source/            Original Checks VV Solidity contracts (reference)
```

---

## Modes

| Mode | When | Data source |
|------|------|-------------|
| **DB mode** | `VITE_SUPABASE_*` env vars set | Supabase — pre-computed, filterable, ~2 000 items loaded on start |
| **Chain mode** | Only `VITE_ALCHEMY_API_KEY` set | Live RPC calls — enter token IDs manually |

---

## Setup

### 1. Supabase

1. Create a [Supabase](https://supabase.com) project.
2. Run the migrations in order:
   ```
   supabase/migrations/001_checks_backend.sql
   supabase/migrations/002_permutations_nullable_svgs.sql
   supabase/migrations/003_drop_abcd_svg.sql
   supabase/migrations/004_public_read_policies.sql
   ```
3. Note your **Project URL** and **anon public key** (Settings → API).

### 2. Backend — backfill & compute

```bash
cd backend
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY
npm install

# Fetch all listed Checks tokens from chain into Supabase
npm run backfill

# Pre-compute all permutations (P(n,4) per group, capped at MAX_GROUP_SIZE=30)
npm run compute-permutations
```

Add `--incremental` to either script to skip already-synced data.

### 3. Frontend

```bash
cd frontend
cp .env.example .env
# fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY  (DB mode)
# or just VITE_ALCHEMY_API_KEY                         (chain mode)
npm install
npm run dev
```

---

## Alchemy Webhook (optional — keeps data live)

Deploy the edge function and point an Alchemy Transfer webhook at it:

```bash
supabase functions deploy checks-webhook
```

Set `WEBHOOK_SIGNING_KEY` in your Supabase project secrets.

---

## Tech Stack

- **Frontend** — React 19, Vite, TypeScript, `@supabase/supabase-js`, `viem`
- **Backend scripts** — Node 20+, `tsx`, `viem` (multicall batching)
- **Database** — Supabase (Postgres + RLS)
- **Rendering** — client-side JS port of `ChecksArt.sol` (keccak256 via viem)
