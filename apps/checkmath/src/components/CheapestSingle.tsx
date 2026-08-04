const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'

interface CheapestSingleProps {
  price: number | null
  tokenId: number | null
  svg?: string
}

export function CheapestSingle({ price, tokenId, svg }: CheapestSingleProps) {
  if (price === null || tokenId === null) {
    return <p className="checkmath-stat-empty">No single currently listed</p>
  }
  return (
    <a
      className="checkmath-stat-link"
      href={`https://opensea.io/assets/ethereum/${CHECKS_CONTRACT}/${tokenId}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {svg && <div className="checkmath-token-image" dangerouslySetInnerHTML={{ __html: svg }} />}
      <div className="checkmath-stat-text">
        <span className="checkmath-stat">{price.toFixed(3)} ETH</span>
        <span className="checkmath-stat-sub">Check #{tokenId}</span>
      </div>
    </a>
  )
}
