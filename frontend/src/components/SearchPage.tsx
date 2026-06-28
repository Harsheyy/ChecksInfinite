// frontend/src/components/SearchPage.tsx
import { useState, useMemo, useCallback, useEffect, useRef, useLayoutEffect } from 'react'
import { useAccount } from 'wagmi'
import { InfiniteGrid } from './InfiniteGrid'
import { TraitMultiSelect } from './TraitMultiSelect'
import { SearchInputTabs, parseIds, type SearchInputMode } from './SearchInputTabs'
import {
  emptySearchFilters,
  hasActiveSearchFilters,
  countActiveSearchFilters,
  matchesSearchFilters,
  TRAIT_OPTIONS,
  type SearchFilters,
} from '../searchFilters'
import { useExplorePermutations } from '../useExplorePermutations'
import { useMyChecks } from '../useMyChecks'
import { useMyCheckPermutations } from '../useMyCheckPermutations'
import { useEnsResolver, isEnsName } from '../useEnsResolver'
import { useGlobalTraitSearch } from '../useGlobalTraitSearch'
import { useBackgroundPermutations } from '../useBackgroundPermutations'
import { isValidAddress } from '../utils'
import type { PermutationResult } from '../useAllPermutations'
import type { LikeInfo } from './PermutationCard'

type LikeSource = 'explore' | 'curated' | 'search'

// Multi-select pill group for the mobile filter panel
function PanelMultiOpts({ label, options, values, onChange }: {
  label: string
  options: readonly string[]
  values: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <div className="filter-panel-group">
      <span className="filter-select-name">{label}</span>
      <div className="filter-panel-options">
        <button
          type="button"
          className={`filter-panel-option${values.length === 0 ? ' filter-panel-option--active' : ''}`}
          onClick={() => onChange([])}
        >Any</button>
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            className={`filter-panel-option${values.includes(opt) ? ' filter-panel-option--active' : ''}`}
            onClick={() => onChange(
              values.includes(opt) ? values.filter(v => v !== opt) : [...values, opt]
            )}
          >{opt}</button>
        ))}
      </div>
    </div>
  )
}

interface SearchPageProps {
  getLikeInfo?: (result: PermutationResult, source: LikeSource) => LikeInfo | undefined
}

export function SearchPage({ getLikeInfo }: SearchPageProps) {
  const { address, isConnected } = useAccount()

  // ── Form state ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<SearchInputMode>('ids')
  const [idsRaw, setIdsRaw] = useState('')
  const [walletRaw, setWalletRaw] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(emptySearchFilters())
  const [submitted, setSubmitted] = useState(false)
  const [activeMode, setActiveMode] = useState<SearchInputMode | null>(null)
  const [resolvedWallet, setResolvedWallet] = useState<string | undefined>(undefined)
  const [resolvedWalletLabel, setResolvedWalletLabel] = useState<string>('')
  const [submitError, setSubmitError] = useState<string>('')

  // ── Background art ────────────────────────────────────────────────────
  const bgSvgs = useBackgroundPermutations()

  // ── Data hooks ─────────────────────────────────────────────────────────
  const idSearch     = useExplorePermutations(address)
  const ensResolver  = useEnsResolver()
  const walletChecks = useMyChecks(resolvedWallet, submitted && activeMode === 'wallet' && !!resolvedWallet)
  const walletPerms  = useMyCheckPermutations(walletChecks.checks)
  const global       = useGlobalTraitSearch()

  // Generate wallet permutations when checks load
  useEffect(() => {
    if (submitted && activeMode === 'wallet' && !walletChecks.loading && Object.keys(walletChecks.checks).length > 0) {
      walletPerms.generate()
    }
  }, [submitted, activeMode, walletChecks.loading, walletChecks.checks])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived input validity ─────────────────────────────────────────────
  const idsParsed = useMemo(() => parseIds(idsRaw), [idsRaw])
  const walletTrim = walletRaw.trim()
  const walletValid = isValidAddress(walletTrim) || isEnsName(walletTrim)

  const canSubmit =
    mode === 'ids'    ? idsParsed.length >= 4 && idsParsed.length <= 10 :
    mode === 'wallet' ? walletValid :
                        false

  const canSubmitGlobal = hasActiveSearchFilters(filters)

  const submitEnabled = canSubmit || canSubmitGlobal

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    setSubmitError('')
    setSubmitted(true)
    if (mode === 'ids' && canSubmit) {
      setActiveMode('ids')
      idSearch.search(idsParsed)
    } else if (mode === 'wallet' && walletValid) {
      setActiveMode('wallet')
      // Resolve ENS if needed
      let target = walletTrim.toLowerCase()
      let label = walletTrim
      if (isEnsName(walletTrim)) {
        const resolved = await ensResolver.resolve(walletTrim)
        if (!resolved) {
          setSubmitError(`Couldn't resolve '${walletTrim}'. Try the 0x address instead.`)
          setSubmitted(false)
          setActiveMode(null)
          return
        }
        target = resolved
      } else {
        label = `${walletTrim.slice(0, 6)}…${walletTrim.slice(-4)}`
      }
      setResolvedWalletLabel(label)
      setResolvedWallet(target)
    } else if (canSubmitGlobal) {
      setActiveMode(null)
      global.run(filters)
    }
  }, [mode, canSubmit, canSubmitGlobal, idsParsed, walletTrim, walletValid, filters, idSearch, ensResolver, global])

  // Re-run global query when filters change after first submit (live updates)
  useEffect(() => {
    if (submitted && activeMode === null && hasActiveSearchFilters(filters)) {
      global.run(filters)
    }
  }, [filters, submitted, activeMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Edit / clear ───────────────────────────────────────────────────────
  function handleEdit() {
    setSubmitted(false)
  }
  function handleClearInput() {
    setSubmitted(false)
    setActiveMode(null)
    setResolvedWallet(undefined)
    setIdsRaw('')
    setWalletRaw('')
    idSearch.clear()
  }
  function handleClearTrait(k: keyof SearchFilters) {
    setFilters(prev => ({ ...prev, [k]: [] }))
  }
  function handleClearPrice() {
    setFilters(prev => ({ ...prev, priceMin: '', priceMax: '' }))
  }
  function handleClearAllTraits() {
    setFilters(emptySearchFilters())
  }
  function handleUseMyWallet() {
    if (address) setWalletRaw(address)
  }

  // ── Shuffle ────────────────────────────────────────────────────────────
  function handleShuffle() {
    if (activeMode === 'ids') idSearch.shuffle()
    else if (activeMode === 'wallet') walletPerms.shuffle()
    else if (activeMode === null) global.run(filters) // re-fetch reshuffles via rand_key + offset
  }

  // ── Choose results source ──────────────────────────────────────────────
  const isGlobalActive = submitted && activeMode === null
  const isIdsActive    = submitted && activeMode === 'ids'
  const isWalletActive = submitted && activeMode === 'wallet'

  const rawPermutations: PermutationResult[] = useMemo(() => {
    if (isIdsActive)    return idSearch.permutations
    if (isWalletActive) return walletPerms.permutations
    if (isGlobalActive) return global.permutations
    return []
  }, [isIdsActive, isWalletActive, isGlobalActive, idSearch.permutations, walletPerms.permutations, global.permutations])

  // Client-side filter: traits for ids/wallet paths, price for all paths with total_cost
  const visiblePermutations = useMemo(() => {
    let perms = rawPermutations
    if ((isIdsActive || isWalletActive) && hasActiveSearchFilters(filters)) {
      perms = perms.filter(p => matchesSearchFilters(p.nodeAbcd.attributes, filters))
    }
    if (filters.priceMin || filters.priceMax) {
      const min = filters.priceMin ? parseFloat(filters.priceMin) : -Infinity
      const max = filters.priceMax ? parseFloat(filters.priceMax) : Infinity
      perms = perms.filter(p => p.total_cost == null || (p.total_cost >= min && p.total_cost <= max))
    }
    return perms
  }, [rawPermutations, filters, isIdsActive, isWalletActive])

  // Counts for trait popovers — based on currently raw permutations (un-filtered),
  // letting users see the "what's left" hint while toggling. For global mode the
  // count column is left undefined (server-side filtered already).
  const traitCounts = useMemo(() => {
    if (isGlobalActive || rawPermutations.length === 0) return undefined
    const c = {
      checks:    new Map<string, number>(),
      colorBand: new Map<string, number>(),
      gradient:  new Map<string, number>(),
      speed:     new Map<string, number>(),
      shift:     new Map<string, number>(),
    }
    const traitPair: Array<[keyof typeof c, string]> = [
      ['checks',    'Checks'],
      ['colorBand', 'Color Band'],
      ['gradient',  'Gradient'],
      ['speed',     'Speed'],
      ['shift',     'Shift'],
    ]
    for (const p of rawPermutations) {
      for (const [key, t] of traitPair) {
        const attr = p.nodeAbcd.attributes.find(a => a.trait_type === t)
        if (attr) {
          const v = String(attr.value)
          c[key].set(v, (c[key].get(v) ?? 0) + 1)
        }
      }
    }
    return c
  }, [rawPermutations, isGlobalActive])

  // ── Status / errors ────────────────────────────────────────────────────
  const isLoading =
    (isIdsActive    && idSearch.loading) ||
    (isWalletActive && (walletChecks.loading || ensResolver.loading)) ||
    (isGlobalActive && global.loading)

  const errorBanner =
    submitError ||
    (isIdsActive    && idSearch.error) ||
    (isWalletActive && walletChecks.error) ||
    (isGlobalActive && global.error) ||
    ''

  const emptyMessage = useMemo(() => {
    if (!submitted || isLoading) return ''
    if (isIdsActive && idSearch.searched && idSearch.permutations.length === 0 && !idSearch.error) {
      return 'No compatible permutations found. Tokens must share the same check count.'
    }
    if (isWalletActive && walletChecks.tokenIds.length > 0 && walletPerms.permutations.length === 0 && !walletChecks.loading) {
      return 'Not enough compatible checks to generate permutations.'
    }
    if (isWalletActive && walletChecks.tokenIds.length === 0 && !walletChecks.loading && !walletChecks.error) {
      return `${resolvedWalletLabel} doesn't own any Checks VV tokens.`
    }
    if (visiblePermutations.length === 0 && rawPermutations.length > 0) {
      return 'No permutations match these filters. Try removing a trait or widening your input.'
    }
    if (isGlobalActive && global.permutations.length === 0 && !global.loading) {
      return 'No permutations match these filters. Try a broader trait combination.'
    }
    return ''
  }, [submitted, isLoading, isIdsActive, isWalletActive, isGlobalActive,
      idSearch.searched, idSearch.permutations.length, idSearch.error,
      walletChecks.tokenIds.length, walletChecks.loading, walletChecks.error,
      walletPerms.permutations.length, visiblePermutations.length,
      rawPermutations.length, resolvedWalletLabel, global.permutations.length, global.loading])

  // ── Render ─────────────────────────────────────────────────────────────
  const showEmptyForm = !submitted

  const inputSummary =
    activeMode === 'ids'    ? idsParsed.join(', ') :
    activeMode === 'wallet' ? resolvedWalletLabel :
                              ''

  const wrappedGetLikeInfo = getLikeInfo
    ? (r: PermutationResult) => getLikeInfo(r, 'search')
    : undefined

  const fixedBarRef = useRef<HTMLDivElement>(null)
  const [gridTop, setGridTop] = useState(180) // initial estimate; measured after render
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  useLayoutEffect(() => {
    if (!submitted || !fixedBarRef.current) return
    // getBoundingClientRect().bottom is viewport-relative — exactly what fixed topPx needs
    // This automatically handles both 48px (desktop) and 76px (mobile) navbar heights
    setGridTop(Math.round(fixedBarRef.current.getBoundingClientRect().bottom))
  }, [submitted, filters, searchPanelOpen])

  const filterControls = (
    <>
      <TraitMultiSelect label="Checks"     options={TRAIT_OPTIONS.checks}    values={filters.checks}    onChange={v => setFilters({ ...filters, checks: v })}    counts={traitCounts?.checks} />
      <TraitMultiSelect label="Color band" options={TRAIT_OPTIONS.colorBand} values={filters.colorBand} onChange={v => setFilters({ ...filters, colorBand: v })} counts={traitCounts?.colorBand} />
      <TraitMultiSelect label="Gradient"   options={TRAIT_OPTIONS.gradient}  values={filters.gradient}  onChange={v => setFilters({ ...filters, gradient: v })}  counts={traitCounts?.gradient} />
      <TraitMultiSelect label="Speed"      options={TRAIT_OPTIONS.speed}     values={filters.speed}     onChange={v => setFilters({ ...filters, speed: v })}     counts={traitCounts?.speed} />
      <TraitMultiSelect label="Shift"      options={TRAIT_OPTIONS.shift}     values={filters.shift}     onChange={v => setFilters({ ...filters, shift: v })}     counts={traitCounts?.shift} />
      <div className="searchpage__price-range">
        <span className="searchpage__price-label">Price (ETH)</span>
        <div className="searchpage__price-inputs">
          <input
            type="number"
            className="searchpage__price-input"
            placeholder="Min"
            min="0"
            step="0.01"
            value={filters.priceMin}
            onChange={e => setFilters({ ...filters, priceMin: e.target.value })}
          />
          <span className="searchpage__price-sep">–</span>
          <input
            type="number"
            className="searchpage__price-input"
            placeholder="Max"
            min="0"
            step="0.01"
            value={filters.priceMax}
            onChange={e => setFilters({ ...filters, priceMax: e.target.value })}
          />
        </div>
      </div>
    </>
  )

  return (
    <>
    <div className={`searchpage${showEmptyForm ? ' searchpage--landing' : ''}`}>
      {showEmptyForm && bgSvgs.length > 0 && (
        <div className="search-bg-canvas" aria-hidden="true">
          {[0, 1, 2, 3, 4].map(row => (
            <div
              key={row}
              className={`search-bg-row search-bg-row--${row % 2 === 0 ? 'fwd' : 'rev'}`}
              style={{ animationDuration: `${28 + row * 7}s`, animationDelay: `${-row * 3}s` }}
            >
              {/* duplicate once for seamless loop */}
              {[...bgSvgs, ...bgSvgs].map((svg, i) => (
                <div
                  key={i}
                  className="search-bg-panel"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {showEmptyForm ? (
        <div className="searchpage__form">
          <SearchInputTabs
            mode={mode}
            onModeChange={setMode}
            idsRaw={idsRaw}
            onIdsRawChange={setIdsRaw}
            walletRaw={walletRaw}
            onWalletRawChange={setWalletRaw}
            walletConnectedAddress={isConnected ? address : undefined}
            onUseMyWallet={handleUseMyWallet}
            loading={isLoading}
          />

          <div className="searchpage__dock">
            <div className="searchpage__dock-label">Refine by traits</div>
            {filterControls}
            {hasActiveSearchFilters(filters) && (
              <button type="button" className="searchpage__clear-traits" onClick={handleClearAllTraits}>Clear all</button>
            )}
          </div>

          <div className="searchpage__submit-row">
            <button
              type="button"
              className="searchpage__submit"
              onClick={handleSubmit}
              disabled={!submitEnabled || isLoading}
            >
              {isLoading ? 'Searching…' : 'Search →'}
            </button>
          </div>
        </div>
      ) : (
        <div className="search-fixed-bar" ref={fixedBarRef}>
          {/* LEFT: trait + price filters (desktop only) */}
          <div className="search-fixed-bar__filters">
            {filterControls}
            {hasActiveSearchFilters(filters) && (
              <button type="button" className="filter-clear" onClick={handleClearAllTraits}>Clear</button>
            )}
          </div>

          {/* Mobile: Filters trigger (hidden on desktop) */}
          <button
            type="button"
            className="search-fixed-bar__mobile-trigger filter-mobile-trigger"
            onClick={() => setSearchPanelOpen(true)}
          >
            {countActiveSearchFilters(filters) > 0
              ? `${countActiveSearchFilters(filters)} Filter${countActiveSearchFilters(filters) !== 1 ? 's' : ''}`
              : 'Filters'}
          </button>

          <div className="search-fixed-bar__spacer" />

          {/* RIGHT: input chip → edit → count → shuffle */}
          {inputSummary && (
            <span className="search-fixed-bar__input-chip">
              {activeMode === 'ids' ? `IDs (${idsParsed.length})` : inputSummary}
              <button type="button" aria-label="Clear search input" onClick={handleClearInput}>×</button>
            </span>
          )}
          <button type="button" className="search-fixed-bar__edit" onClick={handleEdit}>Edit ↗</button>
          <span className="filter-count">
            {visiblePermutations.length}
            {isGlobalActive && global.capped && (
              <span className="info-icon-wrapper" tabIndex={0} aria-label="info">
                <span className="info-icon" aria-hidden="true">ⓘ</span>
                <span className="info-tooltip" role="tooltip">
                  Showing a random sample of {visiblePermutations.length} from ~{global.totalMatches} total matches. Shuffle to see different results.
                </span>
              </span>
            )}
          </span>
          <button type="button" className="filter-shuffle" onClick={handleShuffle} disabled={isLoading}>
            ↻ Shuffle
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="error-banner">{errorBanner}</div>
      )}

      {emptyMessage && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          {emptyMessage}
        </div>
      )}

      {/* InfiniteGrid only renders after submit */}
      {submitted && (
        <InfiniteGrid
          permutations={visiblePermutations}
          ids={[]}
          showFlags={visiblePermutations.map(() => true)}
          hasFilters={false}
          hasError={!!errorBanner}
          dbMode={true}
          hideBuy={true}
          filtersTall={false}
          getLikeInfo={wrappedGetLikeInfo}
          topPx={gridTop}
        />
      )}
    </div>

    {/* Mobile search filter panel — outside .searchpage to escape its stacking context */}
    {!showEmptyForm && searchPanelOpen && (
      <>
        <div className="filter-panel-backdrop" onClick={() => setSearchPanelOpen(false)} />
        <div className="filter-panel">
          <div className="filter-panel-header">
            <span>Filters</span>
            <button type="button" className="filter-panel-close" onClick={() => setSearchPanelOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="filter-panel-body">
            <PanelMultiOpts label="Checks"     options={TRAIT_OPTIONS.checks}    values={filters.checks}    onChange={v => setFilters({ ...filters, checks: v })} />
            <PanelMultiOpts label="Color Band" options={TRAIT_OPTIONS.colorBand} values={filters.colorBand} onChange={v => setFilters({ ...filters, colorBand: v })} />
            <PanelMultiOpts label="Gradient"   options={TRAIT_OPTIONS.gradient}  values={filters.gradient}  onChange={v => setFilters({ ...filters, gradient: v })} />
            <PanelMultiOpts label="Speed"      options={TRAIT_OPTIONS.speed}     values={filters.speed}     onChange={v => setFilters({ ...filters, speed: v })} />
            <PanelMultiOpts label="Shift"      options={TRAIT_OPTIONS.shift}     values={filters.shift}     onChange={v => setFilters({ ...filters, shift: v })} />
            <div className="filter-panel-group">
              <span className="filter-select-name">Price (ETH)</span>
              <div className="filter-panel-price-row">
                <input
                  className="filter-panel-price-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Min"
                  value={filters.priceMin}
                  onChange={e => setFilters({ ...filters, priceMin: e.target.value })}
                />
                <span className="filter-panel-price-sep">–</span>
                <input
                  className="filter-panel-price-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Max"
                  value={filters.priceMax}
                  onChange={e => setFilters({ ...filters, priceMax: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="filter-panel-footer">
            {hasActiveSearchFilters(filters) && (
              <button type="button" className="filter-clear" onClick={() => { handleClearAllTraits(); setSearchPanelOpen(false) }}>
                Clear all
              </button>
            )}
            <button type="button" className="filter-panel-done" onClick={() => setSearchPanelOpen(false)}>Done</button>
          </div>
        </div>
      </>
    )}
    </>
  )
}
