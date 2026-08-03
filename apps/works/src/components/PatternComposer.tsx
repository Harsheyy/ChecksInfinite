// apps/works/src/components/PatternComposer.tsx
// Results-only: the paint grid itself lives in PatternPaintGrid, shared
// with the narrow landing-card state in PatternsBrowse. This renders once
// a search is underway (see MIN_CELLS_FOR_RESULTS) — live-narrowed matches
// for the currently selected cells, shown as color-independent (mono)
// layout cards. Clicking one goes straight to every real recipe across
// all of that layout's color variations — no separate "pick a color pair"
// screen in between.
import { useMemo } from 'react'
import { usePatternLayouts, type PatternLayout } from '../usePatternLayouts'

const GRID_CELLS = 20

function overlapCount(cellsA: number[], cellsB: number[]): number {
  let n = 0
  for (const c of cellsA) if (cellsB.includes(c)) n++
  return n
}

function LayoutSwatch({ cells, highlight }: { cells: number[]; highlight?: number[] }) {
  return (
    <div className="paint-swatch">
      {Array.from({ length: GRID_CELLS }, (_, i) => {
        const isMinority = cells.includes(i)
        const isOverlap = !!highlight?.includes(i)
        return (
          <span
            key={i}
            className={`paint-swatch-cell${isOverlap ? ' paint-swatch-cell--overlap' : ''}`}
            style={{ background: isMinority ? '#f2f2f2' : '#3a3a3a' }}
          />
        )
      })}
    </div>
  )
}

interface LayoutCardProps {
  layout: PatternLayout
  selected: number[]
  isExact: boolean
  onClick: () => void
}

function LayoutCard({ layout, selected, isExact, onClick }: LayoutCardProps) {
  const overlap = overlapCount(layout.cells, selected)
  return (
    <div
      className={`pattern-card${isExact ? ' pattern-card--exact' : ''}`}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      role="button"
      tabIndex={0}
    >
      {isExact ? (
        <span className="pattern-card-badge">★ exact</span>
      ) : (
        <span className="pattern-card-overlap">{overlap}/{selected.length} match</span>
      )}
      <LayoutSwatch cells={layout.cells} highlight={selected} />
      <div className="pattern-card-meta">
        <span>{layout.minoritySize} cells</span>
        <span>{layout.variety === 1 ? '1 color pair' : `${layout.variety} color pairs`}</span>
      </div>
    </div>
  )
}

interface PatternComposerProps {
  selected: number[]
  onSelectLayout: (layout: PatternLayout) => void
}

export function PatternComposer({ selected, onSelectLayout }: PatternComposerProps) {
  const { layouts, loading, error } = usePatternLayouts(true)

  const { exact, related } = useMemo(() => {
    if (layouts.length === 0) return { exact: [] as PatternLayout[], related: [] as PatternLayout[] }
    const exactMatches = layouts.filter(l => l.cells.length === selected.length && overlapCount(l.cells, selected) === selected.length)
    if (exactMatches.length > 0) return { exact: exactMatches, related: [] as PatternLayout[] }
    const relatedMatches = layouts
      .map(l => ({ l, overlap: overlapCount(l.cells, selected) }))
      .filter(r => r.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || (a.l.cells.length - selected.length) - (b.l.cells.length - selected.length))
      .slice(0, 60)
      .map(r => r.l)
    return { exact: [] as PatternLayout[], related: relatedMatches }
  }, [layouts, selected])

  const resultsTitle = (() => {
    if (loading) return 'Searching…'
    if (error) return error
    if (exact.length > 0) return `★ Exact match — this pattern exists (${exact.length} layout${exact.length === 1 ? '' : 's'})`
    if (related.length === 0) return 'No known layout touches those cells yet'
    return 'No exact match yet — closest layouts sharing your selected cells'
  })()

  const list = exact.length > 0 ? exact : related

  return (
    <div className="pattern-composer-results">
      <div className="pattern-results-head">
        <span className="filter-count pattern-recipe-count">{resultsTitle}</span>
      </div>
      {list.length > 0 && (
        <p className="pattern-disclaimer">Showing a small sample of what's possible — not every layout or recipe that exists.</p>
      )}
      {!loading && list.length === 0 && !error && (
        <div className="pattern-status">Nothing found — try a different selection.</div>
      )}
      {list.length > 0 && (
        <div className="pattern-card-grid">
          {list.map((l, i) => (
            <LayoutCard
              key={l.cells.join(',') + i}
              layout={l}
              selected={selected}
              isExact={exact.length > 0}
              onClick={() => onSelectLayout(l)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
