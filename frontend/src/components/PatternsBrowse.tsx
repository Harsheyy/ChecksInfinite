// frontend/src/components/PatternsBrowse.tsx
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { useAccount } from 'wagmi'
import { loadLayoutRecipes, type PatternLayout } from '../usePatternLayouts'
import { InfiniteGrid } from './InfiniteGrid'
import { SearchBackground } from './SearchPage'
import { PatternComposer } from './PatternComposer'
import { PatternPaintGrid, MIN_CELLS_FOR_RESULTS } from './PatternPaintGrid'
import type { PermutationResult } from '../useAllPermutations'
import type { LikeInfo } from './PermutationCard'
import { useSiweSession } from '../useSiweSession'
import { chargeCredits } from '../chargeCredits'
import { useCreditBalance } from '../useCreditBalance'
import { usePricing } from '../usePricing'
import { FundingPrompt } from './FundingPrompt'

interface PatternsBrowseProps {
  tabs: ReactNode
  getLikeInfo?: (result: PermutationResult) => LikeInfo | undefined
  // Reuses SearchPage's own already-fetched background SVGs rather than
  // fetching a second, separate copy — switching into Patterns then shows
  // whatever's already loaded instantly instead of starting from blank.
  bgSvgs: string[]
}

export function PatternsBrowse({ tabs, getLikeInfo, bgSvgs }: PatternsBrowseProps) {
  const [cells, setCells]         = useState<number[]>([])
  const [selected, setSelected]   = useState<PatternLayout | null>(null)
  const [recipes, setRecipes]     = useState<PermutationResult[]>([])
  const [recipesLoading, setRecipesLoading] = useState(false)

  const { address, isConnected } = useAccount()
  const siwe = useSiweSession()
  const credits = useCreditBalance(isConnected ? address : undefined)
  const { prices } = usePricing()
  const [fundingPrompt, setFundingPrompt] = useState<{ actionType: 'recipe_view'; priceCredits: number } | null>(null)
  const [chargeError, setChargeError] = useState('')

  // Mirrors SearchPage's own gridTop measurement so InfiniteGrid sits flush
  // under the fixed detail bar, exactly like the ids/wallet results view.
  const fixedBarRef = useRef<HTMLDivElement>(null)
  const [gridTop, setGridTop] = useState(88)
  useEffect(() => {
    if (!selected || !fixedBarRef.current) return
    setGridTop(Math.round(fixedBarRef.current.getBoundingClientRect().bottom))
  }, [selected])

  function toggleCell(i: number) {
    setCells(prev => prev.includes(i) ? prev.filter(c => c !== i) : [...prev, i].sort((a, b) => a - b))
  }

  // openingRef is a synchronous re-entrancy guard (same pattern as
  // App.tsx's chargingRef / SearchPage.tsx's submittingRef): a rapid
  // double-click on a layout card fires two concurrent openLayout calls
  // before either awaited call resolves, which would otherwise trigger two
  // separate recipe_view charges for what the user experienced as one
  // click. A ref (not state) is required since it must block the second
  // call synchronously, within the same tick, before any await yields.
  const openingRef = useRef(false)
  async function openLayout(layout: PatternLayout) {
    if (openingRef.current) return
    openingRef.current = true
    try {
      setChargeError('')
      if (!isConnected || !address) {
        setChargeError("Connect a wallet to view this layout's recipes.")
        return
      }
      const sessionToken = await siwe.ensureSignedIn()
      if (!sessionToken) {
        setChargeError('Sign the wallet prompt to continue.')
        return
      }
      // One idempotency key per invocation of openLayout (see chargeCredits.ts)
      // — dedups against a lost response for THIS attempt; a fresh manual
      // re-click is a new invocation and correctly gets a new key.
      const idempotencyKey = crypto.randomUUID()
      const charge = await chargeCredits(address, sessionToken, 'recipe_view', idempotencyKey)
      if (!charge.success) {
        if (charge.message === 'insufficient_balance') {
          setFundingPrompt({ actionType: 'recipe_view', priceCredits: prices.recipe_view })
        } else {
          setChargeError(`Couldn't charge for this recipe view (${charge.message}).`)
        }
        return
      }
      credits.refresh()

      setSelected(layout)
      setRecipesLoading(true)
      const r = await loadLayoutRecipes(layout)
      setRecipes(r)
      setRecipesLoading(false)
    } finally {
      openingRef.current = false
    }
  }

  // ── Detail view: same fixed-bar + InfiniteGrid chrome the ids/wallet
  // results view uses, once a search has been submitted ──────────────────
  if (selected) {
    return (
      <>
        <div className="search-fixed-bar" ref={fixedBarRef}>
          <button type="button" className="search-fixed-bar__edit" onClick={() => setSelected(null)}>← Back</button>
          <div className="search-fixed-bar__spacer" />
          <span className="filter-count pattern-recipe-count">
            {selected.minoritySize}-check minority · {selected.variety === 1 ? '1 color pair' : `${selected.variety}+ color pairs`} · {recipes.length} of {selected.totalRecipes}+ known recipes shown
          </span>
        </div>
        {recipesLoading ? (
          <div className="pattern-status">Loading recipes…</div>
        ) : (
          <InfiniteGrid
            permutations={recipes}
            ids={[]}
            showFlags={recipes.map(() => true)}
            hasFilters={false}
            dbMode={true}
            hideBuy={true}
            topPx={gridTop}
            getLikeInfo={getLikeInfo}
          />
        )}
      </>
    )
  }

  // ── Same centered card chrome (background canvas + searchpage__form) the
  // ids/wallet tabs use — the paint grid replaces their input field. Once
  // there are enough cells to search, results grow underneath instead of
  // replacing the panel, so the canvas stays put while you keep adjusting
  // your selection ────────────────────────────────────────────────────────
  const hasResults = cells.length >= MIN_CELLS_FOR_RESULTS
  return (
    <div className="pattern-browse-scroll">
      <div className="pattern-browse-hero">
        <SearchBackground svgs={bgSvgs} />
        <div className="pattern-browse-panel">
          <div className="searchpage__form">
            {tabs}
            <PatternPaintGrid selected={cells} onToggle={toggleCell} onClear={() => setCells([])} />
          </div>
        </div>
      </div>
      {hasResults && (
        <div className="pattern-browse-results-scroll">
          <div className="pattern-browse-results-below">
            {chargeError && <p className="pattern-status">{chargeError}</p>}
            <PatternComposer selected={cells} onSelectLayout={openLayout} />
          </div>
        </div>
      )}
      {fundingPrompt && (
        <FundingPrompt
          actionType={fundingPrompt.actionType}
          priceCredits={fundingPrompt.priceCredits}
          receivingAddress={import.meta.env.VITE_CREDITS_RECEIVING_ADDRESS ?? ''}
          onClose={() => setFundingPrompt(null)}
        />
      )}
    </div>
  )
}
