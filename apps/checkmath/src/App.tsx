import { Footer } from '@checks-wiki/shared'
import { useCheckmathSnapshot, type CombinationItem } from './useCheckmathSnapshot'
import { useTokenImages } from './useTokenImages'
import { Navbar } from './components/Navbar'
import { CheapestSingle } from './components/CheapestSingle'
import { SweepCalculator } from './components/SweepCalculator'
import { OptimalCombination } from './components/OptimalCombination'
import { Verdict } from './components/Verdict'

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
      <Navbar updatedAt={snapshot?.computedAt ?? null} />

      <header className="cm-header">
        <img src="/checks-icon.svg" alt="" className="cm-header-icon" width={40} height={40} />
        <h1>Checkmath</h1>
        <p className="cm-tagline">What's the cheapest way to own a Check?</p>
      </header>

      <main className="cm-main">
        {loading ? (
          <div className="cm-skeleton" role="status" aria-live="polite">
            <span className="sr-only">Loading the latest prices…</span>
            <span className="cm-skeleton-bar cm-skeleton-bar--lead" aria-hidden="true" />
            <span className="cm-skeleton-bar" aria-hidden="true" />
            <span className="cm-skeleton-bar" aria-hidden="true" />
            <span className="cm-skeleton-block" aria-hidden="true" />
          </div>
        ) : error ? (
          <div className="cm-error" role="alert">
            <p className="cm-error-title">Couldn't load the latest prices.</p>
            <p className="cm-error-body">
              The hourly price sync may be behind. Reload in a few minutes — the numbers come from a
              snapshot, so nothing is lost.
            </p>
            <button type="button" className="cm-button" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        ) : snapshot ? (
          <>
            {/* The answer first. Everything below it is the evidence. */}
            <section className="cm-panel cm-panel--verdict" aria-labelledby="verdict-heading">
              <h2 id="verdict-heading">Buy vs. Build</h2>
              <Verdict
                cheapestSinglePrice={snapshot.cheapestSinglePrice}
                optimalCombinationCost={snapshot.optimalCombinationCost}
              />

              <div className="cm-compare">
                <div className="cm-compare-col">
                  <h3>Buy one outright</h3>
                  <p className="cm-compare-desc">The cheapest single Check listed right now.</p>
                  <CheapestSingle
                    price={snapshot.cheapestSinglePrice}
                    tokenId={snapshot.cheapestSingleTokenId}
                    svg={
                      snapshot.cheapestSingleTokenId !== null
                        ? checksSvgByTokenId.get(snapshot.cheapestSingleTokenId)
                        : undefined
                    }
                  />
                </div>

                <div className="cm-compare-col">
                  <h3>Compose one</h3>
                  <p className="cm-compare-desc">
                    The cheapest set of smaller pieces that merges into one single. Open a tier to
                    see the exact tokens.
                  </p>
                  <OptimalCombination
                    totalCost={snapshot.optimalCombinationCost}
                    items={snapshot.optimalCombinationItems}
                    checksSvgByTokenId={checksSvgByTokenId}
                    editionsImageByTokenId={editionsImageByTokenId}
                  />
                </div>
              </div>
            </section>

            <SweepCalculator
              checksSweepCost={snapshot.checksSweepCost}
              checksSweepCount={snapshot.checksSweepCount}
              editionsSweepCost={snapshot.editionsSweepCost}
              editionsSweepCount={snapshot.editionsSweepCount}
              tokenworksSweepCost={snapshot.tokenworksSweepCost}
              tokenworksSweepCount={snapshot.tokenworksSweepCount}
            />
          </>
        ) : null}
      </main>

      <Footer />
    </div>
  )
}
