import { useState } from 'react'
import type { CombinationItem } from '../useCheckmathSnapshot'

const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'

interface OptimalCombinationProps {
  totalCost: number | null
  items: CombinationItem[]
}

export function OptimalCombination({ totalCost, items }: OptimalCombinationProps) {
  const [openTier, setOpenTier] = useState<number | null>(null)

  const byTier = new Map<number, CombinationItem[]>()
  for (const item of items) {
    const list = byTier.get(item.checksCount) ?? []
    list.push(item)
    byTier.set(item.checksCount, list)
  }
  const tiers = [...byTier.entries()].sort((a, b) => b[0] - a[0])

  return (
    <section className="checkmath-card">
      <h2>Optimal Combination</h2>
      <p className="checkmath-card-desc">Cheapest combination of listed Checks that composites into one single</p>
      {totalCost !== null ? (
        <>
          <p className="checkmath-stat">{totalCost.toFixed(3)} ETH</p>
          <div className="checkmath-tiers">
            {tiers.map(([checksCount, tierItems]) => (
              <div key={checksCount} className="checkmath-tier">
                <button
                  type="button"
                  className="checkmath-tier-header"
                  onClick={() => setOpenTier(openTier === checksCount ? null : checksCount)}
                >
                  <span>{checksCount}-check{tierItems.length > 1 ? 's' : ''} × {tierItems.length}</span>
                  <span>{openTier === checksCount ? '−' : '+'}</span>
                </button>
                {openTier === checksCount && (
                  <div className="checkmath-tier-items">
                    {tierItems.map(item => (
                      <a
                        key={item.tokenId}
                        className="checkmath-tier-item"
                        href={`https://opensea.io/assets/ethereum/${CHECKS_CONTRACT}/${item.tokenId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span>#{item.tokenId}</span>
                        <span>{item.ethPrice.toFixed(3)} ETH</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="checkmath-stat-empty">Not enough listed supply to compute a combination</p>
      )}
    </section>
  )
}
