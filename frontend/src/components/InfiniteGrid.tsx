// frontend/src/components/InfiniteGrid.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { PermutationCard } from './PermutationCard'
import { TreePanel } from './TreePanel'
import type { PermutationResult } from '../useAllPermutations'

const CARD     = 160
const GAP      = 12
const STEP     = CARD + GAP   // 172 px — distance between card origins
const MAX_COLS = 50            // cap columns so the grid stays ~50×50
const OVERSCAN = 2             // extra rows/cols to render beyond viewport edges

interface Props {
  permutations: PermutationResult[]
  ids: string[]
  showFlags: boolean[]
  hasFilters?: boolean
  dbMode?: boolean
  hideBuy?: boolean
  filtersTall?: boolean
}

export function InfiniteGrid({ permutations, ids, showFlags, hasFilters, dbMode, hideBuy, filtersTall }: Props) {
  const [selected, setSelected]   = useState<number | null>(null)
  const containerRef               = useRef<HTMLDivElement>(null)
  const [scroll, setScroll]        = useState({ x: 0, y: 0 })
  const rafRef                     = useRef(0)
  const prevTile                   = useRef({ w: 0, h: 0 })

  const visible = useMemo(
    () => permutations.filter((_, i) => showFlags[i]),
    [permutations, showFlags]
  )
  const N = visible.length

  // Fixed-width grid capped at MAX_COLS — gives a ~50×50 layout for 2500 items
  const cols = N > 0 ? Math.min(MAX_COLS, Math.ceil(Math.sqrt(N))) : 1
  const rows = N > 0 ? Math.ceil(N / cols) : 1

  // Seamless tile: distance from last card edge to first card of next tile = GAP
  // tileW = cols * STEP  →  gap between tiles = STEP - CARD = GAP  ✓
  const tileW = cols * STEP
  const tileH = rows * STEP

  const shouldLoop = N >= 25

  // On tile-dimension change, preserve the user's offset from center-tile origin.
  // First load (prevTile = {0,0}) just centers.
  // N → 0 resets so the next load re-centers.
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
      setScroll({ x: tileW + offsetX, y: tileH + offsetY })
    })
  }, [shouldLoop, tileW, tileH, N])

  useEffect(() => { if (N === 0) setSelected(null) }, [N])

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (selected === null) return
    const target = e.target as Element
    if (!target.closest('.perm-card')) setSelected(null)
  }

  // Torus teleport — rAF throttled so it fires at most once per frame
  const handleScroll = useCallback(() => {
    if (!shouldLoop) return
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const c = containerRef.current
      if (!c || !tileW || !tileH) return
      let sx = c.scrollLeft, sy = c.scrollTop, moved = false
      if      (sx <  tileW)      { sx += tileW; moved = true }
      else if (sx >= 2 * tileW)  { sx -= tileW; moved = true }
      if      (sy <  tileH)      { sy += tileH; moved = true }
      else if (sy >= 2 * tileH)  { sy -= tileH; moved = true }
      if (moved) { c.scrollLeft = sx; c.scrollTop = sy }
      setScroll({ x: c.scrollLeft, y: c.scrollTop })
    })
  }, [shouldLoop, tileW, tileH])

  if (N === 0) return null

  const selectedPerm = selected !== null ? visible[selected] ?? null : null

  const viewportClass = `grid-viewport${
    hasFilters
      ? filtersTall
        ? ' grid-viewport--with-filters-tall'
        : ' grid-viewport--with-filters'
      : ''
  }`

  // ── Small grid (N < 25): no looping, plain CSS grid ─────────────────────
  if (!shouldLoop) {
    return (
      <>
        <div
          className={viewportClass}
          ref={containerRef}
          onClick={handleBackdropClick}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, ${CARD}px)`,
            gap: GAP,
            padding: GAP,
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
          <TreePanel result={selectedPerm} ids={ids} onClose={() => setSelected(null)} dbMode={dbMode} hideBuy={hideBuy} />
        )}
      </>
    )
  }

  // ── Looping torus with virtual rendering ─────────────────────────────────
  // Only cards whose absolute position falls within scroll + overscan are
  // mounted.  For a 2500-item 50×50 grid the viewport shows ~11×5 = ~55 cards
  // instead of the 22 500 that full DOM rendering would require.
  const vpW = containerRef.current?.clientWidth  || window.innerWidth
  const vpH = containerRef.current?.clientHeight || window.innerHeight - (hasFilters ? (filtersTall ? 120 : 88) : 48)

  const cards: React.ReactNode[] = []
  for (let tx = 0; tx < 3; tx++) {
    const tileX = tx * tileW
    const c0 = Math.max(0,        Math.floor((scroll.x - OVERSCAN * STEP - tileX) / STEP))
    const c1 = Math.min(cols - 1, Math.floor((scroll.x + vpW + OVERSCAN * STEP - tileX) / STEP))
    if (c0 > c1) continue

    for (let ty = 0; ty < 3; ty++) {
      const tileY = ty * tileH
      const r0 = Math.max(0,        Math.floor((scroll.y - OVERSCAN * STEP - tileY) / STEP))
      const r1 = Math.min(rows - 1, Math.floor((scroll.y + vpH + OVERSCAN * STEP - tileY) / STEP))
      if (r0 > r1) continue

      for (let col = c0; col <= c1; col++) {
        for (let row = r0; row <= r1; row++) {
          const i = row * cols + col
          if (i >= N) continue
          cards.push(
            <div
              key={`${i}-${tx}-${ty}`}
              style={{
                position: 'absolute',
                left:   tileX + col * STEP,
                top:    tileY + row * STEP,
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
  }

  return (
    <>
      <div
        className={`grid-viewport${hasFilters ? ' grid-viewport--with-filters' : ''}`}
        ref={containerRef}
        onScroll={handleScroll}
        onClick={handleBackdropClick}
      >
        <div style={{ position: 'relative', width: tileW * 3, height: tileH * 3 }}>
          {cards}
        </div>
      </div>
      {selectedPerm && (
        <TreePanel result={selectedPerm} ids={ids} onClose={() => setSelected(null)} dbMode={dbMode} hideBuy={hideBuy} />
      )}
    </>
  )
}
