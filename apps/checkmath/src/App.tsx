import { Footer } from '@checks-wiki/shared'
import { useCheckmathSnapshot } from './useCheckmathSnapshot'
import { useTokenImages } from './useTokenImages'
import { CheapestSingle } from './components/CheapestSingle'
import { SweepCalculator } from './components/SweepCalculator'
import { OptimalCombination } from './components/OptimalCombination'

export default function App() {
  const { snapshot, loading, error } = useCheckmathSnapshot()
  const { checksSvgByTokenId, editionsImageByTokenId } = useTokenImages(
    snapshot?.cheapestSingleTokenId ?? null,
    snapshot?.optimalCombinationItems ?? [],
  )

  return (
    <div className="checkmath">
      <header className="checkmath-header">
        <img src="/checks-icon.svg" alt="" className="checkmath-icon" />
        <h1>Checkmath</h1>
        <p className="checkmath-tagline">What's the cheapest way to own a Check?</p>
        {snapshot && (
          <p className="checkmath-updated">Updated {new Date(snapshot.computedAt).toLocaleString()}</p>
        )}
      </header>

      {loading ? (
        <p className="checkmath-stat-empty">Loading…</p>
      ) : error ? (
        <p className="checkmath-stat-empty">{error}</p>
      ) : snapshot ? (
        <div className="checkmath-cards">
          <CheapestSingle
            price={snapshot.cheapestSinglePrice}
            tokenId={snapshot.cheapestSingleTokenId}
            svg={snapshot.cheapestSingleTokenId !== null ? checksSvgByTokenId.get(snapshot.cheapestSingleTokenId) : undefined}
          />
          <OptimalCombination
            totalCost={snapshot.optimalCombinationCost}
            items={snapshot.optimalCombinationItems}
            checksSvgByTokenId={checksSvgByTokenId}
            editionsImageByTokenId={editionsImageByTokenId}
          />
          <SweepCalculator
            checksSweepCost={snapshot.checksSweepCost}
            checksSweepCount={snapshot.checksSweepCount}
            editionsSweepCost={snapshot.editionsSweepCost}
            editionsSweepCount={snapshot.editionsSweepCount}
          />
        </div>
      ) : null}

      <Footer />
    </div>
  )
}
