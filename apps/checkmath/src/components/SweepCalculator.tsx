interface SweepCalculatorProps {
  checksSweepCost: number | null
  checksSweepCount: number
  editionsSweepCost: number | null
  editionsSweepCount: number
  tokenworksSweepCost: number | null
  tokenworksSweepCount: number
}

const SWEEP_TARGET = 64

interface Row {
  name: string
  cost: number | null
  count: number
}

/**
 * Sweep costs, led by the total — that's the number you'd actually spend.
 *
 * The totals are NOT comparable across collections: one with 32 of 64 listed
 * shows a smaller total than one with 64 of 64 purely because it's a smaller
 * basket. So the per-token price — which is comparable — sits directly
 * underneath each total, and any basket that couldn't be filled says so in
 * --stale amber rather than leaving the reader to infer it from the count.
 */
export function SweepCalculator({
  checksSweepCost,
  checksSweepCount,
  editionsSweepCost,
  editionsSweepCount,
  tokenworksSweepCost,
  tokenworksSweepCount,
}: SweepCalculatorProps) {
  const rows: Row[] = [
    { name: 'Checks VV', cost: checksSweepCost, count: checksSweepCount },
    { name: 'Checks Editions', cost: editionsSweepCost, count: editionsSweepCount },
    { name: 'Token Works', cost: tokenworksSweepCost, count: tokenworksSweepCount },
  ]

  return (
    <section className="cm-panel">
      <h2>Sweep Calculator</h2>
      <p className="cm-panel-desc">
        Total cost of buying up the cheapest listings in each collection, up to {SWEEP_TARGET}{' '}
        tokens. Per-token price sits underneath — it's the figure to compare across collections when
        the baskets are different sizes.
      </p>
      <p className="cm-caveat">
        Estimate only. Checks VV and Editions come from OpenSea listings alone, and Token Works from
        the TokenStrategy contract — listings elsewhere, private sales, and offers aren't counted,
        and prices move between hourly syncs. Treat these as a floor, not a quote.
      </p>

      <ul className="cm-sweeps">
        {rows.map(row => {
          const perToken = row.cost !== null && row.count > 0 ? row.cost / row.count : null
          const partial = row.count < SWEEP_TARGET
          return (
            <li key={row.name} className="cm-sweep">
              <span className="cm-sweep-name">{row.name}</span>
              <span className="cm-sweep-stat">
                {row.cost !== null ? row.cost.toFixed(3) : '—'}
                <span className="cm-sweep-unit"> ETH</span>
              </span>
              <span className="cm-sweep-detail">
                {perToken !== null ? (
                  <>
                    {perToken.toFixed(3)} ETH / token ·{' '}
                    {/* The totals aren't like-for-like when a collection can't
                        fill the basket, so a short basket is called out rather
                        than left for the reader to infer from the count. */}
                    {partial ? (
                      <span className="cm-sweep-partial">
                        only {row.count} of {SWEEP_TARGET} listed
                      </span>
                    ) : (
                      `${row.count} tokens`
                    )}
                  </>
                ) : (
                  'Nothing listed'
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
