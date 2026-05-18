# All Checks Market Explorer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wallet-gated "All Checks" tab that browses permutations across all 5,360 market checks (not just TokenWorks inventory), backed by a nightly-refreshed `all_permutations` table and a one-time backfill of all market check data.

**Architecture:** Rename `tokenstr_checks` → `all_checks` (add `is_tokenstr`, `price_source`, `is_listed` columns). New `all_permutations` table (500K rows, nightly). New `backfill-market-checks.ts` script populates all 5,360 checks via Alchemy + viem multicall. New `populate-market-permutations.ts` does weighted diversity sampling. Frontend gets a new `useAllChecksPermutations` hook and `all-checks` view mode.

**Tech Stack:** PostgreSQL (Supabase), Deno edge functions, Node.js + viem + @supabase/supabase-js (backend scripts), React + TypeScript (frontend), Alchemy NFT API, OpenSea API v2.

---

## File Map

**Create:**
- `supabase/migrations/015_all_checks_rename.sql`
- `supabase/migrations/016_all_permutations.sql`
- `backend/scripts/backfill-market-checks.ts`
- `backend/scripts/backfill-market-prices.ts` ← **needs OpenSea API key**
- `backend/scripts/populate-market-permutations.ts`
- `frontend/src/useAllChecksPermutations.ts`

**Modify:**
- `supabase/functions/sync-tokenstr/index.ts` — string replace (4 refs)
- `supabase/functions/tokenstr-webhook/index.ts` — string replace (3 refs)
- `supabase/functions/checks-webhook/index.ts` — string replace (2 refs)
- `backend/scripts/populate-ranked-permutations.ts` — rename + add `is_tokenstr` filter + reduce cap
- `backend/scripts/backfill.ts` — string replace (2 refs)
- `backend/scripts/backfill-prices.ts` — string replace (3 refs)
- `frontend/src/usePermutationsDB.ts` — string replace (3 refs)
- `frontend/src/useCuratedOutputs.ts` — string replace (1 ref)
- `frontend/src/components/TreePanel.tsx` — string replace (1 ref) + price_source label
- `frontend/src/components/Navbar.tsx` — add All Checks tab
- `frontend/src/App.tsx` — add `all-checks` view mode

---

## Task 1: Migration 015 — rename + extend all_checks

**Files:**
- Create: `supabase/migrations/015_all_checks_rename.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/015_all_checks_rename.sql
-- Rename tokenstr_checks → all_checks.
-- FK constraints follow the rename automatically (PostgreSQL tracks by OID).
-- BUT stored SQL function bodies reference the old name by string — recreate them below.

ALTER TABLE tokenstr_checks RENAME TO all_checks;

-- ── New columns ───────────────────────────────────────────────────────────────
ALTER TABLE all_checks
  ADD COLUMN is_tokenstr  boolean NOT NULL DEFAULT false,
  ADD COLUMN price_source text,        -- 'contract' | 'opensea' | 'blur'
  ADD COLUMN is_listed    boolean NOT NULL DEFAULT false;

-- Backfill: mark the 693 existing tokenstr rows
UPDATE all_checks SET is_tokenstr = true, price_source = 'contract';

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_all_checks_is_tokenstr ON all_checks (is_tokenstr) WHERE NOT is_burned;
CREATE INDEX idx_all_checks_is_listed   ON all_checks (is_listed)   WHERE NOT is_burned;

-- ── Recreate SQL functions whose bodies reference tokenstr_checks by name ─────
-- update_permutation_costs (originally from 008_prices.sql)
CREATE OR REPLACE FUNCTION update_permutation_costs(p_token_id integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE permutations p
  SET total_cost =
    tc1.eth_price + tc2.eth_price + tc3.eth_price + tc4.eth_price
  FROM
    all_checks tc1, all_checks tc2, all_checks tc3, all_checks tc4
  WHERE
    tc1.token_id = p.keeper_1_id AND
    tc2.token_id = p.burner_1_id AND
    tc3.token_id = p.keeper_2_id AND
    tc4.token_id = p.burner_2_id AND
    tc1.eth_price IS NOT NULL AND
    tc2.eth_price IS NOT NULL AND
    tc3.eth_price IS NOT NULL AND
    tc4.eth_price IS NOT NULL AND
    (
      p.keeper_1_id = p_token_id OR
      p.burner_1_id = p_token_id OR
      p.keeper_2_id = p_token_id OR
      p.burner_2_id = p_token_id
    );
$$;

-- backfill_permutation_costs (originally from 008_prices.sql)
CREATE OR REPLACE FUNCTION backfill_permutation_costs()
RETURNS integer LANGUAGE sql AS $$
  UPDATE permutations p
  SET total_cost =
    tc1.eth_price + tc2.eth_price + tc3.eth_price + tc4.eth_price
  FROM
    all_checks tc1, all_checks tc2, all_checks tc3, all_checks tc4
  WHERE
    tc1.token_id = p.keeper_1_id AND
    tc2.token_id = p.burner_1_id AND
    tc3.token_id = p.keeper_2_id AND
    tc4.token_id = p.burner_2_id AND
    tc1.eth_price IS NOT NULL AND
    tc2.eth_price IS NOT NULL AND
    tc3.eth_price IS NOT NULL AND
    tc4.eth_price IS NOT NULL;

  SELECT count(*)::integer FROM permutations WHERE total_cost IS NOT NULL;
$$;
```

- [ ] **Step 2: Apply the migration via Supabase CLI**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite
supabase db push
```

Expected: migration applies cleanly. If you get "relation tokenstr_checks does not exist" the migration already ran. If you get other errors, check the Supabase dashboard SQL editor.

- [ ] **Step 3: Verify in Supabase SQL editor**

Run these two checks:

```sql
-- Table renamed and columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'all_checks'
ORDER BY ordinal_position;
-- Must include: is_tokenstr (boolean), price_source (text), is_listed (boolean)

-- 693 tokenstr rows backfilled
SELECT COUNT(*) FROM all_checks WHERE is_tokenstr = true;
-- Must return 693
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/015_all_checks_rename.sql
git commit -m "feat(db): rename tokenstr_checks to all_checks + add is_tokenstr/price_source/is_listed"
```

---

## Task 2: Migration 016 — all_permutations table

**Files:**
- Create: `supabase/migrations/016_all_permutations.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/016_all_permutations.sql
-- New table for market-wide permutations (500K rows, refreshed nightly).
-- color_family = colorIndexes()[0] / 10 → hue bucket 0-7 for diversity sampling.

CREATE TABLE all_permutations (
  id              bigserial   PRIMARY KEY,
  keeper_1_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  burner_1_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  keeper_2_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  burner_2_id     bigint      NOT NULL REFERENCES all_checks(token_id),
  abcd_checks     smallint,
  abcd_color_band text,
  abcd_gradient   text,
  abcd_speed      text,
  abcd_shift      text,
  color_family    smallint,
  total_cost      float,
  rand_key        float       NOT NULL DEFAULT random(),
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (keeper_1_id, burner_1_id, keeper_2_id, burner_2_id)
);

CREATE INDEX idx_all_perm_fingerprint  ON all_permutations (abcd_color_band, abcd_gradient, color_family);
CREATE INDEX idx_all_perm_rand_key     ON all_permutations (rand_key);
CREATE INDEX idx_all_perm_checks       ON all_permutations (abcd_checks);
CREATE INDEX idx_all_perm_color_band   ON all_permutations (abcd_color_band);
CREATE INDEX idx_all_perm_gradient     ON all_permutations (abcd_gradient);
CREATE INDEX idx_all_perm_speed        ON all_permutations (abcd_speed);
CREATE INDEX idx_all_perm_shift        ON all_permutations (abcd_shift);
CREATE INDEX idx_all_perm_total_cost   ON all_permutations (total_cost);
CREATE INDEX idx_all_perm_keeper_1     ON all_permutations (keeper_1_id);
CREATE INDEX idx_all_perm_keeper_2     ON all_permutations (keeper_2_id);

-- RLS: public read only
ALTER TABLE all_permutations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read all_permutations" ON all_permutations FOR SELECT USING (true);

-- Truncate helper (mirrors the one for permutations)
CREATE OR REPLACE FUNCTION truncate_all_permutations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  TRUNCATE TABLE all_permutations RESTART IDENTITY;
END;
$$;
```

- [ ] **Step 2: Apply**

```bash
supabase db push
```

- [ ] **Step 3: Verify**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name = 'all_permutations';
-- Returns one row
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_all_permutations.sql
git commit -m "feat(db): add all_permutations table with fingerprint + RLS"
```

---

## Task 3: String-replace tokenstr_checks → all_checks across all code

**Files:** All files listed in the "Modify" section of the file map above.

- [ ] **Step 1: Replace in edge functions**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite

# sync-tokenstr
sed -i '' 's/tokenstr_checks/all_checks/g' supabase/functions/sync-tokenstr/index.ts

# tokenstr-webhook
sed -i '' 's/tokenstr_checks/all_checks/g' supabase/functions/tokenstr-webhook/index.ts

# checks-webhook
sed -i '' 's/tokenstr_checks/all_checks/g' supabase/functions/checks-webhook/index.ts
```

- [ ] **Step 2: Replace in backend scripts**

```bash
sed -i '' 's/tokenstr_checks/all_checks/g' backend/scripts/backfill.ts
sed -i '' 's/tokenstr_checks/all_checks/g' backend/scripts/backfill-prices.ts
```

- [ ] **Step 3: Replace in frontend**

```bash
sed -i '' 's/tokenstr_checks/all_checks/g' frontend/src/usePermutationsDB.ts
sed -i '' 's/tokenstr_checks/all_checks/g' frontend/src/useCuratedOutputs.ts
sed -i '' 's/tokenstr_checks/all_checks/g' frontend/src/components/TreePanel.tsx
sed -i '' 's/tokenstr_checks/all_checks/g' frontend/src/App.tsx
```

- [ ] **Step 4: Verify no remaining references**

```bash
grep -rn "tokenstr_checks" \
  supabase/functions/ backend/scripts/ frontend/src/
# Must return zero lines
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ backend/scripts/ frontend/src/
git commit -m "refactor: rename tokenstr_checks → all_checks across all code"
```

---

## Task 4: Reduce tokenstr permutations cap 500K → 100K

**Files:**
- Modify: `backend/scripts/populate-ranked-permutations.ts`

- [ ] **Step 1: Apply two changes to the script**

In `populate-ranked-permutations.ts`, change line 27:
```typescript
// Before
const MAX_PERMS_PER_GROUP  = 500_000
// After
const MAX_PERMS_PER_GROUP  = 100_000
```

Also add `is_tokenstr` filter to the initial load query (around line 96 — the `.from('all_checks')` select block):
```typescript
// Before
    const { data: rawRows, error } = await supabase
      .from('all_checks')
      .select('token_id, checks_count, color_band, gradient, check_struct, eth_price')
      .eq('is_burned', false)
      .order('checks_count')

// After
    const { data: rawRows, error } = await supabase
      .from('all_checks')
      .select('token_id, checks_count, color_band, gradient, check_struct, eth_price')
      .eq('is_burned', false)
      .eq('is_tokenstr', true)
      .order('checks_count')
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/populate-ranked-permutations.ts
git commit -m "feat(backend): reduce tokenstr permutations cap to 100K, guard with is_tokenstr filter"
```

---

## Task 5: backfill-market-checks.ts — sync all 5,360 market checks

**Files:**
- Create: `backend/scripts/backfill-market-checks.ts`

This script enumerates all Checks VV tokens via Alchemy, batch-calls `getCheck()` + `ownerOf()` via viem multicall (fast — no tokenURI needed), derives attributes from the struct, and upserts into `all_checks` with `is_tokenstr = false`. SVGs are left null; they're generated client-side from `check_struct`.

- [ ] **Step 1: Create the script**

```typescript
/**
 * backfill-market-checks.ts
 *
 * Syncs ALL Checks VV tokens (not just TokenWorks wallet) into all_checks.
 * Uses Alchemy getNFTsForContract to enumerate token IDs, then viem multicall
 * to batch getCheck() + ownerOf() for all tokens in one RPC round-trip per batch.
 *
 * Derives attributes directly from check_struct — no tokenURI calls needed.
 * Sets is_tokenstr = false for all rows (tokenstr rows already have is_tokenstr = true).
 *
 * Usage:
 *   npx tsx scripts/backfill-market-checks.ts
 *   npx tsx scripts/backfill-market-checks.ts --incremental  # skip tokens synced <24h ago
 */

import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { createClient } from '@supabase/supabase-js'
import {
  mapCheckAttributes,
  checkStructToJSON,
  colorBandName,
  gradientName,
  formatSpeed,
  formatShift,
  type CheckStruct,
} from '../lib/engine.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const ALCHEMY_KEY       = process.env.ALCHEMY_API_KEY!
const CHECKS_CONTRACT   = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1' as const
const TOKENSTR_WALLET   = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'
const BATCH             = 500
const INCREMENTAL       = process.argv.includes('--incremental')

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ALCHEMY_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY.')
  process.exit(1)
}

// ─── Clients ─────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const viemClient = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  batch: { multicall: true },
})

// ─── ABI fragments ────────────────────────────────────────────────────────────

const ABI = [
  {
    name: 'getCheck',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'check',
        type: 'tuple',
        components: [
          {
            name: 'stored',
            type: 'tuple',
            components: [
              { name: 'composites',   type: 'uint16[6]' },
              { name: 'colorBands',   type: 'uint8[5]' },
              { name: 'gradients',    type: 'uint8[5]' },
              { name: 'divisorIndex', type: 'uint8' },
              { name: 'epoch',        type: 'uint32' },
              { name: 'seed',         type: 'uint16' },
              { name: 'day',          type: 'uint24' },
            ],
          },
          { name: 'isRevealed',    type: 'bool' },
          { name: 'seed',          type: 'uint256' },
          { name: 'checksCount',   type: 'uint8' },
          { name: 'hasManyChecks', type: 'bool' },
          { name: 'composite',     type: 'uint16' },
          { name: 'isRoot',        type: 'bool' },
          { name: 'colorBand',     type: 'uint8' },
          { name: 'gradient',      type: 'uint8' },
          { name: 'direction',     type: 'uint8' },
          { name: 'speed',         type: 'uint8' },
        ],
      },
    ],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// ─── Alchemy: enumerate all token IDs for the contract ───────────────────────

async function fetchAllContractTokenIds(): Promise<number[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForContract`
  const ids: number[] = []
  let pageKey: string | undefined

  do {
    const params = new URLSearchParams({
      contractAddress: CHECKS_CONTRACT,
      withMetadata:    'false',
      limit:           '100',
      ...(pageKey ? { pageKey } : {}),
    })
    const res = await fetch(`${base}?${params}`)
    if (!res.ok) throw new Error(`Alchemy error: ${res.status} ${await res.text()}`)
    const json = await res.json() as { nfts: { tokenId: string }[]; pageKey?: string }
    for (const nft of json.nfts) ids.push(Number(nft.tokenId))
    pageKey = json.pageKey
  } while (pageKey)

  return ids
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const logId = await startLog()
  let tokensProcessed = 0

  try {
    console.log('Fetching all Checks VV token IDs from Alchemy...')
    let allIds = await fetchAllContractTokenIds()
    console.log(`Found ${allIds.length} tokens on-chain.`)

    if (INCREMENTAL) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: synced } = await supabase
        .from('all_checks')
        .select('token_id')
        .eq('is_tokenstr', false)
        .gt('last_synced_at', cutoff)
      const syncedSet = new Set((synced ?? []).map((r: { token_id: number }) => r.token_id))
      const before = allIds.length
      allIds = allIds.filter(id => !syncedSet.has(id))
      console.log(`Incremental: skipping ${before - allIds.length} recently synced, processing ${allIds.length}.`)
    }

    for (let start = 0; start < allIds.length; start += BATCH) {
      const ids    = allIds.slice(start, start + BATCH)
      const bigIds = ids.map(id => BigInt(id))
      console.log(`Batch ${Math.floor(start / BATCH) + 1}/${Math.ceil(allIds.length / BATCH)}: tokens ${ids[0]}…${ids[ids.length - 1]}`)

      const [checkResults, ownerResults] = await Promise.all([
        Promise.allSettled(
          bigIds.map(id =>
            viemClient.readContract({ address: CHECKS_CONTRACT, abi: ABI, functionName: 'getCheck', args: [id] })
          )
        ),
        Promise.allSettled(
          bigIds.map(id =>
            viemClient.readContract({ address: CHECKS_CONTRACT, abi: ABI, functionName: 'ownerOf', args: [id] })
          )
        ),
      ])

      const rows: object[] = []

      for (let i = 0; i < ids.length; i++) {
        if (checkResults[i].status === 'rejected' || ownerResults[i].status === 'rejected') continue

        const checkStruct = (checkResults[i] as PromiseFulfilledResult<unknown>).value as CheckStruct
        const owner       = (ownerResults[i] as PromiseFulfilledResult<unknown>).value as string
        const isBurned    = owner.toLowerCase() === '0x0000000000000000000000000000000000000000'
        const isTokenstr  = owner.toLowerCase() === TOKENSTR_WALLET

        const attrs = mapCheckAttributes(checkStruct)
        const getAttr = (name: string) => attrs.find(a => a.trait_type === name)?.value ?? null

        rows.push({
          token_id:       ids[i],
          owner,
          is_burned:      isBurned,
          is_tokenstr:    isTokenstr,
          checks_count:   checkStruct.checksCount,
          color_band:     checkStruct.hasManyChecks ? colorBandName(checkStruct.colorBand) : null,
          gradient:       checkStruct.hasManyChecks ? gradientName(checkStruct.gradient)   : null,
          speed:          getAttr('Speed'),
          shift:          getAttr('Shift'),
          svg:            null,   // generated client-side from check_struct
          check_struct:   checkStructToJSON(checkStruct),
          last_synced_at: new Date().toISOString(),
          // is_listed and price_source left null — populated by backfill-market-prices
        })
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from('all_checks')
          .upsert(rows, { onConflict: 'token_id', ignoreDuplicates: false })
        if (error) throw error
        tokensProcessed += rows.length
        console.log(`  Upserted ${rows.length} (${tokensProcessed} total)`)
      }
    }

    await finishLog(logId, 'done', tokensProcessed)
    console.log(`\nDone. ${tokensProcessed} tokens synced.`)
  } catch (err) {
    await finishLog(logId, 'error', tokensProcessed, String(err))
    console.error('Backfill failed:', err)
    process.exit(1)
  }
}

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'backfill-market-checks', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

async function finishLog(id: number, status: 'done' | 'error', tokensProcessed: number, error_message?: string) {
  await supabase
    .from('sync_log')
    .update({ status, tokens_processed: tokensProcessed, error_message: error_message ?? null, finished_at: new Date().toISOString() })
    .eq('id', id)
}

main()
```

- [ ] **Step 2: Add script to package.json**

In `backend/package.json`, add to the `scripts` section:
```json
"backfill-market": "npx tsx scripts/backfill-market-checks.ts",
"backfill-market-incremental": "npx tsx scripts/backfill-market-checks.ts --incremental"
```

- [ ] **Step 3: Verify the script compiles**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite/backend
npx tsx --check scripts/backfill-market-checks.ts
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/backfill-market-checks.ts backend/package.json
git commit -m "feat(backend): add backfill-market-checks script — syncs all 5360 Checks VV tokens"
```

---

## Task 6: backfill-market-prices.ts — OpenSea price sync

**⚠️ API KEY NEEDED: Before running this script, add `OPENSEA_API_KEY=<your key>` to `backend/.env`.**

**Files:**
- Create: `backend/scripts/backfill-market-prices.ts`

Pages through all current OpenSea seaport listings for the Checks VV contract and records the floor price for each listed token. Updates `eth_price`, `price_source = 'opensea'`, `is_listed = true` in `all_checks` for non-tokenstr tokens.

- [ ] **Step 1: Create the script**

```typescript
/**
 * backfill-market-prices.ts
 *
 * Fetches current OpenSea listing prices for all non-tokenstr Checks VV tokens.
 * Pages through all seaport listings for the contract, builds a tokenId→price map,
 * then bulk-updates all_checks.
 *
 * Usage:
 *   npx tsx scripts/backfill-market-prices.ts
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENSEA_API_KEY
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const OPENSEA_API_KEY   = process.env.OPENSEA_API_KEY!
const CHECKS_CONTRACT   = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENSEA_API_KEY) {
  console.error('Missing env vars. Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENSEA_API_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── OpenSea: fetch all current listings for the contract ─────────────────────
// Returns a map of tokenId (number) → floor price in ETH (number)

async function fetchAllListings(): Promise<Map<number, number>> {
  const priceMap = new Map<number, number>()
  let next: string | null = null
  let page = 0

  do {
    const url = new URL('https://api.opensea.io/api/v2/orders/ethereum/seaport/listings')
    url.searchParams.set('asset_contract_address', CHECKS_CONTRACT)
    url.searchParams.set('order_by', 'eth_price')
    url.searchParams.set('order_direction', 'asc')
    url.searchParams.set('limit', '50')
    if (next) url.searchParams.set('cursor', next)

    const res = await fetch(url.toString(), {
      headers: {
        'x-api-key': OPENSEA_API_KEY,
        'Accept':    'application/json',
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenSea API error: ${res.status} ${body}`)
    }

    const json = await res.json() as {
      orders: {
        current_price: string
        protocol_data: {
          parameters: {
            offer: { token: string; identifierOrCriteria: string }[]
          }
        }
      }[]
      next: string | null
    }

    for (const order of json.orders) {
      const offer = order.protocol_data?.parameters?.offer?.[0]
      if (!offer) continue
      const tokenId  = Number(offer.identifierOrCriteria)
      const priceEth = Number(BigInt(order.current_price)) / 1e18
      // Keep the lowest price per token (orders are already sorted asc by eth_price)
      if (!priceMap.has(tokenId)) priceMap.set(tokenId, priceEth)
    }

    next = json.next ?? null
    page++
    console.log(`  Page ${page}: ${json.orders.length} orders, ${priceMap.size} unique tokens so far`)

    // Respect rate limits
    await new Promise(r => setTimeout(r, 200))
  } while (next)

  return priceMap
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching all OpenSea listings for Checks VV...')
  const priceMap = await fetchAllListings()
  console.log(`\nFetched prices for ${priceMap.size} listed tokens.`)

  // First: mark all non-tokenstr tokens as unlisted
  const { error: resetErr } = await supabase
    .from('all_checks')
    .update({ is_listed: false, eth_price: null, price_source: null })
    .eq('is_tokenstr', false)
  if (resetErr) throw resetErr

  // Then: update listed tokens in batches of 500
  const entries = Array.from(priceMap.entries())
  const BATCH = 500
  let updated = 0

  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH)
    await Promise.all(
      chunk.map(([tokenId, priceEth]) =>
        supabase
          .from('all_checks')
          .update({ eth_price: priceEth, price_source: 'opensea', is_listed: true })
          .eq('token_id', tokenId)
          .eq('is_tokenstr', false)
      )
    )
    updated += chunk.length
    console.log(`Updated ${updated}/${entries.length} listed tokens`)
  }

  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Add to package.json scripts**

```json
"backfill-market-prices": "npx tsx scripts/backfill-market-prices.ts"
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite/backend
npx tsx --check scripts/backfill-market-prices.ts
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/backfill-market-prices.ts backend/package.json
git commit -m "feat(backend): add backfill-market-prices script — OpenSea price sync for all_checks"
```

---

## Task 7: populate-market-permutations.ts — nightly diversity-weighted 500K

**Files:**
- Create: `backend/scripts/populate-market-permutations.ts`

Weighted shuffle: One-band tokens get 10× the selection probability of Eighty-band tokens. Runs until 500K rows committed, then stops. Uses same engine functions as the existing tokenstr script.

- [ ] **Step 1: Create the script**

```typescript
/**
 * populate-market-permutations.ts
 *
 * Nightly repopulation of all_permutations (500K rows).
 * Truncates existing rows, then samples from all non-burned 80-check tokens
 * in all_checks using a diversity-weighted shuffle:
 *   One → 10, Five → 8, Ten → 6, Twenty → 4, Forty → 3, Sixty → 2, Eighty → 1
 *
 * Usage:
 *   npm run populate-market
 */

import { createClient } from '@supabase/supabase-js'
import {
  simulateCompositeJS,
  mapCheckAttributes,
  computeL2,
  buildL2RenderMap,
  colorIndexes,
  checkStructFromJSON,
  type CheckStruct,
  type CheckStructJSON,
} from '../lib/engine.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const BATCH_SIZE           = 500
const MAX_PERMS            = 500_000

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckRow {
  token_id:     number
  checks_count: number
  color_band:   string | null
  gradient:     string | null
  check_struct: CheckStructJSON
  eth_price:    number | null
}

interface PermRow {
  keeper_1_id:     number
  burner_1_id:     number
  keeper_2_id:     number
  burner_2_id:     number
  abcd_checks:     number | null
  abcd_color_band: string | null
  abcd_gradient:   string | null
  abcd_speed:      string | null
  abcd_shift:      string | null
  color_family:    number
  rand_key:        number
  total_cost:      number | null
}

// ─── Weights ──────────────────────────────────────────────────────────────────

const BAND_WEIGHT: Record<string, number> = {
  One:    10,
  Five:   8,
  Ten:    6,
  Twenty: 4,
  Forty:  3,
  Sixty:  2,
  Eighty: 1,
}

function getWeight(colorBand: string | null): number {
  return BAND_WEIGHT[colorBand ?? 'Eighty'] ?? 1
}

// ─── Weighted shuffle ─────────────────────────────────────────────────────────
// Expands tokens by weight then Fisher-Yates shuffles the expanded list.
// Token with weight 10 appears 10× more often than weight 1.

function weightedShuffle(tokens: CheckRow[]): CheckRow[] {
  const expanded: CheckRow[] = []
  for (const t of tokens) {
    const w = getWeight(t.color_band)
    for (let i = 0; i < w; i++) expanded.push(t)
  }
  for (let i = expanded.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[expanded[i], expanded[j]] = [expanded[j], expanded[i]]
  }
  return expanded
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const logId = await startLog()
  let totalPerms = 0

  try {
    // 1. Truncate
    console.log('Truncating all_permutations...')
    const { error: truncErr } = await supabase.rpc('truncate_all_permutations')
    if (truncErr) throw truncErr
    console.log('Truncated.')

    // 2. Load all non-burned 80-check tokens
    console.log('Loading 80-check market tokens...')
    const { data: rawRows, error } = await supabase
      .from('all_checks')
      .select('token_id, checks_count, color_band, gradient, check_struct, eth_price')
      .eq('is_burned', false)
      .eq('checks_count', 80)

    if (error) throw error

    const tokens = rawRows as CheckRow[]
    console.log(`${tokens.length} eligible tokens.`)

    if (tokens.length < 4) {
      console.log('Not enough tokens.')
      await finishLog(logId, 'done', 0)
      return
    }

    // 3. Weighted shuffle
    const pool    = weightedShuffle(tokens)
    const structs = pool.map(t => checkStructFromJSON(t.check_struct))
    const n       = pool.length

    // 4. Enumerate 4-tuples
    const batch: PermRow[] = []
    let computed = 0

    outer:
    for (let i0 = 0; i0 < n; i0++) {
      for (let i1 = 0; i1 < n; i1++) {
        if (pool[i1].token_id === pool[i0].token_id) continue
        for (let i2 = 0; i2 < n; i2++) {
          if (pool[i2].token_id === pool[i0].token_id || pool[i2].token_id === pool[i1].token_id) continue
          for (let i3 = 0; i3 < n; i3++) {
            if (
              pool[i3].token_id === pool[i0].token_id ||
              pool[i3].token_id === pool[i1].token_id ||
              pool[i3].token_id === pool[i2].token_id
            ) continue

            try {
              const row = computePermutation(
                structs[i0], pool[i0].token_id, pool[i0].eth_price,
                structs[i1], pool[i1].token_id, pool[i1].eth_price,
                structs[i2], pool[i2].token_id, pool[i2].eth_price,
                structs[i3], pool[i3].token_id, pool[i3].eth_price,
              )
              batch.push(row)
              computed++
            } catch {
              continue
            }

            if (batch.length >= BATCH_SIZE) {
              await flushBatch(batch)
              totalPerms += batch.length
              batch.length = 0
              const pct = Math.round((computed / MAX_PERMS) * 100)
              process.stdout.write(`\r  ${pct}% (${computed.toLocaleString()} / ${MAX_PERMS.toLocaleString()})`)
            }

            if (computed >= MAX_PERMS) break outer
          }
        }
      }
    }

    if (batch.length > 0) {
      await flushBatch(batch)
      totalPerms += batch.length
    }

    console.log(`\nDone: ${totalPerms.toLocaleString()} permutations stored.`)
    await finishLog(logId, 'done', totalPerms)
  } catch (err) {
    await finishLog(logId, 'error', totalPerms, String(err))
    console.error('Script failed:', err)
    process.exit(1)
  }
}

// ─── Compute one permutation ───────────────────────────────────────────────────

function computePermutation(
  s0: CheckStruct, id0: number, price0: number | null,
  s1: CheckStruct, id1: number, price1: number | null,
  s2: CheckStruct, id2: number, price2: number | null,
  s3: CheckStruct, id3: number, price3: number | null,
): PermRow {
  const l1aStruct  = simulateCompositeJS(s0, s1, id1)
  const l1bStruct  = simulateCompositeJS(s2, s3, id3)
  const abcdStruct = computeL2(l1aStruct, l1bStruct)
  const abcdMap    = buildL2RenderMap(l1aStruct, l1bStruct, s1, s3)
  const abcdAttrs  = mapCheckAttributes(abcdStruct)
  const getAttr    = (name: string) => abcdAttrs.find(a => a.trait_type === name)?.value ?? null

  // color_family: first rendered color index, bucketed into 0-7
  const colorIdxs = colorIndexes(abcdStruct.stored.divisorIndex, abcdStruct, abcdMap)
  const colorFamily = Math.floor(colorIdxs[0] / 10)

  const total_cost = (price0 !== null && price1 !== null && price2 !== null && price3 !== null)
    ? price0 + price1 + price2 + price3
    : null

  return {
    keeper_1_id:     id0,
    burner_1_id:     id1,
    keeper_2_id:     id2,
    burner_2_id:     id3,
    abcd_checks:     getAttr('Checks') !== null ? Number(getAttr('Checks')) : null,
    abcd_color_band: getAttr('Color Band'),
    abcd_gradient:   getAttr('Gradient'),
    abcd_speed:      getAttr('Speed'),
    abcd_shift:      getAttr('Shift'),
    color_family:    colorFamily,
    rand_key:        Math.random(),
    total_cost,
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function flushBatch(batch: PermRow[]) {
  const { error } = await supabase
    .from('all_permutations')
    .upsert(batch, { onConflict: 'keeper_1_id,burner_1_id,keeper_2_id,burner_2_id', ignoreDuplicates: true })
  if (error) throw error
}

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'populate-market-permutations', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

async function finishLog(id: number, status: 'done' | 'error', permsComputed: number, errorMessage?: string) {
  await supabase
    .from('sync_log')
    .update({
      status,
      perms_computed:  permsComputed,
      error_message:   errorMessage ?? null,
      finished_at:     new Date().toISOString(),
    })
    .eq('id', id)
}

main()
```

- [ ] **Step 2: Export `colorIndexes` from engine if not already exported**

Check that `backend/lib/engine.ts` exports `colorIndexes`. It already does (line 329: `export function colorIndexes`). No change needed.

- [ ] **Step 3: Add to package.json scripts**

```json
"populate-market": "npx tsx scripts/populate-market-permutations.ts"
```

- [ ] **Step 4: Verify compilation**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite/backend
npx tsx --check scripts/populate-market-permutations.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/populate-market-permutations.ts backend/package.json
git commit -m "feat(backend): add populate-market-permutations script — 500K diversity-weighted nightly"
```

---

## Task 8: useAllChecksPermutations.ts — frontend data hook

**Files:**
- Create: `frontend/src/useAllChecksPermutations.ts`

Mirrors `usePermutationsDB` but queries `all_permutations`. The `fetchCheckStructMap` function (already updated in Task 3) queries `all_checks`, so check_struct lookups work for market tokens automatically.

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/useAllChecksPermutations.ts
import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { fromJSON, type PermRowBasic, type PermRow } from './usePermutationsDB'
import { fetchCheckStructMap } from './usePermutationsDB'
import { simulateCompositeJS, generateSVGJS, computeL2, buildL2RenderMap } from './checksArtJS'
import { mapCheckAttributes, type CheckStruct } from './utils'
import type { PermutationResult } from './useAllPermutations'

const RANDOM_TOTAL = 2500

async function attachChecksMarket(basicRows: PermRowBasic[]): Promise<PermRow[]> {
  const uniqueIds = [...new Set(
    basicRows.flatMap(r => [r.keeper_1_id, r.burner_1_id, r.keeper_2_id, r.burner_2_id])
  )]
  const map = await fetchCheckStructMap(uniqueIds)
  return basicRows
    .filter(r =>
      map.has(r.keeper_1_id) && map.has(r.burner_1_id) &&
      map.has(r.keeper_2_id) && map.has(r.burner_2_id)
    )
    .map(r => ({
      ...r,
      keeper_1: { check_struct: map.get(r.keeper_1_id)! },
      burner_1: { check_struct: map.get(r.burner_1_id)! },
      keeper_2: { check_struct: map.get(r.keeper_2_id)! },
      burner_2: { check_struct: map.get(r.burner_2_id)! },
    }))
}

function computeNodes(
  row: PermRow,
  id0: string, id1: string, id2: string, id3: string,
): Pick<PermutationResult, 'nodeL1a' | 'nodeL1b' | 'nodeAbcd'> {
  try {
    const k1 = fromJSON(row.keeper_1.check_struct)
    const b1 = fromJSON(row.burner_1.check_struct)
    const k2 = fromJSON(row.keeper_2.check_struct)
    const b2 = fromJSON(row.burner_2.check_struct)

    const l1aStruct  = simulateCompositeJS(k1, b1, row.burner_1_id)
    const l1bStruct  = simulateCompositeJS(k2, b2, row.burner_2_id)
    const abcdStruct = computeL2(l1aStruct, l1bStruct)
    const abcdMap    = buildL2RenderMap(l1aStruct, l1bStruct, b1, b2)

    let _l1aSvg: string | undefined
    let _l1bSvg: string | undefined
    let _abcdSvg: string | undefined

    return {
      nodeL1a: {
        name: `#${id0}+#${id1}`, attributes: mapCheckAttributes(l1aStruct),
        loading: false, error: '',
        get svg() { return (_l1aSvg ??= generateSVGJS(l1aStruct, new Map<number, CheckStruct>([[row.burner_1_id, b1]]))) },
      },
      nodeL1b: {
        name: `#${id2}+#${id3}`, attributes: mapCheckAttributes(l1bStruct),
        loading: false, error: '',
        get svg() { return (_l1bSvg ??= generateSVGJS(l1bStruct, new Map<number, CheckStruct>([[row.burner_2_id, b2]]))) },
      },
      nodeAbcd: {
        name: 'Final Composite', attributes: mapCheckAttributes(abcdStruct),
        loading: false, error: '',
        get svg() { return (_abcdSvg ??= generateSVGJS(abcdStruct, abcdMap)) },
      },
    }
  } catch (e) {
    const err = String(e)
    return {
      nodeL1a:  { name: `#${id0}+#${id1}`, svg: '', attributes: [], loading: false, error: err },
      nodeL1b:  { name: `#${id2}+#${id3}`, svg: '', attributes: [], loading: false, error: err },
      nodeAbcd: { name: 'Final Composite',  svg: '', attributes: [], loading: false, error: err },
    }
  }
}

function rowToResult(row: PermRow): PermutationResult {
  const id0 = String(row.keeper_1_id)
  const id1 = String(row.burner_1_id)
  const id2 = String(row.keeper_2_id)
  const id3 = String(row.burner_2_id)
  return {
    def: { indices: [0, 1, 2, 3], label: `#${id0}▸#${id1}, #${id2}▸#${id3}`, tokenIds: [id0, id1, id2, id3] },
    total_cost: row.total_cost,
    nodeA: { name: `Token #${id0}`, svg: '', attributes: [], loading: false, error: '' },
    nodeB: { name: `Token #${id1}`, svg: '', attributes: [], loading: false, error: '' },
    nodeC: { name: `Token #${id2}`, svg: '', attributes: [], loading: false, error: '' },
    nodeD: { name: `Token #${id3}`, svg: '', attributes: [], loading: false, error: '' },
    ...computeNodes(row, id0, id1, id2, id3),
  }
}

export interface AllChecksPermutationsState {
  permutations: PermutationResult[]
  loading: boolean
  error: string
}

export function useAllChecksPermutations() {
  const [state, setState] = useState<AllChecksPermutationsState>({
    permutations: [],
    loading: false,
    error: '',
  })

  const loadRandom = useCallback(async () => {
    if (!supabase) return
    setState(prev => ({ ...prev, loading: true, error: '', permutations: [] }))

    try {
      const { count } = await supabase
        .from('all_permutations')
        .select('*', { count: 'exact', head: true })

      const total  = count ?? 0
      const offset = total > RANDOM_TOTAL ? Math.floor(Math.random() * (total - RANDOM_TOTAL)) : 0

      const { data, error } = await supabase
        .from('all_permutations')
        .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost')
        .order('rand_key')
        .range(offset, offset + RANDOM_TOTAL - 1)

      if (error) throw error

      const basicRows = (data ?? []) as unknown as PermRowBasic[]
      const rows      = await attachChecksMarket(basicRows)

      setState({ permutations: rows.map(rowToResult), loading: false, error: '' })
    } catch (e) {
      setState(prev => ({ ...prev, loading: false, error: String(e) }))
    }
  }, [])

  const shuffle = useCallback(() => loadRandom(), [loadRandom])

  return { state, loadRandom, shuffle }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/useAllChecksPermutations.ts
git commit -m "feat(frontend): add useAllChecksPermutations hook for all_permutations table"
```

---

## Task 9: Frontend wiring — Navbar + App.tsx

**Files:**
- Modify: `frontend/src/components/Navbar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update Navbar.tsx ViewMode type and add tab**

In `Navbar.tsx`, change line 5:
```typescript
// Before
type ViewMode = 'token-works' | 'my-checks' | 'explore' | 'curated' | 'search-wallet'

// After
type ViewMode = 'token-works' | 'my-checks' | 'explore' | 'curated' | 'search-wallet' | 'all-checks'
```

Inside the `<div className="view-toggle">` block, add the "All Checks" button after the "Token Works" button (line ~76):

```tsx
{/* After the Token Works button */}
{isConnected && (
  <button
    className={`view-toggle-btn${viewMode === 'all-checks' ? ' view-toggle-btn--active' : ''}`}
    onClick={() => onViewModeChange('all-checks')}
  >All Checks</button>
)}
```

In the `<select>` element, add the matching option:
```tsx
{isConnected && <option value="all-checks">All Checks</option>}
```

- [ ] **Step 2: Update App.tsx — add all-checks view mode**

In `App.tsx`, update the `viewMode` state type (line 31):
```typescript
// Before
const [viewMode, setViewMode] = useState<'token-works' | 'my-checks' | 'explore' | 'curated' | 'search-wallet'>('token-works')

// After
const [viewMode, setViewMode] = useState<'token-works' | 'my-checks' | 'explore' | 'curated' | 'search-wallet' | 'all-checks'>('token-works')
```

Add the import at the top (near other hook imports):
```typescript
import { useAllChecksPermutations } from './useAllChecksPermutations'
```

Add the hook call (after the existing `useCuratedOutputs` hook, around line 70):
```typescript
// ── All Checks mode ───────────────────────────────────────────────────────────
const allChecks = useAllChecksPermutations()
```

Add a useEffect to load when the tab is selected (after the curated useEffect):
```typescript
useEffect(() => {
  if (!dbMode || viewMode !== 'all-checks') return
  allChecks.loadRandom()
}, [dbMode, viewMode])  // eslint-disable-line react-hooks/exhaustive-deps
```

Update the `isAllChecksMode` derived variable (add alongside `isCuratedMode`):
```typescript
const isAllChecksMode = dbMode && viewMode === 'all-checks'
```

Update the `permutations` derived value (add `isAllChecksMode` case at the top):
```typescript
const permutations = isAllChecksMode
  ? allChecks.state.permutations
  : isExploreMode
  ? explore.permutations
  : isCuratedMode
  // ... rest unchanged
```

Update `isLoading`:
```typescript
const isLoading = isAllChecksMode
  ? allChecks.state.loading
  : isExploreMode
  // ... rest unchanged
```

Update `handleShuffle`:
```typescript
function handleShuffle() {
  if (viewMode === 'my-checks') myCheckPerms.shuffle()
  else if (viewMode === 'search-wallet') searchCheckPerms.shuffle()
  else if (viewMode === 'explore') explore.shuffle()
  else if (viewMode === 'all-checks') allChecks.shuffle()
  else shuffleDB()
}
```

Update `showFilters`:
```typescript
const showFilters = isAllChecksMode
  ? allChecks.state.permutations.length > 0 || allChecks.state.loading
  : isExploreMode
  // ... rest unchanged
```

Update the `InfiniteGrid` `hideBuy` prop:
```typescript
hideBuy={isMyChecksMode || isSearchWalletMode || isExploreMode || isAllChecksMode}
```

Add empty state for All Checks (before the `<InfiniteGrid>` render, alongside other empty states):
```tsx
{isAllChecksMode && !allChecks.state.loading && allChecks.state.permutations.length === 0 && (
  <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
    No market permutations loaded yet.
  </div>
)}
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite/frontend
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Run dev server and verify the tab appears**

```bash
cd /Users/harsh/Desktop/Experiments/Infinite/frontend
npm run dev
```

- Connect a wallet → "All Checks" tab should appear in the nav
- Click it → should show loading state, then empty state (table is empty until backfill runs)
- Disconnect wallet → "All Checks" tab should disappear

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Navbar.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add All Checks tab — wallet-gated, loads from all_permutations"
```

---

## Running the backfills (do these in order)

After all code is committed and migrations are applied:

**Step A — Backfill all market checks** (no API key needed, uses Alchemy key already in `.env`):
```bash
cd /Users/harsh/Desktop/Experiments/Infinite/backend
npm run backfill-market
# Expected: ~5360 tokens synced, takes ~5-10 minutes
```

**Step B — Backfill market prices** (⚠️ needs OpenSea API key in `backend/.env` first):
```bash
# Add to backend/.env:  OPENSEA_API_KEY=<your key>
npm run backfill-market-prices
# Expected: pages through all OpenSea listings, updates eth_price for listed tokens
```

**Step C — Populate market permutations** (run after Step A):
```bash
npm run populate-market
# Expected: 500K permutations inserted, takes ~15-30 minutes
```

---

## Self-Review Notes

- `colorIndexes` is already exported from `engine.ts` — no change needed
- `fetchCheckStructMap` in `usePermutationsDB.ts` will query `all_checks` after Task 3 rename — works for market tokens automatically
- The `PermRowBasic` and `PermRow` types are imported from `usePermutationsDB` in the new hook — no duplication
- `populate-market-permutations.ts` uses `upsert` with `ignoreDuplicates: true` rather than `insert` — safe to re-run without duplicates
- The `is_tokenstr` flag prevents `populate-ranked-permutations.ts` from accidentally picking market tokens after migration
- SQL function bodies `update_permutation_costs` and `backfill_permutation_costs` are recreated in migration 015 — no runtime failures after rename
