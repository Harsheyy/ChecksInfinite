interface VerdictProps {
  cheapestSinglePrice: number | null
  optimalCombinationCost: number | null
}

/**
 * The answer to the question in the tagline, stated first and in words.
 *
 * Both prices are repeated in full below this, in the two columns they
 * belong to, so this line stays a sentence rather than a scoreboard.
 */
export function Verdict({ cheapestSinglePrice, optimalCombinationCost }: VerdictProps) {
  if (cheapestSinglePrice === null || optimalCombinationCost === null) {
    return (
      <p className="cm-verdict cm-verdict--empty">
        Not enough is listed right now to compare buying against building.
      </p>
    )
  }

  const buyWins = cheapestSinglePrice <= optimalCombinationCost
  const diff = Math.abs(optimalCombinationCost - cheapestSinglePrice)
  const multiplier =
    Math.max(cheapestSinglePrice, optimalCombinationCost) /
    Math.min(cheapestSinglePrice, optimalCombinationCost)

  return (
    <p className="cm-verdict">
      <strong>{buyWins ? 'Buying one outright' : 'Composing one'}</strong> is cheaper right
      now — <strong>{diff.toFixed(3)} ETH</strong> less, a <strong>{multiplier.toFixed(2)}×</strong>{' '}
      gap.
    </p>
  )
}
