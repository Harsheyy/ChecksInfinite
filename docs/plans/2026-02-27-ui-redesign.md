# UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current page layout with a fixed navbar + filter strip + infinite torus-scroll grid of SVG-only permutation cards.

**Architecture:** Fixed 48px navbar holds the input form; a conditional 40px filter strip (select dropdowns) sits beneath it; the remaining viewport is an `overflow: auto` container with 3×3 tiled copies of the permutation grid — on scroll, a `scroll` event listener teleports the scroll position when it exits the center tile, creating an infinite loop illusion. `App.tsx` lifts filter state up so the filter strip can live outside the grid viewport.

**Tech Stack:** React 19, TypeScript 5, CSS (no external CSS frameworks), Vitest 4 + @testing-library/react, Vite 7.

---

## Background & Context

The codebase lives in `frontend/src/`. Key files:
- `App.tsx` — top-level component; uses `useAllPermutations` hook
- `components/InputPanel.tsx` — old input form; will be deleted
- `components/FilterBar.tsx` — chip-based filter; will be rewritten as dropdowns
- `components/PermutationGrid.tsx` — current grid wrapper; will be replaced by `InfiniteGrid`
- `components/PermutationCard.tsx` — single card; will be updated (remove label, update loading)
- `index.css` — all styles; will be overhauled

Run tests with: `cd frontend && npx vitest run`
Run dev server: `cd frontend && npm run dev`

---

### Task 1: Navbar component

**Files:**
- Create: `frontend/src/components/Navbar.tsx`
- Create: `frontend/src/components/Navbar.test.tsx`

**Step 1: Write the failing test**

```tsx
// frontend/src/components/Navbar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Navbar } from './Navbar'

describe('Navbar', () => {
  it('renders brand, input, preview button, wallet button', () => {
    render(<Navbar ids="" loading={false} onIdsChange={vi.fn()} onPreview={vi.fn()} error="" />)
    expect(screen.getByText('◆ Checks Infinite')).toBeTruthy()
    expect(screen.getByPlaceholderText(/1234/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Preview/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Connect Wallet/ })).toBeTruthy()
  })

  it('shows error message when error prop is set', () => {
    render(<Navbar ids="" loading={false} onIdsChange={vi.fn()} onPreview={vi.fn()} error="Enter at least 4 IDs" />)
    expect(screen.getByText('Enter at least 4 IDs')).toBeTruthy()
  })

  it('disables preview button when loading', () => {
    render(<Navbar ids="" loading={true} onIdsChange={vi.fn()} onPreview={vi.fn()} error="" />)
    const btn = screen.getByRole('button', { name: /Loading/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls onPreview on form submit', () => {
    const onPreview = vi.fn()
    render(<Navbar ids="1,2,3,4" loading={false} onIdsChange={vi.fn()} onPreview={onPreview} error="" />)
    fireEvent.submit(screen.getByRole('form'))
    expect(onPreview).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run to confirm failure**

```bash
cd frontend && npx vitest run src/components/Navbar.test.tsx
```
Expected: FAIL — `Navbar` not found.

**Step 3: Implement Navbar**

```tsx
// frontend/src/components/Navbar.tsx
interface NavbarProps {
  ids: string
  loading: boolean
  onIdsChange: (v: string) => void
  onPreview: () => void
  error: string
}

export function Navbar({ ids, loading, onIdsChange, onPreview, error }: NavbarProps) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onPreview()
  }

  return (
    <nav className="navbar" aria-label="main navigation">
      <span className="nav-brand">◆ Checks Infinite</span>
      <div className="nav-center">
        <form onSubmit={handleSubmit} aria-label="form">
          <input
            type="text"
            className="nav-ids-input"
            placeholder="e.g. 1234, 5678, 9012, 3456"
            value={ids}
            onChange={e => onIdsChange(e.target.value)}
          />
          <button type="submit" disabled={loading} className="nav-preview-btn">
            {loading ? 'Loading…' : 'Preview →'}
          </button>
        </form>
        {error && <div className="nav-error">{error}</div>}
      </div>
      <button type="button" className="nav-wallet" disabled>Connect Wallet</button>
    </nav>
  )
}
```

**Step 4: Run tests**

```bash
cd frontend && npx vitest run src/components/Navbar.test.tsx
```
Expected: 4 tests PASS.

**Step 5: Commit**

```bash
cd frontend && git add src/components/Navbar.tsx src/components/Navbar.test.tsx
git commit -m "feat: add Navbar component with brand, input, wallet placeholder"
```

---

### Task 2: FilterBar with select dropdowns

**Files:**
- Modify: `frontend/src/components/FilterBar.tsx`
- Create: `frontend/src/components/FilterBar.test.tsx`

The `Filters` type changes from `Set<string>` per field to `string` per field (`''` = "All"). `matchesFilters` logic is identical but uses `=== value` instead of `.has(value)`.

**Step 1: Write the failing test**

```tsx
// frontend/src/components/FilterBar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FilterBar, emptyFilters, matchesFilters } from './FilterBar'
import type { Filters } from './FilterBar'
import type { Attribute } from '../utils'

describe('emptyFilters', () => {
  it('returns all empty strings', () => {
    const f = emptyFilters()
    expect(f.checks).toBe('')
    expect(f.colorBand).toBe('')
    expect(f.gradient).toBe('')
    expect(f.speed).toBe('')
    expect(f.shift).toBe('')
  })
})

describe('matchesFilters', () => {
  const attrs: Attribute[] = [
    { trait_type: 'Checks', value: '80' },
    { trait_type: 'Color Band', value: 'Eighty' },
    { trait_type: 'Gradient', value: 'None' },
    { trait_type: 'Speed', value: '1x' },
    { trait_type: 'Shift', value: 'UV' },
  ]

  it('passes when all filters empty', () => {
    expect(matchesFilters(attrs, emptyFilters())).toBe(true)
  })

  it('passes when filter matches attribute value', () => {
    expect(matchesFilters(attrs, { ...emptyFilters(), checks: '80' })).toBe(true)
  })

  it('fails when filter does not match', () => {
    expect(matchesFilters(attrs, { ...emptyFilters(), checks: '40' })).toBe(false)
  })

  it('passes when attribute is absent (unrevealed composite)', () => {
    expect(matchesFilters([], { ...emptyFilters(), checks: '80' })).toBe(true)
  })

  it('applies AND logic: fails if any active filter mismatches', () => {
    const f: Filters = { ...emptyFilters(), checks: '80', colorBand: 'Twenty' }
    expect(matchesFilters(attrs, f)).toBe(false)
  })
})

describe('FilterBar', () => {
  it('renders 5 select dropdowns', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} total={24} visible={24} />)
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(5)
  })

  it('shows Showing X / Y count', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} total={24} visible={18} />)
    expect(screen.getByText(/18 \/ 24/)).toBeTruthy()
  })

  it('calls onChange when a select changes', () => {
    const onChange = vi.fn()
    render(<FilterBar filters={emptyFilters()} onChange={onChange} total={24} visible={24} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: '80' } })
    expect(onChange).toHaveBeenCalledWith({ ...emptyFilters(), checks: '80' })
  })

  it('shows Clear button when any filter is active', () => {
    render(<FilterBar filters={{ ...emptyFilters(), checks: '80' }} onChange={vi.fn()} total={24} visible={10} />)
    expect(screen.getByRole('button', { name: /Clear/ })).toBeTruthy()
  })

  it('hides Clear button when no filters active', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} total={24} visible={24} />)
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull()
  })
})
```

**Step 2: Run to confirm failure**

```bash
cd frontend && npx vitest run src/components/FilterBar.test.tsx
```
Expected: FAIL — type errors and missing exports.

**Step 3: Rewrite FilterBar.tsx**

```tsx
// frontend/src/components/FilterBar.tsx
import type { Attribute } from '../utils'

export interface Filters {
  checks: string
  colorBand: string
  gradient: string
  speed: string
  shift: string
}

export function emptyFilters(): Filters {
  return { checks: '', colorBand: '', gradient: '', speed: '', shift: '' }
}

const CHECKS_OPTIONS    = ['1', '5', '10', '20', '40', '80']
const COLOR_BAND_OPTIONS = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One']
const GRADIENT_OPTIONS  = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z']
const SPEED_OPTIONS     = ['0.5x', '1x', '2x']
const SHIFT_OPTIONS     = ['IR', 'UV']

interface FilterSelectProps {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}

function FilterSelect({ label, options, value, onChange }: FilterSelectProps) {
  return (
    <label className="filter-select-label">
      <span className="filter-select-name">{label}</span>
      <select
        className="filter-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  )
}

interface FilterBarProps {
  filters: Filters
  onChange: (f: Filters) => void
  total: number
  visible: number
}

export function FilterBar({ filters, onChange, total, visible }: FilterBarProps) {
  function update(key: keyof Filters, val: string) {
    onChange({ ...filters, [key]: val })
  }

  function clearAll() { onChange(emptyFilters()) }

  const isActive = Object.values(filters).some(v => v !== '')

  return (
    <div className="filter-strip">
      <FilterSelect label="Checks"     options={CHECKS_OPTIONS}     value={filters.checks}    onChange={v => update('checks', v)} />
      <FilterSelect label="Color Band" options={COLOR_BAND_OPTIONS} value={filters.colorBand} onChange={v => update('colorBand', v)} />
      <FilterSelect label="Gradient"   options={GRADIENT_OPTIONS}   value={filters.gradient}  onChange={v => update('gradient', v)} />
      <FilterSelect label="Speed"      options={SPEED_OPTIONS}      value={filters.speed}     onChange={v => update('speed', v)} />
      <FilterSelect label="Shift"      options={SHIFT_OPTIONS}      value={filters.shift}     onChange={v => update('shift', v)} />
      <span className="filter-count">Showing {visible} / {total}</span>
      {isActive && (
        <button type="button" className="filter-clear" onClick={clearAll}>Clear</button>
      )}
    </div>
  )
}

/** Returns true if the attributes satisfy all active filters (AND logic; '' = pass all). */
export function matchesFilters(attributes: Attribute[], filters: Filters): boolean {
  function check(key: keyof Filters, traitType: string): boolean {
    if (!filters[key]) return true
    const attr = attributes.find(a => a.trait_type === traitType)
    if (!attr) return true  // unrevealed composites lack some attributes — pass all filters
    return filters[key] === attr.value
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

**Step 4: Run tests**

```bash
cd frontend && npx vitest run src/components/FilterBar.test.tsx
```
Expected: all PASS.

**Step 5: Run all tests to verify no regressions**

```bash
cd frontend && npx vitest run
```
Note: `PermutationGrid.tsx` will have a type error (still imports old `Filters` with Sets). That is expected and will be fixed in Task 3. The tests that do pass should still pass; only type-level errors are expected from the old PermutationGrid.

**Step 6: Commit**

```bash
cd frontend && git add src/components/FilterBar.tsx src/components/FilterBar.test.tsx
git commit -m "feat: rewrite FilterBar with select dropdowns, Filters as strings"
```

---

### Task 3: App.tsx refactor — lift filter state, wire Navbar

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/components/InputPanel.tsx` (no longer needed)

**Step 1: No new test needed** — existing tests continue covering the helpers. The integration is tested visually. Skip ahead.

**Step 2: Rewrite App.tsx**

Replace the entire file:

```tsx
// frontend/src/App.tsx
import { useState, useMemo } from 'react'
import { Navbar } from './components/Navbar'
import { FilterBar, emptyFilters, matchesFilters, type Filters } from './components/FilterBar'
import { InfiniteGrid } from './components/InfiniteGrid'
import { useAllPermutations } from './useAllPermutations'
import { hasAlchemyKey } from './client'
import { parseIds, validateIds } from './utils'

export default function App() {
  const [idsRaw, setIdsRaw] = useState('')
  const [validationError, setValidationError] = useState('')
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const { state, preview } = useAllPermutations()

  const ids = useMemo(() => parseIds(idsRaw), [idsRaw])
  const isLoading = state.permutations.some(p => p.nodeAbcd.loading)

  function handlePreview() {
    const err = validateIds(ids, hasAlchemyKey())
    setValidationError(err)
    if (err) return
    setFilters(emptyFilters())
    preview(ids)
  }

  const showFlags = state.permutations.map(p =>
    !p.nodeAbcd.loading && !p.nodeAbcd.error
      ? matchesFilters(p.nodeAbcd.attributes, filters)
      : true
  )
  const visibleCount = showFlags.filter(Boolean).length

  const showFilters = state.permutations.length > 0

  return (
    <>
      <Navbar
        ids={idsRaw}
        loading={isLoading}
        onIdsChange={setIdsRaw}
        onPreview={handlePreview}
        error={validationError || (!hasAlchemyKey() ? 'VITE_ALCHEMY_API_KEY not set in frontend/.env' : '')}
      />
      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          total={state.permutations.length}
          visible={visibleCount}
        />
      )}
      <InfiniteGrid
        permutations={state.permutations}
        ids={ids}
        showFlags={showFlags}
      />
    </>
  )
}
```

Note: `InfiniteGrid` will not exist yet (TypeScript error expected). That's fine — it'll be created in Task 5.

**Step 3: Delete InputPanel.tsx**

```bash
rm frontend/src/components/InputPanel.tsx
```

**Step 4: Run all tests**

```bash
cd frontend && npx vitest run
```
Expected: existing passing tests still pass; TypeScript compile error for missing `InfiniteGrid` is expected at this stage.

**Step 5: Commit**

```bash
cd frontend && git add src/App.tsx && git rm src/components/InputPanel.tsx
git commit -m "refactor: lift filter state to App, wire Navbar, remove InputPanel"
```

---

### Task 4: PermutationCard — SVG-only, no label

**Files:**
- Modify: `frontend/src/components/PermutationCard.tsx`

The card should render:
- A 160×160 container
- When `!visible`: a transparent spacer (preserves grid position — do NOT return null)
- When loading: a pulsing dark placeholder
- When error: a subtle `✕` indicator
- When ready + inView: the SVG
- No label text at all
- Hover border via CSS

**Step 1: No new test for this component** (SVG rendering is tested visually). Proceed to implementation.

**Step 2: Rewrite PermutationCard.tsx**

```tsx
// frontend/src/components/PermutationCard.tsx
import { useRef, useEffect, useState } from 'react'
import type { PermutationResult } from '../useAllPermutations'

interface PermutationCardProps {
  result: PermutationResult
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
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!visible) {
    // Transparent spacer: preserves grid layout without rendering anything visible
    return <div className="perm-card-spacer" ref={cardRef} />
  }

  return (
    <div className="perm-card" ref={cardRef} onClick={onClick} title={def.label}>
      {nodeAbcd.loading && <div className="perm-card-pulse" />}
      {nodeAbcd.error && !nodeAbcd.loading && <div className="perm-card-error">✕</div>}
      {!nodeAbcd.loading && !nodeAbcd.error && inView && nodeAbcd.svg && (
        <div className="perm-card-svg" dangerouslySetInnerHTML={{ __html: nodeAbcd.svg }} />
      )}
    </div>
  )
}
```

Key change: when `!visible`, returns a spacer `<div>` instead of `null`. This is critical for the torus grid — each tile must have the same number of DOM rows/columns so tile dimensions are consistent and teleportation math works correctly.

**Step 3: Run all tests**

```bash
cd frontend && npx vitest run
```
Expected: all previously passing tests still pass.

**Step 4: Commit**

```bash
cd frontend && git add src/components/PermutationCard.tsx
git commit -m "refactor: PermutationCard SVG-only, spacer for hidden cards"
```

---

### Task 5: InfiniteGrid component with torus scroll

**Files:**
- Create: `frontend/src/components/InfiniteGrid.tsx`
- Create: `frontend/src/components/InfiniteGrid.test.tsx`

**Architecture of InfiniteGrid:**
- Outer container (`gridViewport`): `position: fixed`, fills viewport below filter strip, `overflow: auto`
- Inner content (`gridContent`): 3 rows × 3 cols of tile divs, each tile being a CSS grid of cards
- Each tile renders all permutations (with showFlags)
- On mount: scroll to center tile (`scrollLeft = tileRef.offsetWidth`, `scrollTop = tileRef.offsetHeight`)
- On `scroll`: teleport when scroll exits the center tile range

The center tile is the tile at index [1][1] (0-indexed). Its top-left corner is at `(tileWidth, tileHeight)` in content coordinates.

Teleport logic (imperatively sets `scrollLeft`/`scrollTop`, does NOT cause React re-render):
```
if scrollLeft < tileWidth:       scrollLeft += tileWidth
if scrollLeft >= 2 * tileWidth:  scrollLeft -= tileWidth
if scrollTop  < tileHeight:      scrollTop  += tileHeight
if scrollTop  >= 2 * tileHeight: scrollTop  -= tileHeight
```

**Step 1: Write the failing test**

```tsx
// frontend/src/components/InfiniteGrid.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { InfiniteGrid } from './InfiniteGrid'
import type { PermutationResult } from '../useAllPermutations'

function makePermutation(label: string): PermutationResult {
  const card = { name: label, svg: '', attributes: [], loading: false, error: '' }
  return {
    def: { indices: [0, 1, 2, 3], label },
    nodeA: card, nodeB: card, nodeC: card, nodeD: card,
    nodeL1a: card, nodeL1b: card, nodeAbcd: card,
  }
}

describe('InfiniteGrid', () => {
  it('renders nothing when permutations is empty', () => {
    const { container } = render(<InfiniteGrid permutations={[]} ids={[]} showFlags={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders 9 tile copies when permutations are present', () => {
    const perms = [makePermutation('A▸B, C▸D')]
    render(<InfiniteGrid permutations={perms} ids={['1','2','3','4']} showFlags={[true]} />)
    // 9 tiles × 1 card each = 9 perm-card or perm-card-spacer elements
    const cards = document.querySelectorAll('.perm-card, .perm-card-spacer')
    expect(cards.length).toBe(9)
  })

  it('opens TreeModal when a card is clicked', async () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = render(<InfiniteGrid permutations={perms} ids={['1','2','3','4']} showFlags={[true]} />)
    // Click the first visible card (first tile, first card)
    const card = container.querySelector('.perm-card') as HTMLElement
    card?.click()
    // Modal overlay should appear
    expect(document.querySelector('.tree-modal-overlay')).toBeTruthy()
  })
})
```

**Step 2: Run to confirm failure**

```bash
cd frontend && npx vitest run src/components/InfiniteGrid.test.tsx
```
Expected: FAIL — `InfiniteGrid` not found.

**Step 3: Implement InfiniteGrid.tsx**

```tsx
// frontend/src/components/InfiniteGrid.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { PermutationCard } from './PermutationCard'
import { TreeModal } from './TreeModal'
import type { PermutationResult } from '../useAllPermutations'

interface InfiniteGridProps {
  permutations: PermutationResult[]
  ids: string[]
  showFlags: boolean[]
}

/** One tile: a CSS grid of all permutation cards */
function GridTile({ permutations, showFlags, onCardClick }: {
  permutations: PermutationResult[]
  showFlags: boolean[]
  onCardClick: (i: number) => void
}) {
  return (
    <div className="infinite-tile">
      {permutations.map((result, i) => (
        <PermutationCard
          key={result.def.label + '-' + i}
          result={result}
          visible={showFlags[i]}
          onClick={() => onCardClick(i)}
        />
      ))}
    </div>
  )
}

export function InfiniteGrid({ permutations, ids, showFlags }: InfiniteGridProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tileRef = useRef<HTMLDivElement>(null)

  // Center scroll on the middle tile whenever permutations change
  useEffect(() => {
    const c = containerRef.current
    const t = tileRef.current
    if (!c || !t || permutations.length === 0) return
    // Use RAF to ensure layout is complete before reading offsetWidth/offsetHeight
    requestAnimationFrame(() => {
      c.scrollLeft = t.offsetWidth
      c.scrollTop = t.offsetHeight
    })
  }, [permutations.length])

  // Torus teleport: when scroll exits center tile range, jump by one tile dimension
  const handleScroll = useCallback(() => {
    const c = containerRef.current
    const t = tileRef.current
    if (!c || !t) return
    const tW = t.offsetWidth
    const tH = t.offsetHeight
    if (tW === 0 || tH === 0) return
    if (c.scrollLeft < tW) c.scrollLeft += tW
    else if (c.scrollLeft >= 2 * tW) c.scrollLeft -= tW
    if (c.scrollTop < tH) c.scrollTop += tH
    else if (c.scrollTop >= 2 * tH) c.scrollTop -= tH
  }, [])

  if (permutations.length === 0) return null

  // 9 tiles: 3 rows × 3 cols
  const tiles = Array.from({ length: 9 }, (_, idx) => (
    <GridTile
      key={idx}
      permutations={permutations}
      showFlags={showFlags}
      onCardClick={setSelectedIndex}
    />
  ))

  return (
    <>
      <div className="grid-viewport" ref={containerRef} onScroll={handleScroll}>
        <div className="grid-content">
          {/* Row 0 */}
          <div className="grid-row">
            {tiles[0]}{tiles[1]}{tiles[2]}
          </div>
          {/* Row 1 (center) */}
          <div className="grid-row">
            {tiles[3]}
            <div ref={tileRef}>{tiles[4]}</div>
            {tiles[5]}
          </div>
          {/* Row 2 */}
          <div className="grid-row">
            {tiles[6]}{tiles[7]}{tiles[8]}
          </div>
        </div>
      </div>
      {selectedIndex !== null && (
        <TreeModal
          result={permutations[selectedIndex]}
          ids={ids}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </>
  )
}
```

**Step 4: Run the tests**

```bash
cd frontend && npx vitest run src/components/InfiniteGrid.test.tsx
```
Expected: all 3 tests PASS.

**Step 5: Run all tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests pass (61+ tests).

**Step 6: Commit**

```bash
cd frontend && git add src/components/InfiniteGrid.tsx src/components/InfiniteGrid.test.tsx
git commit -m "feat: InfiniteGrid with 3x3 torus scroll"
```

---

### Task 6: CSS overhaul

**Files:**
- Modify: `frontend/src/index.css`

Replace the entire file with the new layout. Key layout principles:
- `body`: `overflow: hidden` (all scroll handled by grid viewport)
- `.navbar`: `position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 10`
- `.filter-strip`: `position: fixed; top: 48px; left: 0; right: 0; height: 40px; z-index: 9`
- `.grid-viewport`: `position: fixed; top: 48px; left: 0; right: 0; bottom: 0; overflow: auto`
  - When filter strip is present, its top is `88px` (48 + 40). This is controlled via CSS variable or a body class.
- `.infinite-tile`: CSS grid, `grid-template-columns: repeat(6, 160px); gap: 12px; padding: 28px`
- `.perm-card`: `width: 160px; height: 160px; cursor: pointer; background: #000; border: 1px solid transparent`
- `.perm-card:hover`: `border-color: #555`
- `.perm-card-spacer`: `width: 160px; height: 160px; pointer-events: none`
- `.perm-card-pulse`: `width: 100%; height: 100%; background: #1a1a1a; animation: pulse 1.5s ease-in-out infinite`
- `.perm-card-svg svg`: `width: 100%; height: 100%; display: block`
- `.grid-row`: `display: flex` (tiles in a row)
- `.grid-content`: inline-block or fit-content to size to content

The filter strip presence shifts the grid viewport top. Use a CSS custom property + JS to set it dynamically, OR use the simpler approach of always reserving 88px and just hiding the filter strip with `visibility: hidden` when not active. But since the filter strip should not exist in DOM when not active (App.tsx conditionally renders it), we need the grid viewport top to change.

The cleanest approach: use a CSS variable `--header-height` on `:root`, defaulting to `48px`. When filter strip is present, App.tsx sets it to `88px` via a ref or inline style. OR — simplest — use two CSS classes on `body`: `body.has-filters .grid-viewport { top: 88px }`.

Even simpler: `App.tsx` renders a wrapper `<div>` (instead of fragment) that has a data attribute, or we just hardcode two values in CSS and add/remove a class.

**Simplest implementation:** always render the filter strip div (show/hide with `display: none`), so the grid viewport top is always `88px`. When `permutations.length === 0`, the filter strip has `display: none` but takes no space... wait, `display: none` removes it from flow, but since the grid viewport is `position: fixed`, it doesn't matter.

Actually since all three elements are `position: fixed`, there's no flow relationship. The grid viewport's `top` value simply needs to be `48px` (navbar only) or `88px` (navbar + filter). The cleanest approach for React: pass a boolean prop or use a CSS variable.

**Chosen approach:** Render a `<div id="layout-root">` in `App.tsx` with a `data-filters` attribute. CSS uses:
```css
#layout-root .grid-viewport { top: 48px; }
#layout-root[data-filters="true"] .grid-viewport { top: 88px; }
```

**Step 1: No test needed for pure CSS.**

**Step 2: Replace index.css**

```css
/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Courier New', Courier, monospace;
  background: #0a0a0a;
  color: #eee;
  overflow: hidden;
}

/* ─── Navbar ─────────────────────────────────────────────── */
.navbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 48px;
  background: #111;
  border-bottom: 1px solid #222;
  display: flex;
  align-items: center;
  padding: 0 28px;
  gap: 1rem;
  z-index: 10;
}

.nav-brand {
  font-size: 0.85rem;
  letter-spacing: 0.08em;
  color: #ccc;
  white-space: nowrap;
  flex-shrink: 0;
}

.nav-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.nav-center form {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  max-width: 560px;
}

.nav-ids-input {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  color: #eee;
  padding: 0.35rem 0.65rem;
  font-family: inherit;
  font-size: 0.82rem;
  min-width: 0;
}
.nav-ids-input:focus { outline: 1px solid #555; }

.nav-preview-btn {
  background: #eee;
  color: #111;
  border: none;
  border-radius: 3px;
  padding: 0.35rem 0.9rem;
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: bold;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.nav-preview-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.nav-preview-btn:hover:not(:disabled) { background: #fff; }

.nav-error {
  color: #f87171;
  font-size: 0.72rem;
  margin-top: 2px;
  align-self: flex-start;
  max-width: 560px;
}

.nav-wallet {
  background: transparent;
  border: 1px solid #333;
  border-radius: 3px;
  color: #666;
  font-family: inherit;
  font-size: 0.75rem;
  padding: 0.3rem 0.75rem;
  cursor: not-allowed;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ─── Filter strip ────────────────────────────────────────── */
.filter-strip {
  position: fixed;
  top: 48px; left: 0; right: 0;
  height: 40px;
  background: #111;
  border-bottom: 1px solid #222;
  display: flex;
  align-items: center;
  padding: 0 28px;
  gap: 0.75rem;
  z-index: 9;
  overflow: hidden;
}

.filter-select-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  flex-shrink: 0;
}

.filter-select-name {
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.filter-select {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 2px;
  color: #ccc;
  font-family: inherit;
  font-size: 0.72rem;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
}
.filter-select:focus { outline: 1px solid #555; }

.filter-count {
  margin-left: auto;
  font-size: 0.7rem;
  color: #555;
  white-space: nowrap;
}

.filter-clear {
  background: transparent;
  border: none;
  color: #777;
  font-family: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  flex-shrink: 0;
}
.filter-clear:hover { color: #ccc; }

/* ─── Grid viewport ───────────────────────────────────────── */
.grid-viewport {
  position: fixed;
  top: 48px; left: 0; right: 0; bottom: 0;
  overflow: auto;
  background: #0a0a0a;
}

/* When filter strip is visible, push grid down */
.grid-viewport--with-filters {
  top: 88px;
}

.grid-content {
  display: inline-flex;
  flex-direction: column;
}

.grid-row {
  display: flex;
  flex-direction: row;
}

/* ─── Infinite tile ───────────────────────────────────────── */
.infinite-tile {
  display: grid;
  grid-template-columns: repeat(6, 160px);
  gap: 12px;
  padding: 28px;
}

/* ─── Permutation card ────────────────────────────────────── */
.perm-card {
  width: 160px;
  height: 160px;
  cursor: pointer;
  background: #000;
  border: 1px solid transparent;
  border-radius: 3px;
  overflow: hidden;
  position: relative;
  transition: border-color 0.1s;
}
.perm-card:hover { border-color: #444; }

.perm-card-spacer {
  width: 160px;
  height: 160px;
  pointer-events: none;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50%       { opacity: 0.6; }
}

.perm-card-pulse {
  width: 100%;
  height: 100%;
  background: #1a1a1a;
  animation: pulse 1.5s ease-in-out infinite;
}

.perm-card-error {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
  font-size: 1.2rem;
}

.perm-card-svg {
  width: 100%;
  height: 100%;
}
.perm-card-svg svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ─── Tree modal ──────────────────────────────────────────── */
.tree-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.tree-modal {
  position: relative;
  background: #111;
  border: 1px solid #333;
  border-radius: 6px;
  max-width: 1100px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  padding: 2rem 1.5rem 1.5rem;
}

.tree-modal-close {
  position: absolute;
  top: 1rem; right: 1rem;
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
  border-radius: 3px;
  width: 2rem; height: 2rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tree-modal-close:hover { border-color: #888; color: #eee; }

.tree-modal-title {
  font-size: 0.85rem;
  color: #888;
  margin-bottom: 1.5rem;
  letter-spacing: 0.05em;
}

/* ─── Tree layout (inside modal) ─────────────────────────── */
.tree-layout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
  padding: 1rem;
}

.tree-row {
  display: flex;
  justify-content: center;
  gap: 3rem;
  width: 100%;
}

.tree-pair { display: flex; gap: 1rem; }
.tree-node-centered { display: flex; justify-content: center; }
.tree-row-l1 { gap: 8rem; }
.tree-row-l2 { justify-content: center; }

/* ─── Check card (inside modal) ──────────────────────────── */
.check-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.check-card-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
.check-card-name  { font-size: 0.95rem; color: #ccc; }
.check-card-svg svg { width: 100%; height: auto; display: block; }
.check-card-attrs { display: flex; flex-direction: column; gap: 0.3rem; }
.check-card-attr  { display: flex; justify-content: space-between; font-size: 0.8rem; }
.check-card-attr dt { color: #666; }
.check-card-attr dd { color: #ddd; }
.check-card-loading { color: #666; font-size: 0.85rem; }
.check-card-error   { color: #f87171; font-size: 0.82rem; line-height: 1.4; }
```

**Step 3: Update App.tsx to add `grid-viewport--with-filters` class**

In `App.tsx`, pass the `showFilters` flag to control the grid viewport class. Since `InfiniteGrid` renders the `.grid-viewport` internally, add a `hasFilters` prop to `InfiniteGrid`:

Update `InfiniteGrid.tsx` — add `hasFilters?: boolean` prop and apply the class:

```tsx
// In InfiniteGrid.tsx, update the interface and container div:
interface InfiniteGridProps {
  permutations: PermutationResult[]
  ids: string[]
  showFlags: boolean[]
  hasFilters?: boolean
}

// In the return, change:
<div
  className={`grid-viewport${hasFilters ? ' grid-viewport--with-filters' : ''}`}
  ref={containerRef}
  onScroll={handleScroll}
>
```

And in `App.tsx`, pass `hasFilters={showFilters}` to `<InfiniteGrid>`.

**Step 4: Run all tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests pass.

**Step 5: Commit**

```bash
cd frontend && git add src/index.css src/components/InfiniteGrid.tsx src/App.tsx
git commit -m "feat: CSS overhaul — fixed navbar, filter strip, full-viewport grid"
```

---

### Task 7: Final integration check

**Step 1: Run the dev server and verify visually**

```bash
cd frontend && npm run dev
```

Verify:
1. Navbar renders at top with brand, input, preview button, wallet button
2. Entering 4+ valid token IDs and clicking Preview loads permutations
3. Filter strip appears below navbar with 5 dropdowns + count
4. Dropdowns filter the grid correctly
5. Grid fills the viewport with 6-column cards
6. Scrolling right/down teleports back to show continuous cards
7. Clicking a card opens the TreeModal with the full tree view
8. ESC closes the modal

**Step 2: Run all tests one final time**

```bash
cd frontend && npx vitest run
```
Expected: all 60+ tests pass.

**Step 3: Final commit**

```bash
cd frontend && git add -p
git commit -m "feat: complete UI redesign — infinite torus grid, fixed navbar, filter dropdowns"
```
