import { useId } from 'react'
import type { HistoryDay } from '../useCheckmathHistory'

interface PriceHistoryProps {
  days: HistoryDay[]
  loading: boolean
  error: string | null
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

type Point = { x: number; y: number }

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function dayNumber(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000
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

function lastDefined(days: HistoryDay[], key: 'buyLow' | 'composeLow'): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][key]
    if (v !== null) return v
  }
  return null
}

export function PriceHistory({ days, loading, error }: PriceHistoryProps) {
  const titleId = useId()

  if (loading || error) return null

  const usable = days.filter(d => d.buyLow !== null || d.composeLow !== null)

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

  // Scales. The y-axis is padded around the data rather than anchored at zero:
  // both paths sit well above zero, and a zero baseline would flatten the
  // crossovers this chart exists to show. The axis is labelled, so the
  // non-zero baseline is visible rather than implied.
  const values = usable
    .flatMap(d => [d.buyLow, d.composeLow, d.saleLow])
    .filter((v): v is number => v !== null)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = (rawMax - rawMin) * 0.08 || Math.max(rawMax * 0.05, 0.001)
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad

  const firstDay = dayNumber(usable[0].day)
  const lastDay = dayNumber(usable[usable.length - 1].day)
  const span = lastDay - firstDay

  const x = (iso: string) =>
    span === 0 ? PAD_L + PLOT_W / 2 : PAD_L + ((dayNumber(iso) - firstDay) / span) * PLOT_W
  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H

  const toPoints = (key: 'buyLow' | 'composeLow'): (Point | null)[] =>
    usable.map(d => (d[key] === null ? null : { x: x(d.day), y: y(d[key] as number) }))

  const buySegments = toSegments(toPoints('buyLow'))
  const composeSegments = toSegments(toPoints('composeLow'))

  const buyLast = lastDefined(usable, 'buyLow')
  const composeLast = lastDefined(usable, 'composeLow')

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
  // Realized sales are plotted at their actual price on the same scale as the
  // Buy line — a sale IS a realized "buy one outright", so the gap between a
  // marker and the line above it is the gap between asking and getting.
  // Composites have no price, so they get a tick on the baseline instead.
  const saleMarks = usable
    .filter(d => d.saleLow !== null)
    .map(d => ({ day: d.day, x: x(d.day), y: y(d.saleLow as number), n: d.sales }))
  const compositeMarks = usable
    .filter(d => d.composites > 0)
    .map(d => ({ day: d.day, x: x(d.day), n: d.composites }))
  const baselineY = PAD_T + PLOT_H

  const totalSales = usable.reduce((n, d) => n + d.sales, 0)
  const totalComposites = usable.reduce((n, d) => n + d.composites, 0)

  const gridValues = [yMax, (yMin + yMax) / 2, yMin]
  const composeCheaperDays = usable.filter(
    d => d.composePremiumLow !== null && d.composePremiumLow < 1,
  ).length

  return (
    <section className="cm-panel" aria-labelledby={`${titleId}-h`}>
      <h2 id={`${titleId}-h`}>Price history</h2>
      <p className="cm-panel-desc">
        The lowest price each path reached on each day, taken from the hourly snapshots — not the
        price at any fixed hour.
      </p>

      <p className="cm-caveat">
        Each point is the lowest figure across that day's hourly snapshots — the best price actually
        available, not a daily average. Anything that appeared and sold between two syncs was never
        recorded, and the same listing caveats apply as in the sweeps below.
      </p>

      {/* Scrollable, and focusable so the scroll works from the keyboard: the
        * chart has a floor width below which the axis labels shrink into
        * illegibility, and narrow screens are under it. */}
      <div className="cm-chart" tabIndex={0} role="group" aria-label="Price history chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="cm-chart-svg"
          role="img"
          aria-labelledby={`${titleId}-desc`}
        >
          <title id={`${titleId}-desc`}>
            Daily lowest prices over {usable.length} days. Buying outright ranges from{' '}
            {Math.min(...usable.map(d => d.buyLow ?? Infinity)).toFixed(3)} to{' '}
            {Math.max(...usable.map(d => d.buyLow ?? -Infinity)).toFixed(3)} ETH. Composing ranges
            from {Math.min(...usable.map(d => d.composeLow ?? Infinity)).toFixed(3)} to{' '}
            {Math.max(...usable.map(d => d.composeLow ?? -Infinity)).toFixed(3)} ETH.{' '}
            {totalSales} single{totalSales === 1 ? '' : 's'} sold and {totalComposites} were
            composed in that window. The full figures follow in a table.
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
            {formatDay(usable[0].day)}
          </text>
          <text x={PAD_L + PLOT_W} y={H - 10} textAnchor="end" className="cm-chart-tick">
            {formatDay(usable[usable.length - 1].day)}
          </text>

          {[
            { segments: composeSegments, color: COMPOSE_COLOR, dash: COMPOSE_DASH },
            { segments: buySegments, color: BUY_COLOR, dash: undefined },
          ].map(({ segments, color, dash }, si) =>
            segments.map((seg, i) => (
              <g key={`${si}-${i}`}>
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
            )),
          )}

          {saleMarks.map(m => (
            <circle
              key={`sale-${m.day}`}
              cx={m.x}
              cy={m.y}
              r={4.5}
              fill="none"
              stroke={BUY_COLOR}
              strokeWidth={1.5}
            />
          ))}

          {compositeMarks.map(m => (
            <path
              key={`comp-${m.day}`}
              d={`M ${m.x - 4} ${baselineY + 9} L ${m.x} ${baselineY + 2} L ${m.x + 4} ${baselineY + 9} Z`}
              fill={COMPOSE_COLOR}
            />
          ))}

          {buyLast !== null && buyLabelY !== null ? (
            <text x={PAD_L + PLOT_W + 12} y={buyLabelY} fill={BUY_COLOR} className="cm-chart-label">
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
            {usable.map(d => (
              <tr key={d.day}>
                <th scope="row">{formatDay(d.day)}</th>
                <td>{d.buyLow !== null ? d.buyLow.toFixed(3) : 'nothing listed'}</td>
                <td>{d.composeLow !== null ? d.composeLow.toFixed(3) : 'not enough supply'}</td>
                <td>{d.sales > 0 ? `${d.sales}, lowest ${(d.saleLow as number).toFixed(3)}` : 'none'}</td>
                <td>{d.composites > 0 ? d.composites : 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="cm-chart-summary">
        {composeCheaperDays === 0
          ? `Composing has not been the cheaper path on any of the last ${usable.length} days.`
          : `Composing was the cheaper path at some point on ${composeCheaperDays} of the last ${usable.length} days.`}{' '}
        {totalSales > 0
          ? `${totalSales} single${totalSales > 1 ? 's' : ''} actually sold in that window`
          : 'No single actually sold in that window'}
        {totalComposites > 0
          ? `, and ${totalComposites} ${totalComposites > 1 ? 'were' : 'was'} composed.`
          : '.'}
      </p>

      <p className="cm-chart-key">
        <span className="cm-key-sale" aria-hidden="true" /> a single sold that day, plotted at
        what it fetched &nbsp;·&nbsp;
        <span className="cm-key-composite" aria-hidden="true" /> one was composed
      </p>
    </section>
  )
}
