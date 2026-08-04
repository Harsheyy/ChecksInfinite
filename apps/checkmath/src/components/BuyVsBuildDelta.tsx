interface BuyVsBuildDeltaProps {
  cheapestSinglePrice: number | null
  optimalCombinationCost: number | null
}

export function BuyVsBuildDelta({ cheapestSinglePrice, optimalCombinationCost }: BuyVsBuildDeltaProps) {
  if (cheapestSinglePrice === null || optimalCombinationCost === null) return null

  const buyIsCheaper = cheapestSinglePrice <= optimalCombinationCost
  const lower = Math.min(cheapestSinglePrice, optimalCombinationCost)
  const higher = Math.max(cheapestSinglePrice, optimalCombinationCost)
  const diff = higher - lower
  const multiplier = higher / lower

  return (
    <p className="checkmath-compare-delta">
      {buyIsCheaper ? 'Buying outright' : 'Building from parts'} is cheaper right now —{' '}
      <strong>{multiplier.toFixed(2)}×</strong>, saving <strong>{diff.toFixed(3)} ETH</strong>.
    </p>
  )
}
