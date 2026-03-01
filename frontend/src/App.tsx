// frontend/src/App.tsx
import { useState, useMemo, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { Navbar } from './components/Navbar'
import { FilterBar, emptyFilters, matchesFilters, type Filters } from './components/FilterBar'
import { InfiniteGrid } from './components/InfiniteGrid'
import { useAllPermutations } from './useAllPermutations'
import { usePermutationsDB, usePriceBounds } from './usePermutationsDB'
import { useMyChecks } from './useMyChecks'
import { useMyCheckPermutations } from './useMyCheckPermutations'
import { hasSupabase } from './supabaseClient'
import { hasAlchemyKey } from './client'
import { parseIds, validateIds } from './utils'
import { useWalletTracking } from './useWalletTracking'

const SEARCH_WALLET_GATE = '0x6ab9b2ae58bc7eb5c401deae86fc095467c6d3e4'

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

export default function App() {
  const dbMode = hasSupabase()
  const { address, isConnected } = useAccount()
  useWalletTracking(address, isConnected)

  // ── View mode (only relevant in dbMode) ──────────────────────────────────
  const [viewMode, setViewMode] = useState<'token-works' | 'my-checks' | 'search-wallet'>('token-works')
  const [searchWalletAddress, setSearchWalletAddress] = useState('')

  const showSearchWallet = address?.toLowerCase() === SEARCH_WALLET_GATE

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
  const { state: dbState, loadRandom } = usePermutationsDB()

  useEffect(() => {
    if (!dbMode || viewMode !== 'token-works') return
    loadRandom()
  }, [dbMode, viewMode])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── My Checks mode ────────────────────────────────────────────────────────
  const myChecksEnabled = dbMode && viewMode === 'my-checks' && isConnected
  const myChecks = useMyChecks(address, myChecksEnabled)
  const myCheckPerms = useMyCheckPermutations(myChecks.checks)

  // ── Search Wallet mode ────────────────────────────────────────────────────
  const searchWalletEnabled = dbMode && viewMode === 'search-wallet' && isValidAddress(searchWalletAddress)
  const searchChecks = useMyChecks(searchWalletEnabled ? searchWalletAddress : undefined, searchWalletEnabled)
  const searchCheckPerms = useMyCheckPermutations(searchChecks.checks)

  // ── Price bounds (DB / Token Works mode only) ─────────────────────────────
  const priceBoundsEnabled = false
  const priceBounds = usePriceBounds(priceBoundsEnabled)

  // Generate permutations when checks load
  useEffect(() => {
    if (myChecksEnabled && !myChecks.loading && Object.keys(myChecks.checks).length > 0) {
      myCheckPerms.generate()
    }
  }, [myChecksEnabled, myChecks.loading, myChecks.checks])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (searchWalletEnabled && !searchChecks.loading && Object.keys(searchChecks.checks).length > 0) {
      searchCheckPerms.generate()
    }
  }, [searchWalletEnabled, searchChecks.loading, searchChecks.checks])  // eslint-disable-line react-hooks/exhaustive-deps

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
    else if (viewMode === 'search-wallet') searchCheckPerms.shuffle()
    else loadRandom(true)  // force=true bypasses sessionStorage cache
  }

  // ── Derive display values ─────────────────────────────────────────────────
  const isMyChecksMode = dbMode && viewMode === 'my-checks'
  const isSearchWalletMode = dbMode && viewMode === 'search-wallet'

  const permutations = isSearchWalletMode
    ? searchCheckPerms.permutations
    : isMyChecksMode
      ? myCheckPerms.permutations
      : dbMode ? dbState.permutations : chainState.permutations

  const isLoading = isSearchWalletMode
    ? searchChecks.loading
    : isMyChecksMode
      ? myChecks.loading
      : dbMode ? dbState.loading : chainState.permutations.some(p => p.nodeAbcd.loading)

  const showFlags = permutations.map(p => {
    if (p.nodeAbcd.loading || p.nodeAbcd.error) return true
    const [p0, p1, p2, p3] = p.def.indices
    const tids = p.def.tokenIds ?? [ids[p0], ids[p1], ids[p2], ids[p3]]
    return matchesFilters(p.nodeAbcd.attributes, filters, tids)
  })

  const visibleCount = showFlags.filter(Boolean).length
  const visiblePermutations = permutations.filter((_, i) => showFlags[i])

  const showFilters = isSearchWalletMode
    ? searchCheckPerms.permutations.length > 0
    : isMyChecksMode
      ? myCheckPerms.permutations.length > 0
      : dbMode
        ? dbState.permutations.length > 0 || dbState.loading
        : permutations.length > 0

  const myChecksError = isMyChecksMode
    ? (myChecks.error || (myChecks.tokenIds.length === 0 && !myChecks.loading ? 'No Checks VV tokens found in this wallet.' : ''))
    : ''

  const searchWalletError = isSearchWalletMode && isValidAddress(searchWalletAddress)
    ? (searchChecks.error || (searchChecks.tokenIds.length === 0 && !searchChecks.loading ? 'No Checks VV tokens found in this wallet.' : ''))
    : ''

  const navbarError = dbMode
    ? (myChecksError || searchWalletError || dbState.error || '')
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
        showSearchWallet={dbMode && isConnected ? showSearchWallet : false}
        searchWalletAddress={searchWalletAddress}
        onSearchWalletAddressChange={setSearchWalletAddress}
      />
      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          visible={visibleCount}
          onShuffle={(isMyChecksMode || dbMode) ? handleShuffle : undefined}
          priceRange={priceBoundsEnabled ? priceBounds ?? undefined : undefined}
          permutations={visiblePermutations}
        />
      )}
      {isMyChecksMode && myChecks.tokenIds.length > 0 && myCheckPerms.permutations.length === 0 && !myChecks.loading && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          Not enough compatible checks to generate permutations.
        </div>
      )}
      {isSearchWalletMode && !isValidAddress(searchWalletAddress) && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          Enter a wallet address above to explore permutations.
        </div>
      )}
      {isSearchWalletMode && isValidAddress(searchWalletAddress) && searchChecks.tokenIds.length > 0 && searchCheckPerms.permutations.length === 0 && !searchChecks.loading && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          Not enough compatible checks to generate permutations.
        </div>
      )}
      {!isMyChecksMode && !isSearchWalletMode && dbMode && !dbState.loading && dbState.permutations.length > 0 && visibleCount === 0 && (
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
        hideBuy={isMyChecksMode || isSearchWalletMode}
        filtersTall={false}
      />
      {(dbMode && (isSearchWalletMode ? searchChecks.loading : isMyChecksMode ? myChecks.loading : dbState.loading)) && (
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
