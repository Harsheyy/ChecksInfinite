# Implementation Plan

---

## Change 1 — Rename `checks` table → `tokenstr_checks`

PostgreSQL auto-migrates FK constraints, indexes, sequences, and RLS policies on
`ALTER TABLE … RENAME TO`. Only the `listed_checks` view body must be explicitly
updated (it contains the literal table name).

---

### Task 1.1 — Migration `005_rename_checks_table.sql`

`supabase/migrations/005_rename_checks_table.sql`

```sql
ALTER TABLE checks RENAME TO tokenstr_checks;

-- View body references the old name — must recreate explicitly
DROP VIEW IF EXISTS listed_checks;

CREATE OR REPLACE VIEW listed_checks AS
SELECT c.*
FROM tokenstr_checks c
INNER JOIN vv_checks_listings l ON l.token_id = c.token_id::text
WHERE l.source = 'tokenworks'
  AND c.is_burned = false;
```

Verification: `SELECT tablename FROM pg_tables WHERE tablename = 'tokenstr_checks';`
Confirm FK targets on `permutations` point to `tokenstr_checks` via `\d permutations`.

---

### Task 1.2 — `backend/scripts/backfill.ts`

Replace every `.from('checks')` with `.from('tokenstr_checks')`.
No other changes needed — `vv_checks_listings` query is separate.

---

### Task 1.3 — `backend/scripts/compute-permutations.ts`

No direct `.from('checks')` calls — reads from the `listed_checks` view which is
recreated in 1.1. No edits needed.

Verify with: `grep -n "from('checks')" compute-permutations.ts` → zero results.

---

### Task 1.4 — `supabase/functions/checks-webhook/index.ts`

Replace `.from('checks')` → `.from('tokenstr_checks')` (two occurrences).

---

### Task 1.5 — `frontend/src/usePermutationsDB.ts`

In `fetchCheckStructMap`, change:
```ts
.from('checks').select('token_id, check_struct')
```
→
```ts
.from('tokenstr_checks').select('token_id, check_struct')
```

---

### Task 1.6 — `frontend/src/components/TreeModal.tsx`

In the lazy SVG fetch `useEffect`, change:
```ts
supabase.from('checks').select('token_id, svg')
```
→
```ts
supabase.from('tokenstr_checks').select('token_id, svg')
```

---

### Change 1 execution order

Apply migration 1.1 first (`supabase db push`), then deploy edge function (1.4),
then run backend scripts (1.2). Frontend changes (1.5, 1.6) can go any time
after the migration is applied.

---

## Change 2 — Replace TokenWorks data source with TokenStrategy wallet webhook

Track the wallet `0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc` in real-time
instead of pulling from `vv_checks_listings` (TokenWorks). The wallet holds
Checks VV tokens — when it receives one, upsert it; when it sends one, delete it.

---

### Task 2.1 — New edge function `supabase/functions/tokenstr-webhook/index.ts`

Model verbatim after `checks-webhook/index.ts`. Key differences:

**Constants**
```ts
const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const TOKENSTR_WALLET = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'
const TRANSFER_TOPIC  = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
```

**Required secrets** (add via `supabase secrets set`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALCHEMY_API_KEY`
- `TOKENSTR_WEBHOOK_SIGNING_KEY` ← new, from Alchemy webhook settings

**`handlePayload` logic** (replaces the existing webhook's dispatch logic):
```ts
for (const activity of activities) {
  const log = activity.log
  if (!log) continue
  if (log.address.toLowerCase() !== CHECKS_CONTRACT) continue
  if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue

  const from    = '0x' + log.topics[1].slice(26).toLowerCase()
  const to      = '0x' + log.topics[2].slice(26).toLowerCase()
  const tokenId = Number(BigInt(log.topics[3]))

  if (to === TOKENSTR_WALLET) {
    // Token arrived — fetch from chain and upsert
    await refetchAndUpsert(tokenId, alchemyKey, supabase)
  } else if (from === TOKENSTR_WALLET) {
    // Token left — delete and clean up permutations
    await supabase.from('tokenstr_checks').delete().eq('token_id', tokenId)
    await supabase.from('permutations').delete()
      .or(`keeper_1_id.eq.${tokenId},burner_1_id.eq.${tokenId},keeper_2_id.eq.${tokenId},burner_2_id.eq.${tokenId}`)
  }
}
```

All eth_call helpers (`ethCall`, `tokenURICalldata`, `getCheckCalldata`,
`ownerOfCalldata`, `decodeTokenURISVG`, `decodeGetCheck`, `verifyAlchemySignature`,
etc.) are copied verbatim from the existing webhook.

Target table in `refetchAndUpsert`: `.from('tokenstr_checks')`.
sync_log job name: `'tokenstr-webhook'`.

**Alchemy setup**: Create Address Activity webhook in Alchemy dashboard for
`0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc` on Ethereum Mainnet, pointing to
`<supabase-project-url>/functions/v1/tokenstr-webhook`.

---

### Task 2.2 — Rewrite `backend/scripts/backfill.ts`

Replace the `vv_checks_listings` source with the Alchemy NFT API. All
chain-fetch logic (multicall getCheck + tokenURI) and upsert logic stay the
same — only the token ID source changes.

**New constant**:
```ts
const TOKENSTR_WALLET = '0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc'
```

**Replace the listing query with**:
```ts
async function fetchWalletTokenIds(): Promise<number[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner`
  const ids: number[] = []
  let pageKey: string | undefined
  do {
    const params = new URLSearchParams({
      owner: TOKENSTR_WALLET,
      'contractAddresses[]': CHECKS_CONTRACT,
      withMetadata: 'false',
      pageSize: '100',
      ...(pageKey ? { pageKey } : {}),
    })
    const res  = await fetch(`${base}?${params}`)
    const json = await res.json() as { ownedNfts: { tokenId: string }[]; pageKey?: string }
    for (const nft of json.ownedNfts) ids.push(Number(nft.tokenId))
    pageKey = json.pageKey
  } while (pageKey)
  return ids
}
```

Also update `.from('checks')` → `.from('tokenstr_checks')` (same as Task 1.2).

---

### Task 2.3 — Migration `006_drop_listed_checks_view.sql`

`supabase/migrations/006_drop_listed_checks_view.sql`

```sql
-- listed_checks was backed by vv_checks_listings (TokenWorks).
-- tokenstr_checks is now the source of truth for the wallet inventory.
DROP VIEW IF EXISTS listed_checks;
```

---

### Task 2.4 — Update `backend/scripts/compute-permutations.ts`

Change the source from the `listed_checks` view to `tokenstr_checks` directly:

```ts
// Before
.from('listed_checks').select('token_id, checks_count, check_struct').order('checks_count')

// After
.from('tokenstr_checks')
  .select('token_id, checks_count, check_struct')
  .eq('is_burned', false)
  .order('checks_count')
```

The `.eq('is_burned', false)` replaces the filter that was inside the view.

---

### Change 2 execution order

1. Apply migration 005 (Change 1) then 006 (this change) sequentially.
2. Deploy `tokenstr-webhook` edge function + set secrets.
3. Run updated backfill for initial wallet inventory sync.
4. Run `compute-permutations` to rebuild the permutations table.

---

## Change 3 — Bulk buy 4 checks from TreeModal

### ⛔ BLOCKERS — user input required before Tasks 3.3 and 3.4 can be implemented

**BLOCKER A**: TokenStrategy contract address is unknown.
Needed as `VITE_TOKENSTR_CONTRACT_ADDRESS` in `frontend/.env`.

**BLOCKER B**: Full ABI for `buyTargetNFT (0xf392c716)` is unknown.
Provide the parameter names/types and whether it's payable (ETH or ERC-20).
Example format needed:
```json
{
  "name": "buyTargetNFT",
  "type": "function",
  "stateMutability": "payable",
  "inputs": [{ "name": "tokenId", "type": "uint256" }],
  "outputs": []
}
```

Tasks 3.1 and 3.2 (wallet connection) can be built immediately while waiting for
the blockers to be resolved.

---

### Task 3.1 — Install wagmi + set up WagmiProvider

```bash
cd frontend && npm install wagmi @tanstack/react-query
```
(`viem` is already a dependency.)

**New file `frontend/src/wagmiConfig.ts`**:
```ts
import { createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(
      import.meta.env.VITE_ALCHEMY_API_KEY
        ? `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
        : undefined
    ),
  },
})
```

**Edit `frontend/src/main.tsx`** — wrap with providers:
```tsx
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './wagmiConfig'

const queryClient = new QueryClient()

// Wrap <App /> with:
<WagmiProvider config={wagmiConfig}>
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
</WagmiProvider>
```

---

### Task 3.2 — Enable Connect Wallet in Navbar

**Edit `frontend/src/components/Navbar.tsx`**:
```tsx
import { useAccount, useConnect, useDisconnect } from 'wagmi'

// Inside Navbar:
const { address, isConnected } = useAccount()
const { connect, connectors }  = useConnect()
const { disconnect }           = useDisconnect()

const handleWallet = () => {
  if (isConnected) {
    disconnect()
  } else {
    const injected = connectors.find(c => c.id === 'injected')
    if (injected) connect({ connector: injected })
  }
}

// Replace disabled button:
<button type="button" className="nav-wallet" onClick={handleWallet}>
  {isConnected ? `${address?.slice(0,6)}…${address?.slice(-4)}` : 'Connect Wallet'}
</button>
```

---

### Task 3.3 — Add TokenStrategy ABI ⛔ BLOCKED

**New file `frontend/src/tokenStrategyAbi.ts`** (stub until blockers resolved):
```ts
// FILL IN after user provides contract address and ABI
export const TOKENSTR_CONTRACT = '0x...' as `0x${string}`

export const TOKENSTR_ABI = [
  // FILL IN: buyTargetNFT ABI fragment
] as const
```

---

### Task 3.4 — Buy All 4 button in TreeModal ⛔ BLOCKED on 3.3

**Changes needed across files**:

1. `frontend/src/App.tsx` — pass `dbMode` to `<InfiniteGrid dbMode={dbMode} />`
2. `frontend/src/components/InfiniteGrid.tsx` — add `dbMode?: boolean` to Props,
   thread it to `<TreeModal dbMode={dbMode} />`
3. `frontend/src/components/TreeModal.tsx` — add `dbMode?: boolean` to Props

**Inside TreeModal**:
```tsx
import { useAccount, useWriteContract } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { wagmiConfig } from '../wagmiConfig'
import { mainnet } from 'wagmi/chains'
import { TOKENSTR_CONTRACT, TOKENSTR_ABI } from '../tokenStrategyAbi'

const { isConnected } = useAccount()
const { writeContractAsync } = useWriteContract()
const [buyStates, setBuyStates] = useState<Record<string, 'idle'|'pending'|'confirmed'|'error'>>({})

async function handleBuyAll() {
  for (const tokenId of [id0, id1, id2, id3]) {
    setBuyStates(s => ({ ...s, [tokenId]: 'pending' }))
    try {
      const hash = await writeContractAsync({
        address: TOKENSTR_CONTRACT,
        abi: TOKENSTR_ABI,
        functionName: 'buyTargetNFT',
        args: [BigInt(tokenId)],  // adjust to match actual ABI
      })
      const client = getPublicClient(wagmiConfig, { chainId: mainnet.id })
      const receipt = await client.waitForTransactionReceipt({ hash })
      setBuyStates(s => ({ ...s, [tokenId]: receipt.status === 'success' ? 'confirmed' : 'error' }))
    } catch {
      setBuyStates(s => ({ ...s, [tokenId]: 'error' }))
    }
  }
}
```

**JSX** (after the tree layout):
```tsx
{dbMode && (
  <div className="tree-modal-buy">
    <button className="buy-btn" onClick={handleBuyAll}
      disabled={!isConnected || Object.values(buyStates).some(s => s === 'pending')}>
      {isConnected ? 'Buy All 4' : 'Connect wallet to buy'}
    </button>
    <div className="buy-status">
      {[id0, id1, id2, id3].map(id => buyStates[id] && buyStates[id] !== 'idle' && (
        <span key={id} className={`buy-status-${buyStates[id]}`}>
          #{id}: {buyStates[id] === 'pending' ? 'pending…' : buyStates[id]}
        </span>
      ))}
    </div>
  </div>
)}
```

**CSS additions to `frontend/src/index.css`**:
```css
.tree-modal-buy { margin-top: 1.5rem; text-align: center; }
.buy-btn { padding: 0.5rem 1.5rem; background: #fff; color: #000; border: none; cursor: pointer; font-size: 0.875rem; border-radius: 2px; }
.buy-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.buy-status { display: flex; gap: 0.75rem; justify-content: center; margin-top: 0.5rem; font-size: 0.72rem; flex-wrap: wrap; }
.buy-status-pending   { color: #888; }
.buy-status-confirmed { color: #4caf50; }
.buy-status-error     { color: #f44336; }
```

---

## Overall execution order

```
1. supabase db push 005_rename_checks_table.sql       (Change 1 gate)
2. Deploy checks-webhook with tokenstr_checks rename   (Change 1)
3. Update + run backfill script                        (Change 1 + 2 combined)
4. supabase db push 006_drop_listed_checks_view.sql    (Change 2)
5. Deploy tokenstr-webhook + set secrets               (Change 2)
6. Configure Alchemy Address Activity webhook          (Change 2)
7. Run compute-permutations against new inventory      (Change 2)
8. Deploy frontend table renames                       (Change 1 frontend)
── Resolve BLOCKER A + B ──────────────────────────────
9. npm install wagmi @tanstack/react-query             (Change 3)
10. Implement wagmiConfig + WagmiProvider in main.tsx  (Change 3)
11. Enable Connect Wallet in Navbar                    (Change 3)
12. Fill in tokenStrategyAbi.ts                        (Change 3)
13. Add Buy All 4 to TreeModal                         (Change 3)
```

## File summary

| File | Status |
|---|---|
| `supabase/migrations/005_rename_checks_table.sql` | New |
| `supabase/migrations/006_drop_listed_checks_view.sql` | New |
| `backend/scripts/backfill.ts` | Edit — new data source + table rename |
| `backend/scripts/compute-permutations.ts` | Edit — read tokenstr_checks directly |
| `supabase/functions/checks-webhook/index.ts` | Edit — table rename |
| `supabase/functions/tokenstr-webhook/index.ts` | New |
| `frontend/src/usePermutationsDB.ts` | Edit — table rename |
| `frontend/src/components/TreeModal.tsx` | Edit — table rename + buy button |
| `frontend/src/components/InfiniteGrid.tsx` | Edit — thread dbMode prop |
| `frontend/src/components/Navbar.tsx` | Edit — enable Connect Wallet |
| `frontend/src/App.tsx` | Edit — pass dbMode to InfiniteGrid |
| `frontend/src/main.tsx` | Edit — add WagmiProvider |
| `frontend/src/wagmiConfig.ts` | New |
| `frontend/src/tokenStrategyAbi.ts` | New ⛔ BLOCKED |
| `frontend/src/index.css` | Edit — buy button styles |
