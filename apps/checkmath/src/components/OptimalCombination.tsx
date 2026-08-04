import { useId, useState } from 'react'
import type { CombinationItem } from '../useCheckmathSnapshot'
import { groupIntoTiers, openSeaUrl, tierCountLabel, tierLabel } from '../tiers'

interface OptimalCombinationProps {
  totalCost: number | null
  items: CombinationItem[]
  checksSvgByTokenId: Map<number, string>
  editionsImageByTokenId: Map<number, string>
}

export function OptimalCombination({
  totalCost,
  items,
  checksSvgByTokenId,
  editionsImageByTokenId,
}: OptimalCombinationProps) {
  // Multi-open: comparing two tiers side by side is the whole reason to open
  // one, so opening a second no longer closes the first.
  const [openTiers, setOpenTiers] = useState<ReadonlySet<string>>(() => new Set())
  const panelIdBase = useId()

  if (totalCost === null) {
    return <p className="cm-empty">Not enough is listed to compose a single right now.</p>
  }

  const tiers = groupIntoTiers(items)

  function toggleTier(key: string) {
    setOpenTiers(prev => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  return (
    <div className="cm-combination">
      <p className="cm-combination-total">{totalCost.toFixed(3)} ETH</p>
      <p className="cm-combination-sub">
        {items.length} tokens across {tiers.length} tiers
      </p>

      <div className="cm-tiers">
        {tiers.map(tier => {
          const isOpen = openTiers.has(tier.key)
          const panelId = `${panelIdBase}-${tier.key}`

          return (
            <div key={tier.key} className="cm-tier">
              <h4 className="cm-tier-heading">
                <button
                  type="button"
                  className="cm-tier-header"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleTier(tier.key)}
                >
                  <span className="cm-tier-name">
                    {tierCountLabel(tier.checksCount, tier.collection, tier.items.length)}
                  </span>
                  <span className="cm-tier-subtotal">{tier.subtotal.toFixed(3)} ETH</span>
                  <span className="cm-tier-chevron" aria-hidden="true" />
                </button>
              </h4>

              <div id={panelId} className="cm-tier-panel" hidden={!isOpen}>
                <ul className="cm-tier-items">
                  {tier.items.map(item => {
                    const image =
                      item.collection === 'editions'
                        ? editionsImageByTokenId.get(item.tokenId)
                        : checksSvgByTokenId.get(item.tokenId)
                    return (
                      <li key={`${item.collection}-${item.tokenId}`}>
                        <a
                          className="cm-tier-item"
                          href={openSeaUrl(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${tierLabel(item.checksCount, item.collection)} #${item.tokenId}, ${item.ethPrice.toFixed(3)} ETH — view on OpenSea (opens in a new tab)`}
                        >
                          {image ? (
                            item.collection === 'editions' ? (
                              <img
                                className="cm-token-image"
                                src={image}
                                alt=""
                                width={40}
                                height={40}
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <span
                                className="cm-token-image"
                                dangerouslySetInnerHTML={{ __html: image }}
                              />
                            )
                          ) : (
                            <span className="cm-token-image" aria-hidden="true" />
                          )}
                          <span className="cm-tier-item-id">#{item.tokenId}</span>
                          <span className="cm-tier-item-price">{item.ethPrice.toFixed(3)} ETH</span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
