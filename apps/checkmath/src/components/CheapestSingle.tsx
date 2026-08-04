const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'

interface CheapestSingleProps {
  price: number | null
  tokenId: number | null
}

export function CheapestSingle({ price, tokenId }: CheapestSingleProps) {
  return (
    <section className="checkmath-card">
      <h2>Cheapest Single</h2>
      <p className="checkmath-card-desc">Cheapest checks_count=1 Check currently listed</p>
      {price !== null && tokenId !== null ? (
        <a
          className="checkmath-stat-link"
          href={`https://opensea.io/assets/ethereum/${CHECKS_CONTRACT}/${tokenId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="checkmath-stat">{price.toFixed(3)} ETH</span>
          <span className="checkmath-stat-sub">Check #{tokenId}</span>
        </a>
      ) : (
        <p className="checkmath-stat-empty">No single currently listed</p>
      )}
    </section>
  )
}
