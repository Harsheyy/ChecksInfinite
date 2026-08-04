import { useState } from 'react'
import type { CombinationItem, Collection } from '../useCheckmathSnapshot'

const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const EDITIONS_CONTRACT = '0x34eebee6942d8def3c125458d1a86e0a897fd6f9'

interface OptimalCombinationProps {
  totalCost: number | null
  items: CombinationItem[]
  checksSvgByTokenId: Map<number, string>
  editionsImageByTokenId: Map<number, string>
}

function tierLabel(checksCount: number, collection: Collection): string {
  return collection === 'editions' ? 'Edition' : `${checksCount}-check`
}

function tierKey(checksCount: number, collection: Collection): string {
  return `${checksCount}-${collection}`
}

function openSeaUrl(item: CombinationItem): string {
  const contract = item.collection === 'editions' ? EDITIONS_CONTRACT : CHECKS_CONTRACT
  return `https://opensea.io/assets/ethereum/${contract}/${item.tokenId}`
}

export function OptimalCombination({ totalCost, items, checksSvgByTokenId, editionsImageByTokenId }: OptimalCombinationProps) {
  const [openTier, setOpenTier] = useState<string | null>(null)

  if (totalCost === null) {
    return <p className="checkmath-stat-empty">Not enough listed supply to compute a combination</p>
  }

  const byTier = new Map<string, CombinationItem[]>()
  for (const item of items) {
    const key = tierKey(item.checksCount, item.collection)
    const list = byTier.get(key) ?? []
    list.push(item)
    byTier.set(key, list)
  }
  const tiers = [...byTier.entries()].sort((a, b) => {
    const itemA = a[1][0]
    const itemB = b[1][0]
    if (itemB.checksCount !== itemA.checksCount) return itemB.checksCount - itemA.checksCount
    return itemA.collection.localeCompare(itemB.collection)
  })

  return (
    <>
      <p className="checkmath-stat">{totalCost.toFixed(3)} ETH</p>
      <div className="checkmath-tiers">
        {tiers.map(([key, tierItems]) => {
          const { checksCount, collection } = tierItems[0]
          return (
            <div key={key} className="checkmath-tier">
              <button
                type="button"
                className="checkmath-tier-header"
                onClick={() => setOpenTier(openTier === key ? null : key)}
              >
                <span>{tierLabel(checksCount, collection)}{tierItems.length > 1 ? 's' : ''} × {tierItems.length}</span>
                <span>{openTier === key ? '−' : '+'}</span>
              </button>
              {openTier === key && (
                <div className="checkmath-tier-items">
                  {tierItems.map(item => {
                    const image = item.collection === 'editions'
                      ? editionsImageByTokenId.get(item.tokenId)
                      : checksSvgByTokenId.get(item.tokenId)
                    return (
                      <a
                        key={`${item.collection}-${item.tokenId}`}
                        className="checkmath-tier-item"
                        href={openSeaUrl(item)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {image && (
                          item.collection === 'editions'
                            ? <img className="checkmath-token-image" src={image} alt="" />
                            : <div className="checkmath-token-image" dangerouslySetInnerHTML={{ __html: image }} />
                        )}
                        <div className="checkmath-tier-item-info">
                          <span>#{item.tokenId}</span>
                          <span>{item.ethPrice.toFixed(3)} ETH</span>
                        </div>
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
