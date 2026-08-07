// apps/works/src/components/PatternComposer.tsx
// Results-only: the paint grid itself lives in PatternPaintGrid, shared
// with the narrow landing-card state in PatternsBrowse. This renders once
// a search is underway (see MIN_CELLS_FOR_RESULTS) — live-narrowed matches
// for the currently selected cells, shown as color-independent (mono)
// layout cards. Clicking one goes straight to every real recipe across
// all of that layout's color variations — no separate "pick a color pair"
// screen in between.
import { usePatternLayouts, type PatternLayout } from '../usePatternLayouts'

const GRID_CELLS = 20

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
        <span className="pattern-card-overlap">{layout.overlap}/{selected.length} match</span>
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
  // search_pattern_layouts does the matching and ranking against the full
  // library — it returns exact matches alone when any exist, otherwise the
  // closest layouts sharing a painted cell.
  const { layouts, loading, error } = usePatternLayouts(selected, true)
  const hasExact = layouts.length > 0 && layouts[0].isExact

  const resultsTitle = (() => {
    if (loading) return 'Searching…'
    if (error) return error
    if (hasExact) return `★ Exact match — this pattern exists (${layouts.length} layout${layouts.length === 1 ? '' : 's'})`
    if (layouts.length === 0) return 'No known layout touches those cells yet'
    return 'No exact match yet — closest layouts sharing your selected cells'
  })()

  const list = layouts

  return (
    <div className="pattern-composer-results">
      <div className="pattern-results-head">
        <span className="filter-count pattern-recipe-count">{resultsTitle}</span>
      </div>
      {list.length > 0 && (
        <p className="pattern-disclaimer">Every layout found so far that touches your selection — hunting is ongoing, so more exist than have been found.</p>
      )}
      {!loading && list.length === 0 && !error && (
        <div className="pattern-status">Nothing found — try a different selection.</div>
      )}
      {list.length > 0 && (
        <div className="pattern-card-grid">
          {list.map(l => (
            <LayoutCard
              key={l.cellsKey}
              layout={l}
              selected={selected}
              isExact={l.isExact}
              onClick={() => onSelectLayout(l)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
