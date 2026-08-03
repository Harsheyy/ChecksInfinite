// apps/works/src/components/PatternPaintGrid.tsx
// Pure, controlled 20-cell paint grid — shared between the narrow landing
// card (before a search starts) and the wide composer sidebar (once it has).
const GRID_CELLS = 20
// Matches the actual range every minority cluster found so far falls
// into — searching below 2 would be querying for something that can't
// exist yet anyway.
export const MIN_CELLS_FOR_RESULTS = 2
export const MAX_CELLS_FOR_RESULTS = 10

// The actual Checks badge path (same one checksArtJS.ts renders every real
// check with, natural bounding box ~36x36) — a single path whose second
// subpath is the checkmark tick, cut out of the badge via fill-rule:evenodd
// (see the fill-rule="evenodd" on the <path> below — omit it and the browser
// defaults to nonzero, filling the tick in solid instead of showing it).
const CHECK_PATH = 'M21.36 9.886A3.933 3.933 0 0 0 18 8c-1.423 0-2.67.755-3.36 1.887a3.935 3.935 0 0 0-4.753 4.753A3.933 3.933 0 0 0 8 18c0 1.423.755 2.669 1.886 3.36a3.935 3.935 0 0 0 4.753 4.753 3.933 3.933 0 0 0 4.863 1.59 3.953 3.953 0 0 0 1.858-1.589 3.935 3.935 0 0 0 4.753-4.754A3.933 3.933 0 0 0 28 18a3.933 3.933 0 0 0-1.887-3.36 3.934 3.934 0 0 0-1.042-3.711 3.934 3.934 0 0 0-3.71-1.043Zm-3.958 11.713 4.562-6.844c.566-.846-.751-1.724-1.316-.878l-4.026 6.043-1.371-1.368c-.717-.722-1.836.396-1.116 1.116l2.17 2.15a.788.788 0 0 0 1.097-.22Z'

interface PatternPaintGridProps {
  selected: number[]
  onToggle: (cell: number) => void
  onClear: () => void
}

export function PatternPaintGrid({ selected, onToggle, onClear }: PatternPaintGridProps) {
  const statusText = (() => {
    const n = selected.length
    if (n === 0) return `Select between ${MIN_CELLS_FOR_RESULTS}–${MAX_CELLS_FOR_RESULTS} cells to query pattern results.`
    if (n < MIN_CELLS_FOR_RESULTS) return `${n} cell${n === 1 ? '' : 's'} selected — need at least ${MIN_CELLS_FOR_RESULTS} to search.`
    if (n > MAX_CELLS_FOR_RESULTS) return `${n} cells selected — clusters found so far top out at ${MAX_CELLS_FOR_RESULTS}.`
    return `${n} cells selected.`
  })()

  return (
    <div className="pattern-composer-paint">
      <p className="pattern-status">{statusText}</p>
      <div className="paint-grid">
        {Array.from({ length: GRID_CELLS }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`paint-cell${selected.includes(i) ? ' paint-cell--on' : ''}`}
            aria-label={`cell ${i}`}
            aria-pressed={selected.includes(i)}
            onClick={() => onToggle(i)}
          >
            <svg viewBox="0 0 36 36" className="paint-cell-icon" aria-hidden="true">
              <path d={CHECK_PATH} fill="currentColor" fillRule="evenodd" />
            </svg>
          </button>
        ))}
      </div>
      {selected.length > 0 && (
        <button type="button" className="pattern-clear-btn" onClick={onClear}>Clear</button>
      )}
    </div>
  )
}
