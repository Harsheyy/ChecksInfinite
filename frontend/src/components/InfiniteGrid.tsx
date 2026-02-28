// frontend/src/components/InfiniteGrid.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { PermutationCard } from './PermutationCard'
import { TreeModal } from './TreeModal'
import type { PermutationResult } from '../useAllPermutations'

const CARD = 160
const GAP  = 12
const STEP = CARD + GAP  // 172 px per cell
const PAD  = 28

interface Props {
  permutations: PermutationResult[]
  ids: string[]
  showFlags: boolean[]
  hasFilters?: boolean
}

export function InfiniteGrid({ permutations, ids, showFlags, hasFilters }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Track previous tile dimensions so we can preserve the user's scroll offset
  // when the grid expands as new pages are loaded.
  const prevTile = useRef({ w: 0, h: 0 })

  // Flatten to visible-only list
  const visible = useMemo(
    () => permutations.filter((_, i) => showFlags[i]),
    [permutations, showFlags]
  )
  const N = visible.length

  // Approximately-square grid: columns ≈ √N
  const cols = N > 0 ? Math.ceil(Math.sqrt(N)) : 1
  const rows = N > 0 ? Math.ceil(N / cols)     : 1

  // Tile dimensions (one full copy of the grid)
  const tileW = PAD * 2 + cols * STEP - GAP
  const tileH = PAD * 2 + rows * STEP - GAP

  // Use looping torus when the tile is large enough for the viewport not to
  // show its edges. N >= 25 produces a 5×5 grid (~904 px) which comfortably
  // exceeds typical viewport heights after subtracting the bars.
  const shouldLoop = N >= 25

  // When tile dimensions change (more items loaded), preserve the user's scroll
  // offset from the center tile origin. On initial load (prevTile = {0,0}) just center.
  // Reset prevTile when N drops to 0 (filter change) so next load re-centers.
  useEffect(() => {
    if (N === 0) { prevTile.current = { w: 0, h: 0 }; return }
    if (!shouldLoop) return
    const c = containerRef.current
    if (!c) return
    const { w: pw, h: ph } = prevTile.current
    const offsetX = pw ? c.scrollLeft - pw : 0
    const offsetY = ph ? c.scrollTop  - ph : 0
    prevTile.current = { w: tileW, h: tileH }
    requestAnimationFrame(() => {
      c.scrollLeft = tileW + offsetX
      c.scrollTop  = tileH + offsetY
    })
  }, [shouldLoop, tileW, tileH, N])

  // Clear selection when permutations are reset
  useEffect(() => { if (N === 0) setSelected(null) }, [N])

  // Torus teleport: when scroll exits center-tile range, jump by one tile
  const handleScroll = useCallback(() => {
    if (!shouldLoop) return
    const c = containerRef.current
    if (!c || !tileW || !tileH) return
    let sx = c.scrollLeft, sy = c.scrollTop, moved = false
    if      (sx <  tileW)      { sx += tileW; moved = true }
    else if (sx >= 2 * tileW)  { sx -= tileW; moved = true }
    if      (sy <  tileH)      { sy += tileH; moved = true }
    else if (sy >= 2 * tileH)  { sy -= tileH; moved = true }
    if (moved) { c.scrollLeft = sx; c.scrollTop = sy }
  }, [shouldLoop, tileW, tileH])

  if (N === 0) return null

  const selectedPerm = selected !== null ? visible[selected] ?? null : null

  // ── Small grid (no looping) ─────────────────────────────────────────────
  if (!shouldLoop) {
    return (
      <>
        <div
          className={`grid-viewport${hasFilters ? ' grid-viewport--with-filters' : ''}`}
          ref={containerRef}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, ${CARD}px)`,
            gap: GAP,
            padding: PAD,
          }}>
            {visible.map((perm, i) => (
              <PermutationCard
                key={perm.def.label + '-' + i}
                result={perm}
                visible={true}
                onClick={() => setSelected(i)}
              />
            ))}
          </div>
        </div>
        {selectedPerm && (
          <TreeModal result={selectedPerm} ids={ids} onClose={() => setSelected(null)} />
        )}
      </>
    )
  }

  // ── Looping torus grid (N >= 25) ────────────────────────────────────────
  // Each card is placed absolutely in 3×3 tile copies so that scrolling in
  // any direction wraps seamlessly. The torus teleport keeps the viewport
  // locked to the center copy at all times.
  const cards: React.ReactNode[] = []
  for (let i = 0; i < N; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx  = PAD + col * STEP
    const cy  = PAD + row * STEP
    for (let tx = 0; tx < 3; tx++) {
      for (let ty = 0; ty < 3; ty++) {
        cards.push(
          <div
            key={`${i}-${tx}-${ty}`}
            style={{
              position: 'absolute',
              left:   tx * tileW + cx,
              top:    ty * tileH + cy,
              width:  CARD,
              height: CARD,
            }}
          >
            <PermutationCard
              result={visible[i]}
              visible={true}
              onClick={() => setSelected(i)}
            />
          </div>
        )
      }
    }
  }

  return (
    <>
      <div
        className={`grid-viewport${hasFilters ? ' grid-viewport--with-filters' : ''}`}
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div style={{ position: 'relative', width: tileW * 3, height: tileH * 3 }}>
          {cards}
        </div>
      </div>
      {selectedPerm && (
        <TreeModal result={selectedPerm} ids={ids} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
