import { openSeaUrl } from '../tiers'

interface CheapestSingleProps {
  price: number | null
  tokenId: number | null
  svg?: string
}

export function CheapestSingle({ price, tokenId, svg }: CheapestSingleProps) {
  if (price === null || tokenId === null) {
    return <p className="cm-empty">No single is listed right now.</p>
  }

  return (
    <a
      className="cm-single"
      href={openSeaUrl({ tokenId, collection: 'checks-vv' })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Check #${tokenId}, ${price.toFixed(3)} ETH — view on OpenSea (opens in a new tab)`}
    >
      {/* Price first, so it lands on the same line as the composition total in
       * the column beside it and the two figures can be read against each
       * other without scanning down. */}
      <span className="cm-single-meta">
        <span className="cm-single-price">{price.toFixed(3)} ETH</span>
        <span className="cm-single-id">Check #{tokenId}</span>
      </span>
      <span className="cm-single-image">
        {svg ? <span dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      </span>
    </a>
  )
}
