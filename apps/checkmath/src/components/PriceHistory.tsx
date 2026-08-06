import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { HistoryDay } from '../useCheckmathHistory'

interface PriceHistoryProps {
  days: HistoryDay[]
  loading: boolean
  error: string | null
  /** Latest snapshot, for the live "now" point. Null while it's still loading. */
  current: {
    computedAt: string
    cheapestSinglePrice: number | null
    optimalCombinationCost: number | null
  } | null
}

/** Days of history required before a line is worth drawing at all. */
const MIN_DAYS = 3

/* Chart geometry, in viewBox units. The SVG scales with the panel, so these
 * are ratios as much as pixels — at the panel's natural width they land
 * roughly 1:1 with CSS pixels. */
const W = 760
const H = 260
const PAD_L = 62 // y-axis labels
const PAD_R = 112 // inline end labels, so the chart needs no legend
const PAD_T = 22
const PAD_B = 34
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

/* The two paths are told apart twice over — by tone and by dash — because
 * they cross, and at the crossing a tone difference alone is not enough to
 * trace which line is which. Double-encoding also means the chart survives
 * being read without color. */
const BUY_COLOR = '#eeeeee'
const COMPOSE_COLOR = '#a8a8a8'
const COMPOSE_DASH = '6 4'

/* The live point is a different kind of number from the rest of the line — the
 * current price rather than the day's low — so it is marked provisional. Dash
 * can't carry that meaning, because the compose line is already dashed for
 * identity; a hollow marker plus a faded leg carries it on both series. */
const PROVISIONAL_OPACITY = 0.45

type Point = { x: number; y: number }

/** One x-position on the chart: a finished day, or the live "now" column. */
interface Column {
  /** UTC `YYYY-MM-DD`. The live column carries today's date. */
  day: string
  buy: number | null
  compose: number | null
  /** Best compose:buy ratio; below 1 means composing won. */
  premium: number | null
  sale: number | null
  sales: number
  composites: number
  /** True for the live column: current price, not the day's low. */
  provisional: boolean
  /** Live column only — the running low so far today, if today has a row yet. */
  lowSoFarBuy?: number | null
  lowSoFarCompose?: number | null
  /** Live column only — when the snapshot behind it was computed. */
  computedAt?: string
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function dayNumber(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function eth(v: number): string {
  return `${v.toFixed(3)} ETH`
}

/** Split into runs of consecutive plottable points so gaps stay gaps. */
function toSegments(points: (Point | null)[]): Point[][] {
  const segments: Point[][] = []
  let current: Point[] = []
  for (const p of points) {
    if (p) {
      current.push(p)
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

/** "18% dearer" / "4% cheaper" — the gap between the two paths, as a phrase. */
function premiumPhrase(ratio: number, tense: 'was' | 'is'): string {
  const pct = Math.abs(ratio - 1) * 100
  const rounded = pct < 1 ? pct.toFixed(1) : pct.toFixed(0)
  return ratio < 1
    ? `Composing ${tense} ${rounded}% cheaper`
    : `Composing ${tense} ${rounded}% dearer`
}

export function PriceHistory({ days, loading, error, current }: PriceHistoryProps) {
  const titleId = useId()

  // Hover follows the mouse; a pointerdown pins, so touch and keyboard reach
  // the same tooltip. Pinned wins, so a tap doesn't get overwritten by the
  // synthetic mousemove some browsers fire after it.
  const [hover, setHover] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  // Dismiss a pinned tooltip by pointing anywhere else on the page.
  useEffect(() => {
    if (pinned === null) return
    function onDocDown(e: PointerEvent) {
      if (!innerRef.current?.contains(e.target as Node)) setPinned(null)
    }
    document.addEventListener('pointerdown', onDocDown)
    return () => document.removeEventListener('pointerdown', onDocDown)
  }, [pinned])

  const usable = days.filter(d => d.buyLow !== null || d.composeLow !== null)

  // Hooks must run unconditionally, so the column lookup is defined before the
  // early returns below and closes over whatever `columns` ends up being.
  const columnsRef = useRef<Column[]>([])

  const columnAt = useCallback((clientX: number): number | null => {
    const cols = columnsRef.current
    const el = innerRef.current
    if (!el || cols.length === 0) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return null
    // viewBox units: the SVG is width:100% with a fixed viewBox, so one scale
    // factor converts the whole axis.
    const vx = ((clientX - rect.left) / rect.width) * W
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < cols.length; i++) {
      const d = Math.abs(colX(i, cols) - vx)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }, [])

  if (loading || error) return null

  if (usable.length < MIN_DAYS) {
    return (
      <section className="cm-panel" aria-labelledby={`${titleId}-h`}>
        <h2 id={`${titleId}-h`}>Price history</h2>
        <p className="cm-panel-desc">
          The daily low for each path, from the hourly snapshots. Collecting now —{' '}
          {usable.length === 0
            ? 'no full day yet'
            : `${usable.length} day${usable.length > 1 ? 's' : ''} so far`}
          , and the chart appears at {MIN_DAYS}.
        </p>
      </section>
    )
  }

  // ── Columns ────────────────────────────────────────────────────────────────
  // Today is represented by the live price rather than by its daily row: the
  // rightmost point answers "what does it cost right now". Today's running low
  // is not dropped — it moves into the tooltip, where it can't be mistaken for
  // a settled figure.
  const today = utcToday()
  const todayRow = usable.find(d => d.day === today) ?? null
  const hasLive =
    current !== null &&
    (current.cheapestSinglePrice !== null || current.optimalCombinationCost !== null)

  const finished = usable.filter(d => d.day !== today)

  const columns: Column[] = finished.map(d => ({
    day: d.day,
    buy: d.buyLow,
    compose: d.composeLow,
    premium: d.composePremiumLow,
    sale: d.saleLow,
    sales: d.sales,
    composites: d.composites,
    provisional: false,
  }))

  if (hasLive && current) {
    columns.push({
      day: today,
      buy: current.cheapestSinglePrice,
      compose: current.optimalCombinationCost,
      premium:
        current.cheapestSinglePrice && current.optimalCombinationCost
          ? current.optimalCombinationCost / current.cheapestSinglePrice
          : null,
      sale: todayRow?.saleLow ?? null,
      sales: todayRow?.sales ?? 0,
      composites: todayRow?.composites ?? 0,
      provisional: true,
      lowSoFarBuy: todayRow?.buyLow ?? null,
      lowSoFarCompose: todayRow?.composeLow ?? null,
      computedAt: current.computedAt,
    })
  } else if (todayRow) {
    // No live snapshot to draw — fall back to today's daily row so the chart
    // doesn't silently lose a day.
    columns.push({
      day: todayRow.day,
      buy: todayRow.buyLow,
      compose: todayRow.composeLow,
      premium: todayRow.composePremiumLow,
      sale: todayRow.saleLow,
      sales: todayRow.sales,
      composites: todayRow.composites,
      provisional: false,
    })
  }

  columnsRef.current = columns

  // ── Scales ─────────────────────────────────────────────────────────────────
  // The y-axis is padded around the data rather than anchored at zero: both
  // paths sit well above zero, and a zero baseline would flatten the crossovers
  // this chart exists to show. The axis is labelled, so the non-zero baseline is
  // visible rather than implied.
  const values = columns
    .flatMap(c => [c.buy, c.compose, c.sale])
    .filter((v): v is number => v !== null)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = (rawMax - rawMin) * 0.08 || Math.max(rawMax * 0.05, 0.001)
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad

  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H

  const lastIdx = columns.length - 1
  const provisionalIdx = columns[lastIdx]?.provisional ? lastIdx : -1

  const toPoints = (key: 'buy' | 'compose'): (Point | null)[] =>
    columns.map((c, i) => (c[key] === null ? null : { x: colX(i, columns), y: y(c[key] as number) }))

  const buyPoints = toPoints('buy')
  const composePoints = toPoints('compose')

  // The provisional column is drawn separately, so the solid line stops before
  // it and the faded leg picks it up.
  const solid = (pts: (Point | null)[]) =>
    toSegments(provisionalIdx >= 0 ? pts.slice(0, provisionalIdx) : pts)

  const provisionalLeg = (pts: (Point | null)[]): { from: Point; to: Point } | null => {
    if (provisionalIdx < 0) return null
    const to = pts[provisionalIdx]
    if (!to) return null
    for (let i = provisionalIdx - 1; i >= 0; i--) {
      const from = pts[i]
      if (from) return { from, to }
    }
    return null
  }

  const lastValue = (key: 'buy' | 'compose'): number | null => {
    for (let i = columns.length - 1; i >= 0; i--) {
      const v = columns[i][key]
      if (v !== null) return v
    }
    return null
  }

  const buyLast = lastValue('buy')
  const composeLast = lastValue('compose')

  // Keep the two end labels from colliding when the paths finish close together.
  let buyLabelY = buyLast !== null ? y(buyLast) : null
  let composeLabelY = composeLast !== null ? y(composeLast) : null
  if (buyLabelY !== null && composeLabelY !== null && Math.abs(buyLabelY - composeLabelY) < 28) {
    const mid = (buyLabelY + composeLabelY) / 2
    const higher = buyLabelY <= composeLabelY
    buyLabelY = higher ? mid - 14 : mid + 14
    composeLabelY = higher ? mid + 14 : mid - 14
  }

  // One decimal place for every tick, chosen from the range rather than
  // per-value, so the axis doesn't mix "27.3" with "5.28".
  const tickDp = yMax >= 10 ? 1 : 3
  const baselineY = PAD_T + PLOT_H

  // Realized sales are plotted at their actual price on the same scale as the
  // Buy line — a sale IS a realized "buy one outright", so the gap between a
  // marker and the line above it is the gap between asking and getting.
  // Composites have no price, so they get a tick on the baseline instead.
  const saleMarks = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.sale !== null)
    .map(({ c, i }) => ({ day: c.day, x: colX(i, columns), y: y(c.sale as number) }))
  const compositeMarks = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.composites > 0)
    .map(({ c, i }) => ({ day: c.day, x: colX(i, columns) }))

  const totalSales = columns.reduce((n, c) => n + c.sales, 0)
  const totalComposites = columns.reduce((n, c) => n + c.composites, 0)
  const gridValues = [yMax, (yMin + yMax) / 2, yMin]
  const composeCheaperDays = columns.filter(c => c.premium !== null && c.premium < 1).length

  const active = pinned ?? hover
  const activeCol = active !== null ? (columns[active] ?? null) : null

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setPinned(null)
      return
    }
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const base = pinned ?? (step > 0 ? -1 : columns.length)
    setPinned(Math.min(columns.length - 1, Math.max(0, base + step)))
  }

  return (
    <section className="cm-panel" aria-labelledby={`${titleId}-h`}>
      <h2 id={`${titleId}-h`}>Price history</h2>

      <p className="cm-chart-verdict">
        {composeCheaperDays === 0
          ? `Composing has not been the cheaper path on any of the last ${columns.length} days.`
          : `Composing was the cheaper path at some point on ${composeCheaperDays} of the last ${columns.length} days.`}
      </p>

      {/* Scrollable, and focusable so the scroll — and the day cursor — work
        * from the keyboard: the chart has a floor width below which the axis
        * labels shrink into illegibility, and narrow screens are under it. */}
      <div
        className="cm-chart"
        tabIndex={0}
        role="group"
        aria-label="Price history chart. Use the left and right arrow keys to step through days."
        onKeyDown={onKeyDown}
        onBlur={() => setPinned(null)}
      >
        <div
          className="cm-chart-inner"
          ref={innerRef}
          onPointerMove={e => {
            if (e.pointerType === 'mouse') setHover(columnAt(e.clientX))
          }}
          onPointerLeave={() => setHover(null)}
          onPointerDown={e => {
            const idx = columnAt(e.clientX)
            setPinned(prev => (prev === idx ? null : idx))
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="cm-chart-svg"
            role="img"
            aria-labelledby={`${titleId}-desc`}
          >
            <title id={`${titleId}-desc`}>
              Daily lowest prices over {columns.length} days. Buying outright ranges from{' '}
              {Math.min(...columns.map(c => c.buy ?? Infinity)).toFixed(3)} to{' '}
              {Math.max(...columns.map(c => c.buy ?? -Infinity)).toFixed(3)} ETH. Composing ranges
              from {Math.min(...columns.map(c => c.compose ?? Infinity)).toFixed(3)} to{' '}
              {Math.max(...columns.map(c => c.compose ?? -Infinity)).toFixed(3)} ETH. {totalSales}{' '}
              single{totalSales === 1 ? '' : 's'} sold and {totalComposites} were composed in that
              window. The full figures follow in a table.
            </title>

            {gridValues.map((v, i) => (
              <g key={i}>
                <line
                  x1={PAD_L}
                  x2={PAD_L + PLOT_W}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 10}
                  y={y(v)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="cm-chart-tick"
                >
                  {v.toFixed(tickDp)}
                </text>
              </g>
            ))}

            <text x={PAD_L} y={H - 10} textAnchor="start" className="cm-chart-tick">
              {formatDay(columns[0].day)}
            </text>
            <text x={PAD_L + PLOT_W} y={H - 10} textAnchor="end" className="cm-chart-tick">
              {provisionalIdx >= 0 ? 'now' : formatDay(columns[lastIdx].day)}
            </text>

            {/* Crosshair sits under the marks so it never obscures them. */}
            {activeCol ? (
              <line
                x1={colX(active as number, columns)}
                x2={colX(active as number, columns)}
                y1={PAD_T}
                y2={baselineY}
                stroke="var(--border-interactive)"
                strokeWidth={1}
              />
            ) : null}

            {[
              { points: composePoints, color: COMPOSE_COLOR, dash: COMPOSE_DASH },
              { points: buyPoints, color: BUY_COLOR, dash: undefined },
            ].map(({ points, color, dash }, si) => {
              const leg = provisionalLeg(points)
              const tip = provisionalIdx >= 0 ? points[provisionalIdx] : null
              return (
                <g key={si}>
                  {solid(points).map((seg, i) => (
                    <g key={i}>
                      <polyline
                        points={seg.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray={dash}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {seg.map((p, j) => (
                        <circle key={j} cx={p.x} cy={p.y} r={2.5} fill={color} />
                      ))}
                    </g>
                  ))}

                  {leg ? (
                    <line
                      x1={leg.from.x}
                      y1={leg.from.y}
                      x2={leg.to.x}
                      y2={leg.to.y}
                      stroke={color}
                      strokeWidth={1.5}
                      strokeDasharray={dash}
                      strokeLinecap="round"
                      opacity={PROVISIONAL_OPACITY}
                    />
                  ) : null}

                  {tip ? (
                    <circle
                      cx={tip.x}
                      cy={tip.y}
                      r={3.5}
                      fill="var(--bg)"
                      stroke={color}
                      strokeWidth={1.5}
                    />
                  ) : null}
                </g>
              )
            })}

            {saleMarks.map((m, i) => (
              <g key={`sale-${m.day}`}>
                <circle cx={m.x} cy={m.y} r={4.5} fill="none" stroke={BUY_COLOR} strokeWidth={1.5} />
                {/* Labelled in place rather than in a written key below the
                  * chart. Sales are rare, so only the first is labelled — a
                  * repeat on every mark would be noise, not orientation. */}
                {i === 0 ? (
                  <text x={m.x + 8} y={m.y - 5} className="cm-chart-mark-label" fill={BUY_COLOR}>
                    sold
                  </text>
                ) : null}
              </g>
            ))}

            {compositeMarks.map((m, i) => (
              <g key={`comp-${m.day}`}>
                <path
                  d={`M ${m.x - 4} ${baselineY + 9} L ${m.x} ${baselineY + 2} L ${m.x + 4} ${baselineY + 9} Z`}
                  fill={COMPOSE_COLOR}
                />
                {i === 0 ? (
                  <text
                    x={m.x + 8}
                    y={baselineY + 9}
                    className="cm-chart-mark-label"
                    fill={COMPOSE_COLOR}
                  >
                    composed
                  </text>
                ) : null}
              </g>
            ))}

            {/* Emphasise the hovered day's points, so the crosshair reads as
              * attached to the lines rather than floating over them. */}
            {activeCol && active !== null
              ? (
                  [
                    { v: activeCol.buy, color: BUY_COLOR },
                    { v: activeCol.compose, color: COMPOSE_COLOR },
                  ] as const
                ).map(({ v, color }, i) =>
                  v === null ? null : (
                    <circle
                      key={i}
                      cx={colX(active, columns)}
                      cy={y(v)}
                      r={4}
                      fill={color}
                      stroke="var(--bg)"
                      strokeWidth={1}
                    />
                  ),
                )
              : null}

            {buyLast !== null && buyLabelY !== null ? (
              <text
                x={PAD_L + PLOT_W + 12}
                y={buyLabelY}
                fill={BUY_COLOR}
                className="cm-chart-label"
              >
                <tspan x={PAD_L + PLOT_W + 12} dy="-2">
                  Buy outright
                </tspan>
                <tspan x={PAD_L + PLOT_W + 12} dy="14">
                  {buyLast.toFixed(3)} ETH
                </tspan>
              </text>
            ) : null}

            {composeLast !== null && composeLabelY !== null ? (
              <text
                x={PAD_L + PLOT_W + 12}
                y={composeLabelY}
                fill={COMPOSE_COLOR}
                className="cm-chart-label"
              >
                <tspan x={PAD_L + PLOT_W + 12} dy="-2">
                  Compose
                </tspan>
                <tspan x={PAD_L + PLOT_W + 12} dy="14">
                  {composeLast.toFixed(3)} ETH
                </tspan>
              </text>
            ) : null}
          </svg>

          {/* HTML rather than SVG <text>: it wraps, inherits the page's type
            * tokens, and needs no manual text measurement. */}
          {activeCol && active !== null ? (
            <div
              className="cm-chart-tip"
              role="status"
              style={{
                // Percent, so it tracks the SVG's scale without a resize
                // observer. Clamped so the tip stays inside the plot at the
                // extremes rather than clipping.
                left: `${Math.min(84, Math.max(16, (colX(active, columns) / W) * 100))}%`,
              }}
            >
              <p className="cm-tip-day">
                {activeCol.provisional
                  ? `Now · ${activeCol.computedAt ? formatTime(activeCol.computedAt) : ''} UTC`
                  : formatDay(activeCol.day)}
              </p>
              <p className="cm-tip-row">
                <span>Buy outright</span>
                <span>{activeCol.buy !== null ? eth(activeCol.buy) : 'nothing listed'}</span>
              </p>
              <p className="cm-tip-row">
                <span>Compose</span>
                <span>
                  {activeCol.compose !== null ? eth(activeCol.compose) : 'not enough supply'}
                </span>
              </p>
              {activeCol.premium !== null ? (
                <p className="cm-tip-note">
                  {premiumPhrase(activeCol.premium, activeCol.provisional ? 'is' : 'was')}
                  {activeCol.provisional ? ' right now' : ' at best'}.
                </p>
              ) : null}
              {activeCol.provisional && activeCol.lowSoFarBuy != null ? (
                <p className="cm-tip-note">Low so far today: {eth(activeCol.lowSoFarBuy)}.</p>
              ) : null}
              {activeCol.sale !== null ? (
                <p className="cm-tip-event">
                  {activeCol.sales > 1
                    ? `${activeCol.sales} singles sold, lowest ${eth(activeCol.sale)}`
                    : `A single sold for ${eth(activeCol.sale)}`}
                </p>
              ) : null}
              {activeCol.composites > 0 ? (
                <p className="cm-tip-event">
                  {activeCol.composites} {activeCol.composites > 1 ? 'were' : 'was'} composed
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* The same numbers, reachable by screen reader and by anyone who wants
         * to read rather than eyeball them. */}
        <table className="sr-only">
          <caption>Daily lowest price by path, in ETH</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Buy outright</th>
              <th scope="col">Compose</th>
              <th scope="col">Singles sold</th>
              <th scope="col">Singles composed</th>
            </tr>
          </thead>
          <tbody>
            {columns.map(c => (
              <tr key={c.day}>
                <th scope="row">
                  {c.provisional ? `Now (${formatDay(c.day)}, current price)` : formatDay(c.day)}
                </th>
                <td>{c.buy !== null ? c.buy.toFixed(3) : 'nothing listed'}</td>
                <td>{c.compose !== null ? c.compose.toFixed(3) : 'not enough supply'}</td>
                <td>{c.sales > 0 ? `${c.sales}, lowest ${(c.sale as number).toFixed(3)}` : 'none'}</td>
                <td>{c.composites > 0 ? c.composites : 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="cm-chart-method">
        <summary>How this is measured</summary>
        <p>
          Each point is the lowest figure across that day's hourly snapshots — the best price
          actually available, not a daily average. The rightmost point is different: it is the
          current price as of the last sync, drawn hollow because it can still move in either
          direction before the day closes.
        </p>
        <p>
          Anything that appeared and sold between two syncs was never recorded, and the same
          listing caveats apply as in the sweeps below.{' '}
          {totalSales > 0
            ? `${totalSales} single${totalSales > 1 ? 's' : ''} actually sold in this window`
            : 'No single actually sold in this window'}
          {totalComposites > 0
            ? `, and ${totalComposites} ${totalComposites > 1 ? 'were' : 'was'} composed.`
            : '.'}
        </p>
      </details>
    </section>
  )
}

/** x for column `i`. Spaced by real date, so a missing day leaves a real gap. */
function colX(i: number, cols: Column[]): number {
  if (cols.length <= 1) return PAD_L + PLOT_W / 2
  const first = dayNumber(cols[0].day)
  const span = dayNumber(cols[cols.length - 1].day) - first
  if (span === 0) return PAD_L + (i / (cols.length - 1)) * PLOT_W
  return PAD_L + ((dayNumber(cols[i].day) - first) / span) * PLOT_W
}
