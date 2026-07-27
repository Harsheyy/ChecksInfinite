// frontend/src/components/PatternsBrowse.tsx
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { loadLayoutRecipes, type PatternLayout } from '../usePatternLayouts'
import { InfiniteGrid } from './InfiniteGrid'
import { SearchBackground } from './SearchPage'
import { PatternComposer } from './PatternComposer'
import { PatternPaintGrid, MIN_CELLS_FOR_RESULTS } from './PatternPaintGrid'
import type { PermutationResult } from '../useAllPermutations'
import type { LikeInfo } from './PermutationCard'

interface PatternsBrowseProps {
  tabs: ReactNode
  getLikeInfo?: (result: PermutationResult) => LikeInfo | undefined
  // Reuses SearchPage's own already-fetched background SVGs rather than
  // fetching a second, separate copy — switching into Patterns then shows
  // whatever's already loaded instantly instead of starting from blank.
  bgSvgs: string[]
}

export function PatternsBrowse({ tabs, getLikeInfo, bgSvgs }: PatternsBrowseProps) {
  const [cells, setCells]         = useState<number[]>([])
  const [selected, setSelected]   = useState<PatternLayout | null>(null)
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

  function toggleCell(i: number) {
    setCells(prev => prev.includes(i) ? prev.filter(c => c !== i) : [...prev, i].sort((a, b) => a - b))
  }

  async function openLayout(layout: PatternLayout) {
    setSelected(layout)
    setRecipesLoading(true)
    const r = await loadLayoutRecipes(layout)
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
            {selected.minoritySize}-check minority · {selected.variety === 1 ? '1 color pair' : `${selected.variety} color pairs`} · {selected.totalRecipes} recipe{selected.totalRecipes === 1 ? '' : 's'}
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
            getLikeInfo={getLikeInfo}
          />
        )}
      </>
    )
  }

  // ── Same centered card chrome (background canvas + searchpage__form) the
  // ids/wallet tabs use — the paint grid replaces their input field. Once
  // there are enough cells to search, results grow underneath instead of
  // replacing the panel, so the canvas stays put while you keep adjusting
  // your selection ────────────────────────────────────────────────────────
  const hasResults = cells.length >= MIN_CELLS_FOR_RESULTS
  return (
    <div className="pattern-browse">
      <SearchBackground svgs={bgSvgs} />
      <div className="pattern-browse-panel">
        <div className="searchpage__form">
          {tabs}
          <PatternPaintGrid selected={cells} onToggle={toggleCell} onClear={() => setCells([])} />
        </div>
      </div>
      {hasResults && (
        <div className="pattern-browse-results-below">
          <PatternComposer selected={cells} onSelectLayout={openLayout} />
        </div>
      )}
    </div>
  )
}
