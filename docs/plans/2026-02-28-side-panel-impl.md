# Side Panel + Compact Tree Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the centered TreeModal with a right-anchored side panel that has a sticky buy footer and a compact two-branch tree layout.

**Architecture:** Rename `TreeModal.tsx` → `TreePanel.tsx`, restructure into a fixed right panel with `overflow-y: auto` body and `position: sticky` footer. Add a `compact` prop to `CheckCard` that shows only SVG + two key attributes. Use pure CSS `@keyframes` for the slide-in animation and CSS borders for branch connectors.

**Tech Stack:** React 19, CSS (no new dependencies), Vitest + Testing Library

---

### Task 1: Add `compact` prop to CheckCard

**Files:**
- Modify: `frontend/src/components/CheckCard.tsx`
- Modify: `frontend/src/components/CheckCard.test.tsx`

**Step 1: Write the failing tests**

Add to `CheckCard.test.tsx`:

```tsx
it('compact: renders only Checks and Color Band attributes', () => {
  const attrs = [
    { trait_type: 'Checks', value: '20' },
    { trait_type: 'Color Band', value: 'Sixty' },
    { trait_type: 'Speed', value: '2x' },
    { trait_type: 'Gradient', value: 'None' },
  ]
  render(<CheckCard name="Token" svg="<svg/>" attributes={attrs} compact />)
  expect(screen.getByText('Checks')).toBeInTheDocument()
  expect(screen.getByText('Color Band')).toBeInTheDocument()
  expect(screen.queryByText('Speed')).toBeNull()
  expect(screen.queryByText('Gradient')).toBeNull()
})

it('compact: still renders the token name and svg', () => {
  render(<CheckCard name="Token #42" svg="<svg/>" attributes={[]} compact />)
  expect(screen.getByText('Token #42')).toBeInTheDocument()
})
```

**Step 2: Run to verify they fail**

```bash
cd frontend && npm test -- --reporter=verbose 2>&1 | grep -A3 "compact"
```
Expected: 2 FAIL

**Step 3: Implement `compact` prop in CheckCard.tsx**

```tsx
const COMPACT_ATTRS = ['Checks', 'Color Band']

interface CheckCardProps {
  name: string
  svg: string
  attributes: Attribute[]
  loading?: boolean
  error?: string
  label?: string
  sublabel?: string
  compact?: boolean   // ← add this
}

export function CheckCard({ name, svg, attributes, loading, error, label, sublabel, compact }: CheckCardProps) {
  const visibleAttrs = compact
    ? attributes.filter(a => COMPACT_ATTRS.includes(a.trait_type))
    : attributes

  return (
    <div className="check-card">
      {(label || sublabel) && (
        <div className="check-card-label-row">
          {label && <span className="check-card-label">{label}</span>}
          {sublabel && <span className="check-card-sublabel">{sublabel}</span>}
        </div>
      )}
      {loading && <div className="check-card-loading">Loading…</div>}
      {error && <div className="check-card-error">{error}</div>}
      {!loading && !error && (
        <>
          <h2 className="check-card-name">{name}</h2>
          {svg && (
            <div className="check-card-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
          <dl className="check-card-attrs">
            {visibleAttrs.map((attr) => (
              <div key={attr.trait_type} className="check-card-attr">
                <dt>{attr.trait_type}</dt>
                <dd>{attr.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  )
}
```

**Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|compact"
```
Expected: all CheckCard tests PASS

**Step 5: Commit**

```bash
git add frontend/src/components/CheckCard.tsx frontend/src/components/CheckCard.test.tsx
git commit -m "feat: add compact prop to CheckCard (shows Checks + Color Band only)"
```

---

### Task 2: Create TreePanel.tsx

**Files:**
- Create: `frontend/src/components/TreePanel.tsx`
- Create: `frontend/src/components/TreePanel.test.tsx`

**Step 1: Write failing tests in TreePanel.test.tsx**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TreePanel } from './TreePanel'
import { WagmiWrapper } from '../test-utils'
import type { PermutationResult } from '../useAllPermutations'

function makeResult(): PermutationResult {
  const card = { name: 'Token', svg: '', attributes: [], loading: false, error: '' }
  return {
    def: { indices: [0,1,2,3], label: '#1▸#2, #3▸#4', tokenIds: ['1','2','3','4'] },
    nodeA: card, nodeB: card, nodeC: card, nodeD: card,
    nodeL1a: card, nodeL1b: card, nodeAbcd: card,
  }
}

function renderPanel(onClose = vi.fn()) {
  return render(
    <WagmiWrapper>
      <TreePanel result={makeResult()} ids={[]} onClose={onClose} />
    </WagmiWrapper>
  )
}

describe('TreePanel', () => {
  it('renders the panel (not an overlay)', () => {
    const { container } = renderPanel()
    expect(container.querySelector('.tree-panel')).toBeTruthy()
    expect(container.querySelector('.tree-modal-overlay')).toBeNull()
  })

  it('shows the permutation label in the header', () => {
    renderPanel()
    expect(screen.getByText('#1▸#2, #3▸#4')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    renderPanel(onClose)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderPanel(onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a sticky footer with buy button in dbMode', () => {
    render(
      <WagmiWrapper>
        <TreePanel result={makeResult()} ids={[]} onClose={vi.fn()} dbMode />
      </WagmiWrapper>
    )
    expect(document.querySelector('.tree-panel-footer')).toBeTruthy()
    expect(screen.getByRole('button', { name: /buy/i })).toBeInTheDocument()
  })

  it('does not render the footer outside dbMode', () => {
    renderPanel()
    expect(document.querySelector('.tree-panel-footer')).toBeNull()
  })
})
```

**Step 2: Run to verify they fail**

```bash
cd frontend && npm test -- TreePanel --reporter=verbose 2>&1 | tail -15
```
Expected: all FAIL (module not found)

**Step 3: Create TreePanel.tsx**

Copy `TreeModal.tsx` as the starting point, then apply all structural changes:

```tsx
import { useEffect, useState } from 'react'
import { useAccount, useReadContracts, useWriteContract } from 'wagmi'
import { formatEther } from 'viem'
import { CheckCard } from './CheckCard'
import { supabase } from '../supabaseClient'
import { tokenStrategyAbi, TOKEN_STRATEGY_ADDRESS } from '../tokenStrategyAbi'
import type { PermutationResult } from '../useAllPermutations'
import type { CardState } from '../utils'

interface TreePanelProps {
  result: PermutationResult
  ids: string[]
  onClose: () => void
  dbMode?: boolean
}

function cardProps(card: CardState, svgOverride?: string) {
  return { name: card.name, svg: svgOverride ?? card.svg, attributes: card.attributes, loading: card.loading, error: card.error }
}

export function TreePanel({ result, ids, onClose, dbMode }: TreePanelProps) {
  const { def, nodeA, nodeB, nodeC, nodeD, nodeL1a, nodeL1b, nodeAbcd } = result
  const [p0, p1, p2, p3] = def.indices
  const [id0, id1, id2, id3] = def.tokenIds ?? [ids[p0], ids[p1], ids[p2], ids[p3]]

  // Lazy-load individual check SVGs (DB mode omits them from the grid query)
  const [liveSvgs, setLiveSvgs] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!supabase || nodeA.svg) return
    const tokenIds = [id0, id1, id2, id3].map(Number)
    supabase
      .from('tokenstr_checks')
      .select('token_id, svg')
      .in('token_id', tokenIds)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, string> = {}
        for (const row of data as { token_id: number; svg: string }[]) {
          map[String(row.token_id)] = row.svg
        }
        setLiveSvgs(map)
      })
  }, [nodeA.svg, id0, id1, id2, id3])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // ── Buy all 4 (DB mode only) ───────────────────────────────────────────────
  const { isConnected } = useAccount()
  const tokenIdsBigInt = [id0, id1, id2, id3].map(BigInt)

  const { data: priceData } = useReadContracts({
    contracts: tokenIdsBigInt.map(tokenId => ({
      address: TOKEN_STRATEGY_ADDRESS,
      abi: tokenStrategyAbi,
      functionName: 'nftForSale' as const,
      args: [tokenId] as const,
    })),
    query: { enabled: !!dbMode },
  })

  const prices = priceData?.map(p => p.status === 'success' ? p.result as bigint : null) ?? []
  const allPricesLoaded = prices.length === 4 && prices.every(p => p !== null)
  const totalPrice = allPricesLoaded ? prices.reduce((sum, p) => sum! + p!, 0n) : null

  const { writeContractAsync } = useWriteContract()
  const [buyState, setBuyState] = useState<'idle' | 'buying' | 'done' | 'error'>('idle')
  const [buyIndex, setBuyIndex] = useState(0)

  async function handleBuyAll() {
    if (!allPricesLoaded || !isConnected) return
    setBuyState('buying')
    try {
      for (let i = 0; i < 4; i++) {
        setBuyIndex(i)
        const price = prices[i]!
        await writeContractAsync({
          address: TOKEN_STRATEGY_ADDRESS,
          abi: tokenStrategyAbi,
          functionName: 'sellTargetNFT',
          args: [price, tokenIdsBigInt[i]],
          value: price,
        })
      }
      setBuyState('done')
    } catch {
      setBuyState('error')
    }
  }

  function priceLabel(i: number): string | undefined {
    if (!dbMode || !prices[i]) return undefined
    return `${formatEther(prices[i]!)} ETH`
  }

  function buyLabel() {
    if (!dbMode) return null
    if (!allPricesLoaded) return 'Fetching prices…'
    if (!isConnected) return 'Connect wallet to buy'
    if (buyState === 'buying') return `Buying ${buyIndex + 1} / 4…`
    if (buyState === 'done') return 'Bought!'
    if (buyState === 'error') return 'Failed — try again'
    return `Buy All 4  (${formatEther(totalPrice!)} ETH)`
  }

  const buyDisabled =
    !dbMode ||
    !allPricesLoaded ||
    !isConnected ||
    buyState === 'buying' ||
    buyState === 'done'

  return (
    <div className="tree-panel">
      <div className="tree-panel-header">
        <span className="tree-panel-title">{def.label}</span>
        <button className="tree-panel-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="tree-panel-body">
        <div className="tree-layout">
          {/* Row 0: two leaf pairs */}
          <div className="tree-row-leaves">
            <div className="tree-branch">
              <div className="tree-branch-pair">
                <CheckCard compact label={`Keeper #${id0}`} sublabel={priceLabel(0)} {...cardProps(nodeA, liveSvgs[id0])} />
                <CheckCard compact label={`Burn #${id1}`}   sublabel={priceLabel(1)} {...cardProps(nodeB, liveSvgs[id1])} />
              </div>
              <div className="tree-connector-v" />
              <CheckCard compact label={`#${id0}+#${id1}`} {...cardProps(nodeL1a)} />
              <div className="tree-connector-v" />
            </div>
            <div className="tree-branch">
              <div className="tree-branch-pair">
                <CheckCard compact label={`Keeper #${id2}`} sublabel={priceLabel(2)} {...cardProps(nodeC, liveSvgs[id2])} />
                <CheckCard compact label={`Burn #${id3}`}   sublabel={priceLabel(3)} {...cardProps(nodeD, liveSvgs[id3])} />
              </div>
              <div className="tree-connector-v" />
              <CheckCard compact label={`#${id2}+#${id3}`} {...cardProps(nodeL1b)} />
              <div className="tree-connector-v" />
            </div>
          </div>

          {/* Horizontal merge connector */}
          <div className="tree-connector-merge" />

          {/* Final result */}
          <CheckCard compact label="Final Composite" {...cardProps(nodeAbcd)} />
        </div>

        {dbMode && (
          <div className="tree-panel-footer">
            <button
              className={`tree-buy-btn${buyState === 'done' ? ' tree-buy-btn--done' : ''}${buyState === 'error' ? ' tree-buy-btn--error' : ''}`}
              onClick={handleBuyAll}
              disabled={buyDisabled}
            >
              {buyLabel()}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 4: Run tests**

```bash
cd frontend && npm test -- TreePanel --reporter=verbose 2>&1 | tail -20
```
Expected: all 6 PASS

**Step 5: Commit**

```bash
git add frontend/src/components/TreePanel.tsx frontend/src/components/TreePanel.test.tsx
git commit -m "feat: add TreePanel side panel component"
```

---

### Task 3: Update InfiniteGrid to use TreePanel

**Files:**
- Modify: `frontend/src/components/InfiniteGrid.tsx`
- Modify: `frontend/src/components/InfiniteGrid.test.tsx`

**Step 1: Update the import and usage in InfiniteGrid.tsx**

Find the two occurrences of `TreeModal` in `InfiniteGrid.tsx` and replace:

```tsx
// Change:
import { TreeModal } from './TreeModal'
// To:
import { TreePanel } from './TreePanel'

// Change both JSX usages:
// <TreeModal result={...} ... />
// To:
// <TreePanel result={...} ... />
```

**Step 2: Update the test in InfiniteGrid.test.tsx**

The existing test `'opens TreeModal when a card is clicked'` checks for `.tree-modal-overlay`. Update it:

```tsx
it('opens TreePanel when a card is clicked', () => {
  const perms = [makePermutation('A▸B, C▸D')]
  const { container } = renderGrid({
    permutations: perms, ids: ['1','2','3','4'], showFlags: [true],
  })
  const card = container.querySelector('.perm-card') as HTMLElement
  fireEvent.click(card)
  expect(document.querySelector('.tree-panel')).toBeTruthy()
})
```

**Step 3: Run all tests**

```bash
cd frontend && npm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: all PASS (no `.tree-modal-overlay` reference remains)

**Step 4: Commit**

```bash
git add frontend/src/components/InfiniteGrid.tsx frontend/src/components/InfiniteGrid.test.tsx
git commit -m "feat: wire InfiniteGrid to TreePanel"
```

---

### Task 4: Add TreePanel CSS (panel shell + connectors + sticky footer)

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Remove old tree-modal CSS**

Delete the entire block from `/* ─── Tree modal ──────────────────────────────────────────── */` through `.tree-buy-btn--error { ... }` (approximately lines 237–351).

**Step 2: Add new CSS after the grid-viewport block**

Add this block to `index.css` after the `.grid-viewport` rules:

```css
/* ─── Tree panel ──────────────────────────────────────────── */
.tree-panel {
  position: fixed;
  top: 0; right: 0;
  width: 380px;
  height: 100vh;
  background: #111;
  border-left: 1px solid #2a2a2a;
  z-index: 100;
  display: flex;
  flex-direction: column;
  animation: tree-panel-in 180ms ease-out;
}

@keyframes tree-panel-in {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.tree-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
}

.tree-panel-title {
  font-size: 0.78rem;
  color: #888;
  letter-spacing: 0.05em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-panel-close {
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
  border-radius: 3px;
  width: 1.75rem; height: 1.75rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tree-panel-close:hover { border-color: #888; color: #eee; }

.tree-panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ─── Tree layout inside panel ────────────────────────────── */
.tree-layout {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem;
  gap: 0;
  flex: 1;
}

/* Two branches side by side */
.tree-row-leaves {
  display: flex;
  gap: 1rem;
  width: 100%;
  justify-content: center;
}

/* Each branch: pair of leaf cards → connector → L1 card → connector */
.tree-branch {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

/* Two leaf cards side by side within a branch */
.tree-branch-pair {
  display: flex;
  gap: 0.4rem;
  width: 100%;
  position: relative;
  padding-bottom: 0;
}
/* Horizontal bar connecting the pair to their L1 */
.tree-branch-pair::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 25%; right: 25%;
  height: 1px;
  background: #333;
}

/* Vertical drop from pair to L1 */
.tree-connector-v {
  width: 1px;
  height: 16px;
  background: #333;
}

/* Horizontal merge from both L1s to the final */
.tree-connector-merge {
  position: relative;
  width: 60%;
  height: 16px;
  margin: 0 auto;
}
.tree-connector-merge::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: #333;
}
.tree-connector-merge::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  left: 50%; transform: translateX(-50%);
  width: 1px;
  background: #333;
}

/* ─── Sticky buy footer ────────────────────────────────────── */
.tree-panel-footer {
  position: sticky;
  bottom: 0;
  background: #111;
  border-top: 1px solid #222;
  padding: 0.75rem 1rem;
}

/* ─── Check card (compact variant, inside panel) ───────────── */
.check-card {
  background: #0f0f0f;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
}

.check-card-label-row { display: flex; align-items: baseline; gap: 0.35rem; }
.check-card-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
.check-card-sublabel { font-size: 0.62rem; color: #777; margin-left: auto; }
.check-card-name  { font-size: 0.82rem; color: #bbb; }
.check-card-svg svg { width: 100%; height: auto; display: block; }
.check-card-attrs { display: flex; flex-direction: column; gap: 0.2rem; }
.check-card-attr  { display: flex; justify-content: space-between; font-size: 0.72rem; }
.check-card-attr dt { color: #555; }
.check-card-attr dd { color: #ccc; }
.check-card-loading { color: #555; font-size: 0.78rem; }
.check-card-error   { color: #f87171; font-size: 0.75rem; line-height: 1.4; }

/* ─── Buy button ───────────────────────────────────────────── */
.tree-buy-btn {
  width: 100%;
  background: #eee;
  color: #111;
  border: none;
  border-radius: 3px;
  padding: 0.55rem 1rem;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0.03em;
}
.tree-buy-btn:hover:not(:disabled) { background: #fff; }
.tree-buy-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.tree-buy-btn--done  { background: #1a3d1a; color: #4ade80; cursor: default; }
.tree-buy-btn--error { background: #3d1a1a; color: #f87171; }
```

**Step 3: Run all tests to confirm nothing broke**

```bash
cd frontend && npm test -- --reporter=verbose 2>&1 | tail -10
```
Expected: all PASS

**Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add tree panel CSS (slide-in, compact cards, sticky footer, connectors)"
```

---

### Task 5: Delete TreeModal.tsx and run full test suite

**Files:**
- Delete: `frontend/src/components/TreeModal.tsx`

**Step 1: Delete the old file**

```bash
rm frontend/src/components/TreeModal.tsx
```

**Step 2: Verify no remaining references**

```bash
grep -r "TreeModal" frontend/src/
```
Expected: no output

**Step 3: Run the full test suite**

```bash
cd frontend && npm test -- --reporter=verbose 2>&1 | tail -15
```
Expected: all PASS

**Step 4: Build to confirm no TypeScript errors**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: `✓ built in ...`

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: side panel replaces modal — compact tree, sticky buy footer"
```
