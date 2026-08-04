import { Footer } from '@checks-wiki/shared'
import { useCheckmathSnapshot, type CombinationItem } from './useCheckmathSnapshot'
import { useTokenImages } from './useTokenImages'
import { CheapestSingle } from './components/CheapestSingle'
import { SweepCalculator } from './components/SweepCalculator'
import { OptimalCombination } from './components/OptimalCombination'
import { BuyVsBuildDelta } from './components/BuyVsBuildDelta'

// Stable reference so `useTokenImages`'s effect deps don't see a "change"
// on every render when there's no snapshot yet (module-scope, not per-render).
const EMPTY_COMBINATION_ITEMS: CombinationItem[] = []

export default function App() {
  const { snapshot, loading, error } = useCheckmathSnapshot()
  const { checksSvgByTokenId, editionsImageByTokenId } = useTokenImages(
    snapshot?.cheapestSingleTokenId ?? null,
    snapshot?.optimalCombinationItems ?? EMPTY_COMBINATION_ITEMS,
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
          <section className="checkmath-compare">
            <h2>Buy vs. Build</h2>
            <div className="checkmath-compare-grid">
              <div className="checkmath-compare-col">
                <h3>Cheapest Single</h3>
                <p className="checkmath-compare-desc">Cheapest checks_count=1 Check currently listed</p>
                <CheapestSingle
                  price={snapshot.cheapestSinglePrice}
                  tokenId={snapshot.cheapestSingleTokenId}
                  svg={snapshot.cheapestSingleTokenId !== null ? checksSvgByTokenId.get(snapshot.cheapestSingleTokenId) : undefined}
                />
              </div>
              <div className="checkmath-compare-col">
                <h3>Optimal Combination</h3>
                <p className="checkmath-compare-desc">
                  Cheapest way to compose one single from smaller pieces (Checks Editions count as an 80-check)
                </p>
                <OptimalCombination
                  totalCost={snapshot.optimalCombinationCost}
                  items={snapshot.optimalCombinationItems}
                  checksSvgByTokenId={checksSvgByTokenId}
                  editionsImageByTokenId={editionsImageByTokenId}
                />
              </div>
            </div>
            <BuyVsBuildDelta
              cheapestSinglePrice={snapshot.cheapestSinglePrice}
              optimalCombinationCost={snapshot.optimalCombinationCost}
            />
          </section>

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
