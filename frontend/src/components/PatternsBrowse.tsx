// frontend/src/components/PatternsBrowse.tsx
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { usePatternCatalog, type BrowsePattern } from '../usePatternCatalog'
import { useBackgroundPermutations } from '../useBackgroundPermutations'
import { InfiniteGrid } from './InfiniteGrid'
import { SearchBackground } from './SearchPage'
import type { PermutationResult } from '../useAllPermutations'

// The rendered composite is a 20-cell grid, 4 columns x 5 rows, row-major
// (see checksArtJS.ts's perRow(20) === 4) — 20 dots in DOM order lay out
// correctly under a plain 4-column CSS grid with no manual row/col math.
const GRID_COLS = 4
const GRID_CELLS = 20

function PatternSilhouette({ dimCells, brightCells }: { dimCells: number[]; brightCells: number[] }) {
  const dim    = new Set(dimCells)
  const bright = new Set(brightCells)
  return (
    <div className="pattern-silhouette" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}>
      {Array.from({ length: GRID_CELLS }, (_, i) => {
        const role = bright.has(i) ? 'bright' : dim.has(i) ? 'dim' : 'majority'
        return <span key={i} className={`pattern-silhouette-dot pattern-silhouette-dot--${role}`} />
      })}
    </div>
  )
}

function PatternRow({ pattern, onClick }: { pattern: BrowsePattern; onClick: () => void }) {
  return (
    <div className="pattern-row" onClick={onClick} role="button" tabIndex={0}>
      <PatternSilhouette dimCells={pattern.dimCells} brightCells={pattern.brightCells} />
      <div className="pattern-row-info">
        <span className="pattern-row-title">{pattern.nColors} colors</span>
        <span className="pattern-row-sub">{pattern.minoritySize}-check minority</span>
      </div>
      <span className="pattern-row-count">×{pattern.recipeCount}</span>
    </div>
  )
}

interface PatternsBrowseProps {
  tabs: ReactNode
}

export function PatternsBrowse({ tabs }: PatternsBrowseProps) {
  const { patterns, loading, error, loadPatternRecipes } = usePatternCatalog()
  const bgSvgs = useBackgroundPermutations()
  const [selected, setSelected]   = useState<BrowsePattern | null>(null)
  const [recipes, setRecipes]     = useState<PermutationResult[]>([])
  const [recipesLoading, setRecipesLoading] = useState(false)

  // Mirrors SearchPage's own gridTop measurement so InfiniteGrid sits flush
  // under the fixed detail bar, exactly like the ids/wallet results view.
  const fixedBarRef = useRef<HTMLDivElement>(null)
  const [gridTop, setGridTop] = useState(88)
  useEffect(() => {
    if (!selected || !fixedBarRef.current) return
    setGridTop(Math.round(fixedBarRef.current.getBoundingClientRect().bottom))
  }, [selected])

  async function openPattern(p: BrowsePattern) {
    setSelected(p)
    setRecipesLoading(true)
    const r = await loadPatternRecipes(p.patternKey)
    setRecipes(r)
    setRecipesLoading(false)
  }

  // ── Detail view: same fixed-bar + InfiniteGrid chrome the ids/wallet
  // results view uses, once a search has been submitted ──────────────────
  if (selected) {
    return (
      <>
        <div className="search-fixed-bar" ref={fixedBarRef}>
          <button type="button" className="search-fixed-bar__edit" onClick={() => setSelected(null)}>← Back</button>
          <div className="search-fixed-bar__spacer" />
          <span className="filter-count">
            {selected.nColors} colors · {selected.minoritySize}-check minority · {selected.recipeCount} recipe{selected.recipeCount === 1 ? '' : 's'}
          </span>
        </div>
        {recipesLoading ? (
          <div className="pattern-status">Loading recipes…</div>
        ) : (
          <InfiniteGrid
            permutations={recipes}
            ids={[]}
            showFlags={recipes.map(() => true)}
            hasFilters={false}
            dbMode={true}
            hideBuy={true}
            topPx={gridTop}
          />
        )}
      </>
    )
  }

  // ── Browse view: same landing-panel chrome (background canvas + centered
  // card) the ids/wallet tabs use before a search is submitted ───────────
  return (
    <div className="searchpage searchpage--landing">
      <SearchBackground svgs={bgSvgs} />
      <div className="searchpage__form">
        {tabs}
        <div className="pattern-list">
          {loading && <div className="pattern-status">Loading patterns…</div>}
          {error && <div className="pattern-status">{error}</div>}
          {!loading && !error && patterns.length === 0 && (
            <div className="pattern-status">No patterns catalogued yet.</div>
          )}
          {patterns.map(p => (
            <PatternRow key={p.patternKey} pattern={p} onClick={() => openPattern(p)} />
          ))}
        </div>
      </div>
    </div>
  )
}
