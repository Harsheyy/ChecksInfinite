# Checks Composer Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the Checks Composer frontend to remove the API key from the UI, support n ≥ 4 comma-separated token IDs with full P(n,4) permutation coverage, halve API calls via multicall batching + eliminating on-chain SVG calls, and add a client-side filter bar over a 2D-scrollable lazy-render grid.

**Architecture:** The viem public client gains multicall batching; `simulateCompositeSVG` on-chain calls are replaced by `generateSVGJS` (already used for L2), reducing Phase 2 from `2·n·(n-1)` to `n·(n-1)` calls. The 4 separate ID inputs collapse to one comma-parsed field; permutation generation scales to arbitrary n. A new `FilterBar` component filters the grid client-side; `PermutationCard` uses `IntersectionObserver` for lazy SVG injection into a fixed-height 2D-scrollable container.

**Tech Stack:** React 19, Vite 7, viem 2, TypeScript 5, Vitest 4

---

## Task 1: Singleton client with multicall batching

**Files:**
- Modify: `frontend/src/client.ts`

**Step 1: Replace the factory with a singleton**

Current `client.ts` exports `createChecksClient(alchemyKey)`. Replace the whole file:

```typescript
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

export const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1' as const

const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined

export const checksClient = createPublicClient({
  chain: mainnet,
  transport: http(
    alchemyKey
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : 'https://eth-mainnet.g.alchemy.com/v2/'
  ),
  batch: { multicall: true },
})

export function hasAlchemyKey(): boolean {
  return Boolean(alchemyKey?.trim())
}
```

**Step 2: Run existing tests — expect pass**

```bash
cd frontend && npm test
```

Expected: all existing tests pass (no import of `createChecksClient` in tests).

**Step 3: Commit**

```bash
git add frontend/src/client.ts
git commit -m "feat: singleton viem client with multicall batching, key from env"
```

---

## Task 2: Remove API key from UI

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/InputPanel.tsx`

**Step 1: Strip alchemyKey from InputPanel props interface and JSX**

Replace the entire `InputPanel.tsx`:

```tsx
interface InputPanelProps {
  ids: string
  loading: boolean
  onIdsChange: (v: string) => void
  onPreview: () => void
}

export function InputPanel({ ids, loading, onIdsChange, onPreview }: InputPanelProps) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onPreview()
  }

  return (
    <form onSubmit={handleSubmit} className="input-panel">
      <div className="input-row">
        <label>
          Token IDs
          <input
            type="text"
            placeholder="e.g. 1234, 5678, 9012, 3456"
            value={ids}
            onChange={(e) => onIdsChange(e.target.value)}
            className="input-ids"
            required
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Preview →'}
        </button>
      </div>
    </form>
  )
}
```

**Step 2: Update App.tsx to match**

Replace the entire `App.tsx`:

```tsx
import { useState } from 'react'
import { InputPanel } from './components/InputPanel'
import { PermutationGrid } from './components/PermutationGrid'
import { useAllPermutations } from './useAllPermutations'
import { hasAlchemyKey } from './client'

function parseIds(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function validateIds(ids: string[]): string {
  if (!hasAlchemyKey()) return 'VITE_ALCHEMY_API_KEY is not set in .env'
  if (ids.length < 4) return 'Enter at least 4 token IDs separated by commas.'
  for (const id of ids) {
    if (!/^\d+$/.test(id)) return `"${id}" is not a valid token ID.`
  }
  if (new Set(ids).size < ids.length) return 'All token IDs must be unique.'
  return ''
}

export default function App() {
  const [idsRaw, setIdsRaw] = useState('')
  const [validationError, setValidationError] = useState('')
  const { state, preview } = useAllPermutations()

  const isLoading = state.permutations.length > 0 &&
    state.permutations.some(p => p.nodeAbcd.loading)

  function handlePreview() {
    const ids = parseIds(idsRaw)
    const err = validateIds(ids)
    setValidationError(err)
    if (err) return
    preview(ids)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>◆ Checks Composer</h1>
        <p>Preview all permutations of a 2-level recursive composite of Checks.</p>
      </header>
      {!hasAlchemyKey() && (
        <div className="validation-error">
          VITE_ALCHEMY_API_KEY is not set. Add it to frontend/.env and restart.
        </div>
      )}
      <InputPanel
        ids={idsRaw}
        loading={isLoading}
        onIdsChange={setIdsRaw}
        onPreview={handlePreview}
      />
      {validationError && (
        <div className="validation-error">{validationError}</div>
      )}
      <PermutationGrid
        permutations={state.permutations}
        ids={parseIds(idsRaw)}
      />
    </div>
  )
}
```

**Step 3: Run tests**

```bash
cd frontend && npm test
```

Expected: all pass (InputPanel test file references old props — if `CheckCard.test.tsx` imports InputPanel, update it too; otherwise no changes needed).

**Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/InputPanel.tsx
git commit -m "feat: remove API key UI input, read from env var only"
```

---

## Task 3: Update useAllPermutations for n IDs

**Files:**
- Modify: `frontend/src/useAllPermutations.ts`

This is the largest change. The hook must:
1. Accept `ids: string[]` (n ≥ 4) instead of 4 separate strings
2. Generate all P(n,4) 4-tuples (ordered, no repeat)
3. Phase 1: `n × tokenURI` + `n × getCheck` in one `Promise.allSettled` (batched via multicall)
4. Phase 2: `n·(n-1) × simulateComposite` only (no SVG calls)
5. Compute L1 SVG in JS via `generateSVGJS` instead of on-chain `simulateCompositeSVG`
6. Use `checksClient` singleton (no `alchemyKey` param)

**Step 1: Write the updated hook**

Replace `useAllPermutations.ts` entirely:

```typescript
import { useState } from 'react'
import { checksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import { parseTokenURI, mapCheckAttributes, type CheckStruct } from './utils'
import { simulateCompositeJS, generateSVGJS } from './checksArtJS'
import type { CardState } from './useTreeComposite'

export type { CardState } from './useTreeComposite'

export interface PermutationDef {
  // Four indices into the ids[] array: [pair1-keeper, pair1-burner, pair2-keeper, pair2-burner]
  indices: [number, number, number, number]
  label: string
}

export interface PermutationResult {
  def: PermutationDef
  nodeA: CardState
  nodeB: CardState
  nodeC: CardState
  nodeD: CardState
  nodeL1a: CardState
  nodeL1b: CardState
  nodeAbcd: CardState
}

export interface AllPermutationsState {
  permutations: PermutationResult[]
  leafsReady: boolean
}

/** Generate all ordered 4-tuples from [0..n-1] with no repeated index. */
function generatePermDefs(n: number): PermutationDef[] {
  const defs: PermutationDef[] = []
  for (let p0 = 0; p0 < n; p0++) {
    for (let p1 = 0; p1 < n; p1++) {
      if (p1 === p0) continue
      for (let p2 = 0; p2 < n; p2++) {
        if (p2 === p0 || p2 === p1) continue
        for (let p3 = 0; p3 < n; p3++) {
          if (p3 === p0 || p3 === p1 || p3 === p2) continue
          const indices: [number, number, number, number] = [p0, p1, p2, p3]
          const label = `#${p0}▸#${p1}, #${p2}▸#${p3}`
          defs.push({ indices, label })
        }
      }
    }
  }
  return defs
}

function loadingCard(name: string): CardState {
  return { name, svg: '', attributes: [], loading: true, error: '' }
}

function loadingPermutation(def: PermutationDef, ids: string[]): PermutationResult {
  const [p0, p1, p2, p3] = def.indices
  return {
    def,
    nodeA: loadingCard(`Token #${ids[p0]}`),
    nodeB: loadingCard(`Token #${ids[p1]}`),
    nodeC: loadingCard(`Token #${ids[p2]}`),
    nodeD: loadingCard(`Token #${ids[p3]}`),
    nodeL1a: loadingCard(`Composite #${ids[p0]}+#${ids[p1]}`),
    nodeL1b: loadingCard(`Composite #${ids[p2]}+#${ids[p3]}`),
    nodeAbcd: loadingCard('Composite ABCD'),
  }
}

function resolveTokenURI(result: PromiseSettledResult<string>, name: string): CardState {
  if (result.status === 'fulfilled') {
    try {
      const parsed = parseTokenURI(result.value)
      return { name: parsed.name, svg: parsed.svg, attributes: parsed.attributes, loading: false, error: '' }
    } catch {
      return { name, svg: '', attributes: [], loading: false, error: 'Failed to parse token data' }
    }
  }
  return { name, svg: '', attributes: [], loading: false, error: humanizeError(result.reason) }
}

/** Render an L1 composite SVG in JS using the on-chain simulateComposite check struct. */
function resolveL1Card(
  name: string,
  checkResult: PromiseSettledResult<unknown>,
  burnerCheck: PromiseSettledResult<unknown>,
): CardState {
  if (checkResult.status !== 'fulfilled') {
    return { name, svg: '', attributes: [], loading: false, error: humanizeError((checkResult as PromiseRejectedResult).reason) }
  }
  if (burnerCheck.status !== 'fulfilled') {
    return { name, svg: '', attributes: [], loading: false, error: humanizeError((burnerCheck as PromiseRejectedResult).reason) }
  }
  try {
    const l1Check = checkResult.value as CheckStruct
    const bCheck = burnerCheck.value as CheckStruct
    // l1Check.composite = the real burner token ID (set by on-chain simulateComposite)
    const renderMap = new Map<number, CheckStruct>([[l1Check.composite, bCheck]])
    const svg = generateSVGJS(l1Check, renderMap)
    const attrs = mapCheckAttributes(l1Check)
    return { name, svg, attributes: attrs, loading: false, error: '' }
  } catch {
    return { name, svg: '', attributes: [], loading: false, error: 'Failed to build L1 composite preview' }
  }
}

const CD_VIRTUAL_ID = 65535
const AB_VIRTUAL_ID = 65534

function computeL2JS(
  name: string,
  rawCheckBurner1: PromiseSettledResult<unknown>,
  rawCheckBurner2: PromiseSettledResult<unknown>,
  rawL1a: PromiseSettledResult<unknown>,
  rawL1b: PromiseSettledResult<unknown>,
): CardState {
  try {
    if (
      rawCheckBurner1.status !== 'fulfilled' || rawCheckBurner2.status !== 'fulfilled' ||
      rawL1a.status !== 'fulfilled' || rawL1b.status !== 'fulfilled'
    ) {
      return { name, svg: '', attributes: [], loading: false, error: 'One or more prerequisite checks failed — cannot compute L2 composite.' }
    }

    const burner1Check = rawCheckBurner1.value as CheckStruct
    const burner2Check = rawCheckBurner2.value as CheckStruct
    const l1a = rawL1a.value as CheckStruct
    const l1b = rawL1b.value as CheckStruct

    const l1aComposites = [...l1a.stored.composites] as number[]
    l1aComposites[l1a.stored.divisorIndex] = CD_VIRTUAL_ID
    const l1aWithPointer: CheckStruct = { ...l1a, stored: { ...l1a.stored, composites: l1aComposites } }

    const abcdCheck = simulateCompositeJS(l1aWithPointer, l1b, CD_VIRTUAL_ID)

    const renderMap = new Map<number, CheckStruct>([
      [CD_VIRTUAL_ID, l1b],
      [AB_VIRTUAL_ID, l1aWithPointer],
      [l1a.composite, burner1Check],
      [l1b.composite, burner2Check],
    ])

    const svg = generateSVGJS(abcdCheck, renderMap)
    const attrs = mapCheckAttributes(abcdCheck)
    return { name, svg, attributes: attrs, loading: false, error: '' }
  } catch (e) {
    return { name, svg: '', attributes: [], loading: false, error: humanizeError(e) }
  }
}

function humanizeError(err: unknown): string {
  const msg = String(err)
  if (msg.includes('NotAllowed')) return 'Tokens must have the same check count, be different, and exist on-chain.'
  if (msg.includes('revert')) return 'Contract reverted — tokens may not exist or may be incompatible.'
  if (msg.includes('network') || msg.includes('fetch')) return 'Network error — check your Alchemy key.'
  return 'Something went wrong. Check the token IDs and try again.'
}

export function useAllPermutations() {
  const [state, setState] = useState<AllPermutationsState>({
    permutations: [],
    leafsReady: false,
  })

  async function preview(ids: string[]) {
    const n = ids.length
    const bigIds = ids.map(id => BigInt(id))
    const permDefs = generatePermDefs(n)

    setState({
      permutations: permDefs.map(def => loadingPermutation(def, ids)),
      leafsReady: false,
    })

    // Phase 1: tokenURI × n + getCheck × n (2n calls, batched via multicall)
    const phase1Calls = [
      ...bigIds.map(id =>
        checksClient.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [id] })
      ),
      ...bigIds.map(id =>
        checksClient.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'getCheck', args: [id] })
      ),
    ]
    const phase1Results = await Promise.allSettled(phase1Calls)

    const uriResults = phase1Results.slice(0, n) as PromiseSettledResult<string>[]
    const checkResults = phase1Results.slice(n, 2 * n) as PromiseSettledResult<unknown>[]

    const leafCards = ids.map((id, i) => resolveTokenURI(uriResults[i], `Token #${id}`))

    setState(prev => ({
      leafsReady: true,
      permutations: prev.permutations.map(perm => {
        const [p0, p1, p2, p3] = perm.def.indices
        return { ...perm, nodeA: leafCards[p0], nodeB: leafCards[p1], nodeC: leafCards[p2], nodeD: leafCards[p3] }
      }),
    }))

    // Phase 2: simulateComposite × n·(n-1) ordered pairs (batched via multicall)
    // No simulateCompositeSVG calls — L1 SVG is computed in JS via generateSVGJS
    const orderedPairs: [number, number][] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) orderedPairs.push([i, j])
      }
    }

    const phase2Results = await Promise.allSettled(
      orderedPairs.map(([i, j]) =>
        checksClient.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateComposite', args: [bigIds[i], bigIds[j]] })
      )
    )

    // Build lookup: "i-j" → PromiseSettledResult<CheckStruct>
    const l1Map = new Map<string, PromiseSettledResult<unknown>>()
    orderedPairs.forEach(([i, j], idx) => {
      l1Map.set(`${i}-${j}`, phase2Results[idx])
    })

    const finalPermutations: PermutationResult[] = permDefs.map(def => {
      const [p0, p1, p2, p3] = def.indices
      const l1aResult = l1Map.get(`${p0}-${p1}`)!
      const l1bResult = l1Map.get(`${p2}-${p3}`)!

      const nodeL1a = resolveL1Card(
        `Composite #${ids[p0]}+#${ids[p1]}`,
        l1aResult,
        checkResults[p1],
      )
      const nodeL1b = resolveL1Card(
        `Composite #${ids[p2]}+#${ids[p3]}`,
        l1bResult,
        checkResults[p3],
      )
      const nodeAbcd = computeL2JS(
        'Composite ABCD',
        checkResults[p1],
        checkResults[p3],
        l1aResult,
        l1bResult,
      )

      return {
        def,
        nodeA: leafCards[p0],
        nodeB: leafCards[p1],
        nodeC: leafCards[p2],
        nodeD: leafCards[p3],
        nodeL1a,
        nodeL1b,
        nodeAbcd,
      }
    })

    setState({ permutations: finalPermutations, leafsReady: true })
  }

  return { state, preview }
}
```

**Step 2: Run tests**

```bash
cd frontend && npm test
```

Expected: all pass (hook has no unit tests; existing utils/checksArtJS tests unaffected).

**Step 3: Commit**

```bash
git add frontend/src/useAllPermutations.ts
git commit -m "feat: support n>=4 IDs, eliminate simulateCompositeSVG, use generateSVGJS for L1"
```

---

## Task 4: Update PermutationGrid and TreeModal for string[] ids

**Files:**
- Modify: `frontend/src/components/PermutationGrid.tsx`
- Modify: `frontend/src/components/TreeModal.tsx`

**Step 1: Update PermutationGrid props**

Change `ids: { a: string; b: string; c: string; d: string }` to `ids: string[]`:

```tsx
// In PermutationGrid.tsx — change the interface and pass-through:
interface PermutationGridProps {
  permutations: PermutationResult[]
  ids: string[]
}
// The ids prop is only forwarded to TreeModal — update the TreeModal call accordingly.
```

**Step 2: Update TreeModal props and internals**

Replace the `TreeModalProps` interface and the internal id lookups:

```tsx
interface TreeModalProps {
  result: PermutationResult
  ids: string[]    // was: { a: string; b: string; c: string; d: string }
  onClose: () => void
}

// Inside TreeModal, replace:
// const idArr = [ids.a, ids.b, ids.c, ids.d]
// with:
// const idArr = ids
// (indices p0..p3 already index into ids[])
```

The label rendering in TreeModal uses `LETTERS = ['A','B','C','D']` for cosmetic labels. For n > 4 these letters won't match slot indices. Replace with index-based labels:

```tsx
// Replace the LETTERS-based labels with token-ID-based labels:
// e.g. label={`Keeper #${ids[p0]}`} instead of label={`Token A #${idArr[p0]}`}
// For L1: label={`#${ids[p0]}+#${ids[p1]}`}
```

Full updated `TreeModal.tsx`:

```tsx
import { useEffect } from 'react'
import { CheckCard } from './CheckCard'
import type { PermutationResult } from '../useAllPermutations'
import type { CardState } from '../useTreeComposite'

interface TreeModalProps {
  result: PermutationResult
  ids: string[]
  onClose: () => void
}

function cardProps(card: CardState) {
  return { name: card.name, svg: card.svg, attributes: card.attributes, loading: card.loading, error: card.error }
}

export function TreeModal({ result, ids, onClose }: TreeModalProps) {
  const { def, nodeA, nodeB, nodeC, nodeD, nodeL1a, nodeL1b, nodeAbcd } = result
  const [p0, p1, p2, p3] = def.indices

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="tree-modal-overlay" onClick={handleOverlayClick}>
      <div className="tree-modal">
        <button className="tree-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="tree-modal-title">{def.label}</div>
        <div className="tree-layout">
          <div className="tree-row tree-row-leaves">
            <div className="tree-pair">
              <CheckCard label={`Keeper #${ids[p0]}`} {...cardProps(nodeA)} />
              <CheckCard label={`Burn #${ids[p1]}`} {...cardProps(nodeB)} />
            </div>
            <div className="tree-pair">
              <CheckCard label={`Keeper #${ids[p2]}`} {...cardProps(nodeC)} />
              <CheckCard label={`Burn #${ids[p3]}`} {...cardProps(nodeD)} />
            </div>
          </div>
          <div className="tree-row tree-row-l1">
            <div className="tree-node-centered">
              <CheckCard label={`#${ids[p0]}+#${ids[p1]}`} {...cardProps(nodeL1a)} />
            </div>
            <div className="tree-node-centered">
              <CheckCard label={`#${ids[p2]}+#${ids[p3]}`} {...cardProps(nodeL1b)} />
            </div>
          </div>
          <div className="tree-row tree-row-l2">
            <div className="tree-node-centered">
              <CheckCard label="Final Composite" {...cardProps(nodeAbcd)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Run tests**

```bash
cd frontend && npm test
```

Expected: all pass.

**Step 4: Commit**

```bash
git add frontend/src/components/PermutationGrid.tsx frontend/src/components/TreeModal.tsx
git commit -m "feat: update PermutationGrid and TreeModal for string[] ids"
```

---

## Task 5: FilterBar component

**Files:**
- Create: `frontend/src/components/FilterBar.tsx`
- Modify: `frontend/src/components/PermutationGrid.tsx`
- Modify: `frontend/src/index.css`

Filters operate on the final composite (`nodeAbcd`) attributes. Available values come from `utils.ts` constants already defined.

**Step 1: Create FilterBar.tsx**

```tsx
import type { Attribute } from '../utils'

export interface Filters {
  checks: Set<string>
  colorBand: Set<string>
  gradient: Set<string>
  speed: Set<string>
  shift: Set<string>
}

export function emptyFilters(): Filters {
  return {
    checks: new Set(),
    colorBand: new Set(),
    gradient: new Set(),
    speed: new Set(),
    shift: new Set(),
  }
}

const CHECKS_OPTIONS    = ['1', '5', '10', '20', '40', '80']
const COLOR_BAND_OPTIONS = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One']
const GRADIENT_OPTIONS  = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z']
const SPEED_OPTIONS     = ['0.5x', '1x', '2x']
const SHIFT_OPTIONS     = ['IR', 'UV']

interface FilterGroupProps {
  label: string
  options: string[]
  active: Set<string>
  onChange: (next: Set<string>) => void
}

function FilterGroup({ label, options, active, onChange }: FilterGroupProps) {
  function toggle(val: string) {
    const next = new Set(active)
    if (next.has(val)) next.delete(val)
    else next.add(val)
    onChange(next)
  }
  return (
    <div className="filter-group">
      <span className="filter-group-label">{label}</span>
      <div className="filter-group-options">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            className={`filter-chip${active.has(opt) ? ' filter-chip--active' : ''}`}
            onClick={() => toggle(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

interface FilterBarProps {
  filters: Filters
  onChange: (f: Filters) => void
  total: number
  visible: number
}

export function FilterBar({ filters, onChange, total, visible }: FilterBarProps) {
  function update(key: keyof Filters, next: Set<string>) {
    onChange({ ...filters, [key]: next })
  }

  function clearAll() { onChange(emptyFilters()) }

  const isActive = Object.values(filters).some(s => s.size > 0)

  return (
    <div className="filter-bar">
      <div className="filter-bar-groups">
        <FilterGroup label="Checks"     options={CHECKS_OPTIONS}     active={filters.checks}    onChange={v => update('checks', v)} />
        <FilterGroup label="Color Band" options={COLOR_BAND_OPTIONS} active={filters.colorBand} onChange={v => update('colorBand', v)} />
        <FilterGroup label="Gradient"   options={GRADIENT_OPTIONS}   active={filters.gradient}  onChange={v => update('gradient', v)} />
        <FilterGroup label="Speed"      options={SPEED_OPTIONS}      active={filters.speed}     onChange={v => update('speed', v)} />
        <FilterGroup label="Shift"      options={SHIFT_OPTIONS}      active={filters.shift}     onChange={v => update('shift', v)} />
      </div>
      <div className="filter-bar-status">
        <span className="filter-bar-count">Showing {visible} / {total}</span>
        {isActive && (
          <button type="button" className="filter-clear" onClick={clearAll}>Clear filters</button>
        )}
      </div>
    </div>
  )
}

/** Returns true if the attributes satisfy all active filters (AND logic; empty group = pass all). */
export function matchesFilters(attributes: Attribute[], filters: Filters): boolean {
  function check(key: keyof Filters, traitType: string): boolean {
    if (filters[key].size === 0) return true
    const attr = attributes.find(a => a.trait_type === traitType)
    return attr ? filters[key].has(attr.value) : false
  }
  return (
    check('checks', 'Checks') &&
    check('colorBand', 'Color Band') &&
    check('gradient', 'Gradient') &&
    check('speed', 'Speed') &&
    check('shift', 'Shift')
  )
}
```

**Step 2: Wire FilterBar into PermutationGrid**

Replace `PermutationGrid.tsx`:

```tsx
import { useState } from 'react'
import { PermutationCard } from './PermutationCard'
import { TreeModal } from './TreeModal'
import { FilterBar, emptyFilters, matchesFilters, type Filters } from './FilterBar'
import type { PermutationResult } from '../useAllPermutations'

interface PermutationGridProps {
  permutations: PermutationResult[]
  ids: string[]
}

export function PermutationGrid({ permutations, ids }: PermutationGridProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)

  if (permutations.length === 0) return null

  const visible = permutations.filter(p =>
    !p.nodeAbcd.loading && !p.nodeAbcd.error
      ? matchesFilters(p.nodeAbcd.attributes, filters)
      : true   // keep loading/error cards always visible
  )

  return (
    <div className="permutation-grid-wrapper">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        total={permutations.length}
        visible={visible.length}
      />
      <div className="permutation-grid-scroll">
        <div className="permutation-grid">
          {permutations.map((result, i) => {
            const show = !result.nodeAbcd.loading && !result.nodeAbcd.error
              ? matchesFilters(result.nodeAbcd.attributes, filters)
              : true
            return (
              <PermutationCard
                key={result.def.label}
                result={result}
                index={i}
                visible={show}
                onClick={() => setSelectedIndex(i)}
              />
            )
          })}
        </div>
      </div>
      {selectedIndex !== null && (
        <TreeModal
          result={permutations[selectedIndex]}
          ids={ids}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </div>
  )
}
```

**Step 3: Add CSS for FilterBar**

Append to `frontend/src/index.css`:

```css
/* Filter bar */
.filter-bar {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.filter-bar-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.filter-group-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #666;
}

.filter-group-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.filter-chip {
  background: #111;
  border: 1px solid #444;
  border-radius: 3px;
  color: #888;
  font-family: inherit;
  font-size: 0.72rem;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
  transition: border-color 0.1s, color 0.1s;
}
.filter-chip:hover { border-color: #888; color: #ccc; }
.filter-chip--active { border-color: #eee; color: #eee; background: #222; }

.filter-bar-status {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.filter-bar-count {
  font-size: 0.78rem;
  color: #666;
}

.filter-clear {
  background: transparent;
  border: none;
  color: #888;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.filter-clear:hover { color: #ccc; }
```

**Step 4: Run tests**

```bash
cd frontend && npm test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add frontend/src/components/FilterBar.tsx frontend/src/components/PermutationGrid.tsx frontend/src/index.css
git commit -m "feat: add FilterBar with multi-select attribute filters"
```

---

## Task 6: Scrollable grid + lazy SVG rendering in PermutationCard

**Files:**
- Modify: `frontend/src/components/PermutationCard.tsx`
- Modify: `frontend/src/index.css`

The grid sits inside a fixed-height container with `overflow: auto` (scroll all four directions). `PermutationCard` uses `IntersectionObserver` to delay injecting SVG markup until the card scrolls into view.

**Step 1: Update PermutationCard with lazy SVG**

Replace `PermutationCard.tsx`:

```tsx
import { useRef, useEffect, useState } from 'react'
import type { PermutationResult } from '../useAllPermutations'

interface PermutationCardProps {
  result: PermutationResult
  index: number
  visible: boolean
  onClick: () => void
}

export function PermutationCard({ result, visible, onClick }: PermutationCardProps) {
  const { nodeAbcd, def } = result
  const cardRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect() } },
      { rootMargin: '200px' }  // pre-load 200px before visible
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!visible) return null

  return (
    <div className="permutation-card" ref={cardRef} onClick={onClick} title={def.label}>
      <div className="permutation-card-thumb">
        {nodeAbcd.loading && <div className="permutation-card-loading">…</div>}
        {nodeAbcd.error && !nodeAbcd.loading && <div className="permutation-card-error">✕</div>}
        {!nodeAbcd.loading && !nodeAbcd.error && inView && nodeAbcd.svg && (
          <div className="permutation-card-svg" dangerouslySetInnerHTML={{ __html: nodeAbcd.svg }} />
        )}
      </div>
      <div className="permutation-card-label">{def.label}</div>
    </div>
  )
}
```

**Step 2: Add scrollable grid CSS**

Append to `frontend/src/index.css`:

```css
/* Scrollable grid container */
.permutation-grid-scroll {
  overflow: auto;
  max-height: calc(100vh - 320px);
  min-height: 300px;
  border: 1px solid #222;
  border-radius: 4px;
}

/* Keep the inner grid the same 6-column layout */
.permutation-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.75rem;
  padding: 0.75rem;
  min-width: 600px;   /* ensures horizontal scroll on narrow viewports */
}
```

Note: the `.permutation-grid` rule already exists in `index.css` — replace it rather than duplicate. The only additions are the wrapper `.permutation-grid-scroll` rule and `padding` + `min-width` on `.permutation-grid`.

**Step 3: Run tests**

```bash
cd frontend && npm test
```

Expected: all pass. (IntersectionObserver is a browser API; unit tests won't exercise it but that's acceptable — visual behavior is validated in the browser.)

**Step 4: Verify in browser**

```bash
cd frontend && npm run dev
```

- Enter ≥ 4 token IDs comma-separated and click Preview
- Grid appears, SVGs load as you scroll
- Filter chips narrow displayed cards; count updates
- Clicking a card opens the tree modal with correct IDs
- No Alchemy key input anywhere

**Step 5: Commit**

```bash
git add frontend/src/components/PermutationCard.tsx frontend/src/index.css
git commit -m "feat: lazy SVG rendering via IntersectionObserver, 2D-scrollable grid"
```

---

## Task 7: Update CSS input width for comma-separated field

**Files:**
- Modify: `frontend/src/index.css`

The old four inputs each had `width: 180px`. The new single IDs field should stretch to fill available space.

**Step 1: Add wide input style**

Append to `frontend/src/index.css`:

```css
.input-ids {
  width: 420px;
}
```

**Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: widen comma-ID input field"
```

---

## Summary of API Call Reduction

| Phase | Before (n=4) | After (n=4) | HTTP Requests |
|-------|-------------|-------------|---------------|
| Phase 1 | 8 (4×tokenURI + 4×getCheck) | 8 same | 1 multicall |
| Phase 2 | 24 (12×simulateComposite + 12×simulateCompositeSVG) | 12 (12×simulateComposite) | 1 multicall |
| **Total** | **32 in 32 requests** | **20 in 2 requests** | **−38%** calls, **−94%** HTTP round-trips |

For n=5: 30 calls in 2 requests (vs 50 in 50).
For n=6: 42 calls in 2 requests (vs 72 in 72).
