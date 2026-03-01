// frontend/src/App.tsx
import { useState, useMemo, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { Navbar } from './components/Navbar'
import { FilterBar, emptyFilters, hasActiveFilters, matchesFilters, type Filters } from './components/FilterBar'
import { InfiniteGrid } from './components/InfiniteGrid'
import { useAllPermutations } from './useAllPermutations'
import { usePermutationsDB, usePriceBounds } from './usePermutationsDB'
import { useMyChecks } from './useMyChecks'
import { useMyCheckPermutations } from './useMyCheckPermutations'
import { hasSupabase } from './supabaseClient'
import { hasAlchemyKey } from './client'
import { parseIds, validateIds } from './utils'

export default function App() {
  const dbMode = hasSupabase()
  const { address, isConnected } = useAccount()

  // ── View mode (only relevant in dbMode) ──────────────────────────────────
  const [viewMode, setViewMode] = useState<'token-works' | 'my-checks'>('token-works')

  // Reset to token-works when wallet disconnects
  useEffect(() => {
    if (!isConnected) setViewMode('token-works')
  }, [isConnected])

  // ── Chain mode state ──────────────────────────────────────────────────────
  const [idsRaw, setIdsRaw] = useState('')
  const [validationError, setValidationError] = useState('')
  const { state: chainState, preview } = useAllPermutations()

  // ── Shared filter state ───────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(emptyFilters())

  // ── DB / Token Works mode ─────────────────────────────────────────────────
  const { state: dbState, load, loadRandom } = usePermutationsDB()
  const activeFilters = hasActiveFilters(filters)

  useEffect(() => {
    if (!dbMode || viewMode !== 'token-works') return
    if (activeFilters) {
      const t = setTimeout(() => load(filters), 300)
      return () => clearTimeout(t)
    }
    loadRandom()
  }, [dbMode, viewMode, filters])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── My Checks mode ────────────────────────────────────────────────────────
  const myChecksEnabled = dbMode && viewMode === 'my-checks' && isConnected
  const myChecks = useMyChecks(address, myChecksEnabled)
  const myCheckPerms = useMyCheckPermutations(myChecks.checks)

  // ── Price bounds (DB / Token Works mode only) ─────────────────────────────
  const priceBoundsEnabled = dbMode && viewMode === 'token-works'
  const priceBounds = usePriceBounds(priceBoundsEnabled)

  // Generate permutations when checks load
  useEffect(() => {
    if (myChecksEnabled && !myChecks.loading && Object.keys(myChecks.checks).length > 0) {
      myCheckPerms.generate()
    }
  }, [myChecksEnabled, myChecks.loading, myChecks.checks])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chain mode handlers ───────────────────────────────────────────────────
  const ids = useMemo(() => parseIds(idsRaw), [idsRaw])

  function handlePreview() {
    const err = validateIds(ids, hasAlchemyKey())
    setValidationError(err)
    if (err) return
    setFilters(emptyFilters())
    preview(ids)
  }

  function handleShuffle() {
    if (viewMode === 'my-checks') myCheckPerms.shuffle()
    else loadRandom()
  }

  // ── Derive display values ─────────────────────────────────────────────────
  const isMyChecksMode = dbMode && viewMode === 'my-checks'

  const permutations = isMyChecksMode
    ? myCheckPerms.permutations
    : dbMode ? dbState.permutations : chainState.permutations

  const isLoading = isMyChecksMode
    ? myChecks.loading
    : dbMode ? dbState.loading : chainState.permutations.some(p => p.nodeAbcd.loading)

  const showFlags = (isMyChecksMode || !dbMode)
    ? permutations.map(p => {
        if (p.nodeAbcd.loading || p.nodeAbcd.error) return true
        const [p0, p1, p2, p3] = p.def.indices
        const tids = p.def.tokenIds ?? [ids[p0], ids[p1], ids[p2], ids[p3]]
        return matchesFilters(p.nodeAbcd.attributes, filters, tids)
      })
    : permutations.map(() => true)

  const visibleCount = showFlags.filter(Boolean).length

  const showFilters = isMyChecksMode
    ? myCheckPerms.permutations.length > 0
    : dbMode
      ? dbState.total > 0 || dbState.loading || activeFilters
      : permutations.length > 0

  const myChecksError = isMyChecksMode
    ? (myChecks.error || (myChecks.tokenIds.length === 0 && !myChecks.loading ? 'No Checks VV tokens found in this wallet.' : ''))
    : ''

  const navbarError = dbMode
    ? (myChecksError || dbState.error || '')
    : (validationError || (!hasAlchemyKey() ? 'VITE_ALCHEMY_API_KEY not set in frontend/.env' : ''))

  return (
    <>
      <Navbar
        ids={dbMode ? '' : idsRaw}
        loading={isLoading}
        onIdsChange={dbMode ? () => {} : setIdsRaw}
        onPreview={dbMode ? () => {} : handlePreview}
        error={navbarError}
        dbMode={dbMode}
        dbTotal={dbMode ? dbState.total : undefined}
        viewMode={dbMode && isConnected ? viewMode : undefined}
        onViewModeChange={dbMode && isConnected ? setViewMode : undefined}
      />
      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          visible={isMyChecksMode ? visibleCount : dbMode ? dbState.permutations.length : visibleCount}
          onShuffle={(isMyChecksMode || (dbMode && !activeFilters)) ? handleShuffle : undefined}
          priceRange={priceBoundsEnabled ? priceBounds ?? undefined : undefined}
        />
      )}
      {isMyChecksMode && myChecks.tokenIds.length > 0 && myCheckPerms.permutations.length === 0 && !myChecks.loading && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          Not enough compatible checks to generate permutations.
        </div>
      )}
      {!isMyChecksMode && dbMode && !dbState.loading && activeFilters && dbState.total === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          No permutations match these filters.
        </div>
      )}
      <InfiniteGrid
        permutations={permutations}
        ids={ids}
        showFlags={showFlags}
        hasFilters={showFilters}
        dbMode={dbMode}
        hideBuy={isMyChecksMode}
        filtersTall={false}
      />
      {(dbMode && (isMyChecksMode ? myChecks.loading : dbState.loading)) && (
        <div style={{
          position: 'fixed', bottom: '1rem', right: '1rem',
          background: '#1a1a1a', border: '1px solid #333', borderRadius: '3px',
          padding: '0.35rem 0.75rem', fontSize: '0.75rem', color: '#888',
          zIndex: 50,
        }}>
          Loading…
        </div>
      )}
    </>
  )
}
