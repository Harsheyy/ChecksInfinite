# My Checks View Mode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Token Works | My Checks" toggle to the navbar; My Checks fetches the connected wallet's Checks VV tokens on-chain, computes 2500 random permutations in JS, and caches everything in localStorage for 48 hours.

**Architecture:** `useMyChecks(address, enabled)` fetches token IDs via Alchemy REST API + check structs via multicall, caches in localStorage. `useMyCheckPermutations(checks)` groups tokens by check count, random-samples 2500 four-tuples, computes all SVGs as lazy getters using the existing JS engine. App.tsx switches data source based on `viewMode` state.

**Tech Stack:** React hooks, viem multicall via `checksClient`, Alchemy NFT API v3 (REST fetch), `simulateCompositeJS`/`computeL2`/`generateSVGJS` from `checksArtJS.ts`, localStorage, Vitest + Testing Library.

---

### Codebase context (read before starting)

- `frontend/src/checksArtJS.ts` — exports `simulateCompositeJS`, `generateSVGJS`, `computeL2`, `buildL2RenderMap`, `CD_VIRTUAL_ID`
- `frontend/src/utils.ts` — exports `CheckStruct`, `mapCheckAttributes`
- `frontend/src/client.ts` — exports `checksClient` (viem public client with multicall), `CHECKS_CONTRACT`, `hasAlchemyKey()`
- `frontend/src/checksAbi.ts` — exports `CHECKS_ABI` (has `getCheck` + `tokenURI` functions)
- `frontend/src/usePermutationsDB.ts` — reference for the lazy getter + PermutationResult pattern
- `frontend/src/useAllPermutations.ts` — exports `PermutationResult`, `PermutationDef`
- `frontend/src/components/Navbar.tsx` — current navbar (has `dbMode`, `isConnected` via wagmi)
- `frontend/src/App.tsx` — top-level state, switches between dbState and chainState
- `frontend/src/test-utils.tsx` — exports `WagmiWrapper` (needed for Navbar tests)
- `CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'`
- Alchemy key: `import.meta.env.VITE_ALCHEMY_API_KEY`

---

### Task 1: `useMyChecks` hook

**Files:**
- Create: `frontend/src/useMyChecks.ts`
- Create: `frontend/src/useMyChecks.test.ts`

This hook fetches owned Checks VV token IDs via Alchemy API v3, fetches each token's `CheckStruct` via multicall, and caches the result in localStorage with a 48-hour TTL.

**Step 1: Write the failing test**

```ts
// frontend/src/useMyChecks.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readMyChecksCache, writeMyChecksCache, CACHE_TTL } from './useMyChecks'
import type { SerializedCheckStruct } from './useMyChecks'

const ADDR = '0xabc'
const mockCheck: SerializedCheckStruct = {
  stored: { composites: [], colorBands: [], gradients: [], divisorIndex: 0, epoch: 0, seed: 0, day: 1 },
  isRevealed: true, seed: '12345', checksCount: 80, hasManyChecks: true,
  composite: 0, isRoot: true, colorBand: 0, gradient: 0, direction: 0, speed: 2,
}

describe('useMyChecks cache', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('returns null when cache is empty', () => {
    expect(readMyChecksCache(ADDR)).toBeNull()
  })

  it('returns cached data when fresh', () => {
    writeMyChecksCache(ADDR, { tokenIds: ['1', '2'], checks: { '1': mockCheck }, cachedAt: Date.now() })
    const result = readMyChecksCache(ADDR)
    expect(result).not.toBeNull()
    expect(result!.tokenIds).toEqual(['1', '2'])
  })

  it('returns null when cache is expired', () => {
    writeMyChecksCache(ADDR, {
      tokenIds: ['1'], checks: {},
      cachedAt: Date.now() - CACHE_TTL - 1000,
    })
    expect(readMyChecksCache(ADDR)).toBeNull()
  })

  it('normalises address to lowercase for cache key', () => {
    writeMyChecksCache('0xABC', { tokenIds: ['3'], checks: {}, cachedAt: Date.now() })
    const result = readMyChecksCache('0xabc')
    expect(result!.tokenIds).toEqual(['3'])
  })
})
```

**Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/useMyChecks.test.ts
```
Expected: FAIL — `readMyChecksCache` / `writeMyChecksCache` not found.

**Step 3: Implement `useMyChecks.ts`**

```ts
// frontend/src/useMyChecks.ts
import { useState, useEffect } from 'react'
import { checksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import type { CheckStruct } from './utils'

export const CACHE_TTL = 48 * 60 * 60 * 1000  // 48 hours in ms

export interface SerializedCheckStruct {
  stored: {
    composites: number[]
    colorBands: number[]
    gradients: number[]
    divisorIndex: number
    epoch: number
    seed: number
    day: number
  }
  isRevealed: boolean
  seed: string          // bigint serialized as decimal string
  checksCount: number
  hasManyChecks: boolean
  composite: number
  isRoot: boolean
  colorBand: number
  gradient: number
  direction: number
  speed: number
}

interface CacheEntry {
  tokenIds: string[]
  checks: Record<string, SerializedCheckStruct>
  cachedAt: number
}

function cacheKey(address: string): string {
  return `ci:myChecks:${address.toLowerCase()}`
}

export function readMyChecksCache(address: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(address))
    if (!raw) return null
    const data = JSON.parse(raw) as CacheEntry
    if (Date.now() - data.cachedAt > CACHE_TTL) return null
    return data
  } catch {
    return null
  }
}

export function writeMyChecksCache(address: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(cacheKey(address), JSON.stringify(entry))
  } catch {
    // localStorage full or unavailable — continue without caching
  }
}

function deserialize(s: SerializedCheckStruct): CheckStruct {
  return {
    ...s,
    seed: BigInt(s.seed),
    stored: {
      ...s.stored,
      composites: s.stored.composites as readonly number[],
      colorBands: s.stored.colorBands as readonly number[],
      gradients: s.stored.gradients as readonly number[],
    },
  }
}

async function fetchOwnedTokenIds(address: string, alchemyKey: string): Promise<string[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner`
  const params = `owner=${address}&contractAddresses[]=${CHECKS_CONTRACT}&withMetadata=false&pageSize=100`
  const ids: string[] = []
  let pageKey: string | undefined

  do {
    const url = pageKey ? `${base}?${params}&pageKey=${pageKey}` : `${base}?${params}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`)
    const data = await res.json() as { ownedNfts: { tokenId: string }[]; pageKey?: string }
    for (const nft of data.ownedNfts) {
      ids.push(nft.tokenId)   // v3 returns decimal string directly
    }
    pageKey = data.pageKey
  } while (pageKey)

  return ids
}

export interface MyChecksState {
  tokenIds: string[]
  checks: Record<string, CheckStruct>
  loading: boolean
  error: string
}

export function useMyChecks(address: string | undefined, enabled: boolean): MyChecksState {
  const [state, setState] = useState<MyChecksState>({
    tokenIds: [], checks: {}, loading: false, error: '',
  })

  useEffect(() => {
    if (!enabled || !address) {
      setState({ tokenIds: [], checks: {}, loading: false, error: '' })
      return
    }

    // Try cache first
    const cached = readMyChecksCache(address)
    if (cached) {
      setState({
        tokenIds: cached.tokenIds,
        checks: Object.fromEntries(
          Object.entries(cached.checks).map(([id, s]) => [id, deserialize(s)])
        ),
        loading: false,
        error: '',
      })
      return
    }

    const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined
    if (!alchemyKey) {
      setState({ tokenIds: [], checks: {}, loading: false, error: 'VITE_ALCHEMY_API_KEY not set' })
      return
    }

    setState(prev => ({ ...prev, loading: true, error: '' }))

    fetchOwnedTokenIds(address, alchemyKey)
      .then(async (tokenIds) => {
        if (tokenIds.length === 0) {
          setState({ tokenIds: [], checks: {}, loading: false, error: '' })
          return
        }

        const bigIds = tokenIds.map(id => BigInt(id))
        const results = await Promise.allSettled(
          bigIds.map(id =>
            checksClient.readContract({
              address: CHECKS_CONTRACT,
              abi: CHECKS_ABI,
              functionName: 'getCheck',
              args: [id],
            })
          )
        )

        const checks: Record<string, CheckStruct> = {}
        const serialized: Record<string, SerializedCheckStruct> = {}

        for (let i = 0; i < tokenIds.length; i++) {
          const r = results[i]
          if (r.status === 'fulfilled') {
            const cs = r.value as CheckStruct
            checks[tokenIds[i]] = cs
            serialized[tokenIds[i]] = {
              ...cs,
              seed: cs.seed.toString(),
              stored: {
                ...cs.stored,
                composites: [...cs.stored.composites],
                colorBands: [...cs.stored.colorBands],
                gradients: [...cs.stored.gradients],
              },
            }
          }
        }

        writeMyChecksCache(address, { tokenIds, checks: serialized, cachedAt: Date.now() })
        setState({ tokenIds, checks, loading: false, error: '' })
      })
      .catch(err => {
        setState(prev => ({ ...prev, loading: false, error: String(err) }))
      })
  }, [address, enabled])

  return state
}
```

**Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/useMyChecks.test.ts
```
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add frontend/src/useMyChecks.ts frontend/src/useMyChecks.test.ts
git commit -m "feat: useMyChecks hook — Alchemy fetch + localStorage cache"
```

---

### Task 2: `useMyCheckPermutations` hook

**Files:**
- Create: `frontend/src/useMyCheckPermutations.ts`
- Create: `frontend/src/useMyCheckPermutations.test.ts`

Groups tokens by `checksCount`, random-samples up to 2500 four-tuples from valid groups (≥4 tokens), computes composites eagerly using the JS engine. All SVGs are lazy getters (same pattern as `usePermutationsDB`).

**Step 1: Write the failing test**

```ts
// frontend/src/useMyCheckPermutations.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { groupByChecksCount, sampleTuples } from './useMyCheckPermutations'
import type { CheckStruct } from './utils'

function fakeCheck(checksCount: number, seed = 1n): CheckStruct {
  return {
    stored: { composites: Array(7).fill(0), colorBands: Array(6).fill(0), gradients: Array(6).fill(0), divisorIndex: 0, epoch: 0, seed: 0, day: 0 },
    isRevealed: true, seed, checksCount, hasManyChecks: checksCount > 1,
    composite: 0, isRoot: true, colorBand: 0, gradient: 0, direction: 0, speed: 2,
  }
}

describe('groupByChecksCount', () => {
  it('groups tokens by their checksCount', () => {
    const checks: Record<string, CheckStruct> = {
      '1': fakeCheck(80), '2': fakeCheck(80), '3': fakeCheck(40), '4': fakeCheck(80),
    }
    const groups = groupByChecksCount(checks)
    expect(groups.get(80)).toEqual(expect.arrayContaining(['1', '2', '4']))
    expect(groups.get(40)).toEqual(['3'])
  })

  it('returns empty map for empty input', () => {
    expect(groupByChecksCount({}).size).toBe(0)
  })
})

describe('sampleTuples', () => {
  it('returns all permutations when group has exactly 4 tokens', () => {
    const ids = ['a', 'b', 'c', 'd']
    const tuples = sampleTuples(ids, 100)
    expect(tuples.length).toBe(24)  // P(4,4) = 24
    for (const t of tuples) expect(new Set(t).size).toBe(4)
  })

  it('returns up to `max` tuples', () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i))
    const tuples = sampleTuples(ids, 50)
    expect(tuples.length).toBeLessThanOrEqual(50)
  })

  it('each tuple has 4 distinct elements', () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(i))
    for (const t of sampleTuples(ids, 200)) {
      expect(new Set(t).size).toBe(4)
    }
  })
})
```

**Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/useMyCheckPermutations.test.ts
```
Expected: FAIL — `groupByChecksCount` / `sampleTuples` not found.

**Step 3: Implement `useMyCheckPermutations.ts`**

```ts
// frontend/src/useMyCheckPermutations.ts
import { useState, useCallback } from 'react'
import {
  simulateCompositeJS, generateSVGJS, computeL2, buildL2RenderMap,
} from './checksArtJS'
import { mapCheckAttributes } from './utils'
import type { CheckStruct } from './utils'
import type { PermutationResult } from './useAllPermutations'

const MAX_PERMS = 2500

export function groupByChecksCount(
  checks: Record<string, CheckStruct>
): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const [id, cs] of Object.entries(checks)) {
    const existing = groups.get(cs.checksCount) ?? []
    existing.push(id)
    groups.set(cs.checksCount, existing)
  }
  return groups
}

/** Fisher-Yates shuffle — returns a new shuffled array. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * sampleTuples — returns up to `max` distinct 4-tuples from `ids`.
 * If P(n,4) <= max, returns ALL ordered 4-tuples (exhaustive).
 * Otherwise random-samples.
 */
export function sampleTuples(
  ids: string[],
  max: number
): [string, string, string, string][] {
  const n = ids.length
  const totalPossible = n * (n - 1) * (n - 2) * (n - 3)

  if (totalPossible <= max) {
    // Exhaustive: all ordered 4-tuples
    const result: [string, string, string, string][] = []
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) { if (b === a) continue
        for (let c = 0; c < n; c++) { if (c === a || c === b) continue
          for (let d = 0; d < n; d++) { if (d === a || d === b || d === c) continue
            result.push([ids[a], ids[b], ids[c], ids[d]])
          }}}
    return result
  }

  // Random sample: shuffle + slide window across shuffled array
  const result: [string, string, string, string][] = []
  const seen = new Set<string>()
  const maxAttempts = max * 5

  for (let attempt = 0; attempt < maxAttempts && result.length < max; attempt++) {
    const s = shuffle(ids)
    for (let i = 0; i + 3 < s.length && result.length < max; i++) {
      const t: [string, string, string, string] = [s[i], s[i+1], s[i+2], s[i+3]]
      const key = t.join(',')
      if (!seen.has(key)) {
        seen.add(key)
        result.push(t)
      }
    }
  }

  return result
}

function buildPermutation(
  id0: string, id1: string, id2: string, id3: string,
  checks: Record<string, CheckStruct>,
): PermutationResult {
  const k1 = checks[id0], b1 = checks[id1]
  const k2 = checks[id2], b2 = checks[id3]
  try {
    const l1aStruct = simulateCompositeJS(k1, b1, parseInt(id1))
    const l1bStruct = simulateCompositeJS(k2, b2, parseInt(id3))
    const abcdStruct = computeL2(l1aStruct, l1bStruct)
    const abcdMap = buildL2RenderMap(l1aStruct, l1bStruct, b1, b2)

    let _aSvg: string | undefined, _bSvg: string | undefined
    let _cSvg: string | undefined, _dSvg: string | undefined
    let _l1aSvg: string | undefined, _l1bSvg: string | undefined
    let _abcdSvg: string | undefined

    return {
      def: {
        indices: [0, 1, 2, 3],
        label: `#${id0}▸#${id1}, #${id2}▸#${id3}`,
        tokenIds: [id0, id1, id2, id3],
      },
      nodeA: {
        name: `Token #${id0}`, attributes: mapCheckAttributes(k1), loading: false, error: '',
        get svg() { return (_aSvg ??= generateSVGJS(k1, new Map())) },
      },
      nodeB: {
        name: `Token #${id1}`, attributes: mapCheckAttributes(b1), loading: false, error: '',
        get svg() { return (_bSvg ??= generateSVGJS(b1, new Map())) },
      },
      nodeC: {
        name: `Token #${id2}`, attributes: mapCheckAttributes(k2), loading: false, error: '',
        get svg() { return (_cSvg ??= generateSVGJS(k2, new Map())) },
      },
      nodeD: {
        name: `Token #${id3}`, attributes: mapCheckAttributes(b2), loading: false, error: '',
        get svg() { return (_dSvg ??= generateSVGJS(b2, new Map())) },
      },
      nodeL1a: {
        name: `#${id0}+#${id1}`, attributes: mapCheckAttributes(l1aStruct), loading: false, error: '',
        get svg() { return (_l1aSvg ??= generateSVGJS(l1aStruct, new Map([[parseInt(id1), b1]]))) },
      },
      nodeL1b: {
        name: `#${id2}+#${id3}`, attributes: mapCheckAttributes(l1bStruct), loading: false, error: '',
        get svg() { return (_l1bSvg ??= generateSVGJS(l1bStruct, new Map([[parseInt(id3), b2]]))) },
      },
      nodeAbcd: {
        name: 'Final Composite', attributes: mapCheckAttributes(abcdStruct), loading: false, error: '',
        get svg() { return (_abcdSvg ??= generateSVGJS(abcdStruct, abcdMap)) },
      },
    }
  } catch {
    const err = 'Incompatible tokens'
    const dead = (name: string): import('./utils').CardState =>
      ({ name, svg: '', attributes: [], loading: false, error: err })
    return {
      def: { indices: [0,1,2,3], label: `#${id0}▸#${id1}, #${id2}▸#${id3}`, tokenIds: [id0,id1,id2,id3] },
      nodeA: dead(`Token #${id0}`), nodeB: dead(`Token #${id1}`),
      nodeC: dead(`Token #${id2}`), nodeD: dead(`Token #${id3}`),
      nodeL1a: dead(`#${id0}+#${id1}`), nodeL1b: dead(`#${id2}+#${id3}`),
      nodeAbcd: dead('Final Composite'),
    }
  }
}

export function useMyCheckPermutations(checks: Record<string, CheckStruct>) {
  const [permutations, setPermutations] = useState<PermutationResult[]>([])

  const generate = useCallback(() => {
    const groups = groupByChecksCount(checks)
    const results: PermutationResult[] = []

    for (const [, ids] of groups) {
      if (ids.length < 4) continue
      const remaining = MAX_PERMS - results.length
      if (remaining <= 0) break
      const tuples = sampleTuples(ids, remaining)
      for (const [id0, id1, id2, id3] of tuples) {
        results.push(buildPermutation(id0, id1, id2, id3, checks))
      }
    }

    setPermutations(results)
  }, [checks])

  const shuffle = useCallback(() => generate(), [generate])

  return { permutations, generate, shuffle }
}
```

**Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/useMyCheckPermutations.test.ts
```
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add frontend/src/useMyCheckPermutations.ts frontend/src/useMyCheckPermutations.test.ts
git commit -m "feat: useMyCheckPermutations — group by count, JS composite engine, shuffle"
```

---

### Task 3: View toggle in Navbar + CSS

**Files:**
- Modify: `frontend/src/components/Navbar.tsx`
- Modify: `frontend/src/components/Navbar.test.tsx`
- Modify: `frontend/src/index.css`

The toggle pill (`Token Works | My Checks`) appears only when a wallet is connected. The Navbar.test.tsx has a stale brand-text assertion that needs updating.

**Step 1: Write the failing tests**

Replace the contents of `frontend/src/components/Navbar.test.tsx`:

```tsx
// frontend/src/components/Navbar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Navbar } from './Navbar'
import { WagmiWrapper } from '../test-utils'

function renderNavbar(props: Parameters<typeof Navbar>[0]) {
  return render(<WagmiWrapper><Navbar {...props} /></WagmiWrapper>)
}

const baseProps = {
  ids: '', loading: false, onIdsChange: vi.fn(), onPreview: vi.fn(), error: '',
}

describe('Navbar', () => {
  it('renders brand text "Checks Infinite"', () => {
    renderNavbar(baseProps)
    expect(screen.getByText('Checks Infinite')).toBeInTheDocument()
  })

  it('renders input and preview button when not dbMode', () => {
    renderNavbar(baseProps)
    expect(screen.getByPlaceholderText(/1234/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview/ })).toBeInTheDocument()
  })

  it('renders wallet button', () => {
    renderNavbar(baseProps)
    expect(screen.getByRole('button', { name: /Connect Wallet/ })).toBeInTheDocument()
  })

  it('shows error message when error prop is set', () => {
    renderNavbar({ ...baseProps, error: 'Enter at least 4 IDs' })
    expect(screen.getByText('Enter at least 4 IDs')).toBeInTheDocument()
  })

  it('disables preview button when loading', () => {
    renderNavbar({ ...baseProps, loading: true })
    expect(screen.getByRole('button', { name: /Loading/ })).toBeDisabled()
  })

  it('calls onPreview on form submit', () => {
    const onPreview = vi.fn()
    renderNavbar({ ...baseProps, ids: '1,2,3,4', onPreview })
    fireEvent.submit(screen.getByRole('form'))
    expect(onPreview).toHaveBeenCalledOnce()
  })

  it('calls onIdsChange when input value changes', () => {
    const onIdsChange = vi.fn()
    renderNavbar({ ...baseProps, onIdsChange })
    fireEvent.change(screen.getByPlaceholderText(/1234/), { target: { value: '1,2,3,4' } })
    expect(onIdsChange).toHaveBeenCalledWith('1,2,3,4')
  })

  it('does not render view toggle when viewMode prop is absent', () => {
    renderNavbar(baseProps)
    expect(screen.queryByRole('button', { name: /Token Works/ })).toBeNull()
  })

  it('renders view toggle buttons when viewMode is provided', () => {
    renderNavbar({ ...baseProps, viewMode: 'token-works', onViewModeChange: vi.fn() })
    expect(screen.getByRole('button', { name: 'Token Works' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My Checks' })).toBeInTheDocument()
  })

  it('calls onViewModeChange with "my-checks" when My Checks is clicked', () => {
    const onViewModeChange = vi.fn()
    renderNavbar({ ...baseProps, viewMode: 'token-works', onViewModeChange })
    fireEvent.click(screen.getByRole('button', { name: 'My Checks' }))
    expect(onViewModeChange).toHaveBeenCalledWith('my-checks')
  })

  it('marks the active mode button', () => {
    renderNavbar({ ...baseProps, viewMode: 'my-checks', onViewModeChange: vi.fn() })
    expect(screen.getByRole('button', { name: 'My Checks' })).toHaveClass('view-toggle-btn--active')
    expect(screen.getByRole('button', { name: 'Token Works' })).not.toHaveClass('view-toggle-btn--active')
  })
})
```

**Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/components/Navbar.test.tsx
```
Expected: several FAIL — `viewMode` props not yet on Navbar, brand text assertion changed.

**Step 3: Update `Navbar.tsx`**

Add two optional props — `viewMode` and `onViewModeChange` — and render the toggle when they are provided:

```tsx
// At top of file, update the interface:
interface NavbarProps {
  ids: string
  loading: boolean
  onIdsChange: (v: string) => void
  onPreview: () => void
  error: string
  dbMode?: boolean
  dbTotal?: number
  viewMode?: 'token-works' | 'my-checks'
  onViewModeChange?: (mode: 'token-works' | 'my-checks') => void
}

// Update function signature:
export function Navbar({ ids, loading, onIdsChange, onPreview, error, dbMode, viewMode, onViewModeChange }: NavbarProps) {
  // ... existing body unchanged ...

  // Add inside the <nav>, after the wallet button:
  {viewMode && onViewModeChange && (
    <div className="view-toggle">
      <button
        className={`view-toggle-btn${viewMode === 'token-works' ? ' view-toggle-btn--active' : ''}`}
        onClick={() => onViewModeChange('token-works')}
      >Token Works</button>
      <button
        className={`view-toggle-btn${viewMode === 'my-checks' ? ' view-toggle-btn--active' : ''}`}
        onClick={() => onViewModeChange('my-checks')}
      >My Checks</button>
    </div>
  )}
```

**Step 4: Add CSS for the view toggle to `index.css`**

Add after the `.nav-wallet` block:

```css
/* ─── View mode toggle ─────────────────────────────────────── */
.view-toggle {
  display: flex;
  border: 1px solid #333;
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}

.view-toggle-btn {
  background: transparent;
  border: none;
  color: #666;
  font-family: inherit;
  font-size: 0.75rem;
  padding: 0.3rem 0.65rem;
  cursor: pointer;
  white-space: nowrap;
}
.view-toggle-btn:hover { color: #aaa; }
.view-toggle-btn--active {
  background: #eee;
  color: #111;
  font-weight: bold;
}
.view-toggle-btn + .view-toggle-btn {
  border-left: 1px solid #333;
}
```

**Step 5: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/components/Navbar.test.tsx
```
Expected: PASS (all 11 tests).

**Step 6: Commit**

```bash
git add frontend/src/components/Navbar.tsx frontend/src/components/Navbar.test.tsx frontend/src/index.css
git commit -m "feat: view mode toggle in navbar (Token Works / My Checks)"
```

---

### Task 4: Wire `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

Add `viewMode` state. When `viewMode === 'my-checks'` and wallet is connected, use `useMyChecks` + `useMyCheckPermutations` as the data source. When wallet disconnects, reset to `'token-works'`.

The filter bar already works client-side for chain-computed results (same `matchesFilters` path). The shuffle button triggers `myCheckPerms.shuffle()` instead of `loadRandom()`.

**Step 1: No new test needed** — the existing integration tests cover App behaviour at the component level; this is wiring. Run the full suite after implementation to confirm nothing regresses.

**Step 2: Update `App.tsx`**

```tsx
// frontend/src/App.tsx
import { useState, useMemo, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { Navbar } from './components/Navbar'
import { FilterBar, emptyFilters, matchesFilters, type Filters } from './components/FilterBar'
import { InfiniteGrid } from './components/InfiniteGrid'
import { useAllPermutations } from './useAllPermutations'
import { usePermutationsDB } from './usePermutationsDB'
import { useMyChecks } from './useMyChecks'
import { useMyCheckPermutations } from './useMyCheckPermutations'
import { hasSupabase } from './supabaseClient'
import { hasAlchemyKey } from './client'
import { parseIds, validateIds } from './utils'

export default function App() {
  const dbMode = hasSupabase()
  const { address, isConnected } = useAccount()

  // ── View mode (only relevant in dbMode) ──────────────────────────────────
  const [viewMode, setViewMode] = useState<'token-works' | 'my-checks'>('token-works')

  // Reset to token-works when wallet disconnects
  useEffect(() => {
    if (!isConnected) setViewMode('token-works')
  }, [isConnected])

  // ── Chain mode state ──────────────────────────────────────────────────────
  const [idsRaw, setIdsRaw] = useState('')
  const [validationError, setValidationError] = useState('')
  const { state: chainState, preview } = useAllPermutations()

  // ── Shared filter state ───────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(emptyFilters())

  // ── DB / Token Works mode ─────────────────────────────────────────────────
  const { state: dbState, load, loadRandom } = usePermutationsDB()
  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  useEffect(() => {
    if (!dbMode || viewMode !== 'token-works') return
    if (hasActiveFilters) load(filters)
    else loadRandom()
  }, [dbMode, viewMode, filters])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── My Checks mode ────────────────────────────────────────────────────────
  const myChecksEnabled = dbMode && viewMode === 'my-checks' && isConnected
  const myChecks = useMyChecks(address, myChecksEnabled)
  const myCheckPerms = useMyCheckPermutations(myChecks.checks)

  // Generate permutations when checks load
  useEffect(() => {
    if (myChecksEnabled && !myChecks.loading && Object.keys(myChecks.checks).length > 0) {
      myCheckPerms.generate()
    }
  }, [myChecksEnabled, myChecks.loading, myChecks.checks])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chain mode handlers ───────────────────────────────────────────────────
  const ids = useMemo(() => parseIds(idsRaw), [idsRaw])

  function handlePreview() {
    const err = validateIds(ids, hasAlchemyKey())
    setValidationError(err)
    if (err) return
    setFilters(emptyFilters())
    preview(ids)
  }

  function handleShuffle() {
    if (viewMode === 'my-checks') myCheckPerms.shuffle()
    else loadRandom()
  }

  // ── Derive display values ─────────────────────────────────────────────────
  const isMyChecksMode = dbMode && viewMode === 'my-checks'

  const permutations = isMyChecksMode
    ? myCheckPerms.permutations
    : dbMode ? dbState.permutations : chainState.permutations

  const isLoading = isMyChecksMode
    ? myChecks.loading
    : dbMode ? dbState.loading : chainState.permutations.some(p => p.nodeAbcd.loading)

  const showFlags = (isMyChecksMode || !dbMode)
    ? permutations.map(p =>
        !p.nodeAbcd.loading && !p.nodeAbcd.error
          ? matchesFilters(p.nodeAbcd.attributes, filters)
          : true
      )
    : permutations.map(() => true)

  const visibleCount = showFlags.filter(Boolean).length

  const showFilters = isMyChecksMode
    ? myCheckPerms.permutations.length > 0
    : dbMode
      ? dbState.total > 0 || dbState.loading || hasActiveFilters
      : permutations.length > 0

  const myChecksError = isMyChecksMode
    ? (myChecks.error || (myChecks.tokenIds.length === 0 && !myChecks.loading ? 'No Checks VV tokens found in this wallet.' : ''))
    : ''

  const navbarError = dbMode
    ? (myChecksError || dbState.error || '')
    : (validationError || (!hasAlchemyKey() ? 'VITE_ALCHEMY_API_KEY not set in frontend/.env' : ''))

  return (
    <>
      <Navbar
        ids={dbMode ? '' : idsRaw}
        loading={isLoading}
        onIdsChange={dbMode ? () => {} : setIdsRaw}
        onPreview={dbMode ? () => {} : handlePreview}
        error={navbarError}
        dbMode={dbMode}
        dbTotal={dbMode ? dbState.total : undefined}
        viewMode={dbMode && isConnected ? viewMode : undefined}
        onViewModeChange={dbMode && isConnected ? setViewMode : undefined}
      />
      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          visible={isMyChecksMode ? visibleCount : dbMode ? dbState.permutations.length : visibleCount}
          onShuffle={(isMyChecksMode || (dbMode && !hasActiveFilters)) ? handleShuffle : undefined}
        />
      )}
      {isMyChecksMode && myChecks.tokenIds.length > 0 && myCheckPerms.permutations.length === 0 && !myChecks.loading && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          Not enough compatible checks to generate permutations.
        </div>
      )}
      {!isMyChecksMode && dbMode && !dbState.loading && hasActiveFilters && dbState.total === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          No permutations match these filters.
        </div>
      )}
      <InfiniteGrid
        permutations={permutations}
        ids={ids}
        showFlags={showFlags}
        hasFilters={showFilters}
        dbMode={dbMode}
      />
      {(dbMode && (isMyChecksMode ? myChecks.loading : dbState.loading)) && (
        <div style={{
          position: 'fixed', bottom: '1rem', right: '1rem',
          background: '#1a1a1a', border: '1px solid #333', borderRadius: '3px',
          padding: '0.35rem 0.75rem', fontSize: '0.75rem', color: '#888',
          zIndex: 50,
        }}>
          Loading…
        </div>
      )}
    </>
  )
}
```

**Step 3: Run the full test suite**

```bash
cd frontend && npx vitest run
```
Expected: all existing tests pass + 2 new test files pass.

**Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wire My Checks view mode in App — toggle, cache, JS permutations"
```

---

### Final verification

```bash
cd frontend && npm run build
```
Expected: `✓ built` with no TypeScript errors.

Then push:
```bash
git push
```
