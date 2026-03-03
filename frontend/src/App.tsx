// frontend/src/App.tsx
import { useState, useMemo, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { Navbar } from './components/Navbar'
import { FilterBar, emptyFilters, matchesFilters, type Filters } from './components/FilterBar'
import { InfiniteGrid } from './components/InfiniteGrid'
import { useAllPermutations } from './useAllPermutations'
import type { PermutationResult } from './useAllPermutations'
import { usePermutationsDB, serializeCheckStruct, fetchCheckStructMap } from './usePermutationsDB'
import { useMyChecks } from './useMyChecks'
import { useMyCheckPermutations } from './useMyCheckPermutations'
import { hasSupabase, supabase } from './supabaseClient'
import { hasAlchemyKey } from './client'
import { parseIds, validateIds, isValidAddress } from './utils'
import { useWalletTracking } from './useWalletTracking'
import { useCuratedOutputs, type CuratedPermutationResult } from './useCuratedOutputs'
import { useMyLikedKeys, likedKey } from './useMyLikedKeys'
import type { LikeInfo } from './components/PermutationCard'
import { useExplorePermutations } from './useExplorePermutations'

const SEARCH_WALLET_GATE = '0x6ab9b2ae58bc7eb5c401deae86fc095467c6d3e4'

export default function App() {
  const dbMode = hasSupabase()
  const { address, isConnected } = useAccount()
  useWalletTracking(address, isConnected)

  // ── View mode (only relevant in dbMode) ──────────────────────────────────
  const [viewMode, setViewMode] = useState<'token-works' | 'my-checks' | 'explore' | 'curated' | 'search-wallet'>('token-works')
  const [searchWalletAddress, setSearchWalletAddress] = useState('')
  const [walletOnly, setWalletOnly] = useState(false)
  const [exploreEmptyRaw, setExploreEmptyRaw] = useState('')

  const showSearchWallet = address?.toLowerCase() === SEARCH_WALLET_GATE

  // Reset to token-works when wallet disconnects
  useEffect(() => {
    if (!isConnected) { setViewMode('token-works'); setWalletOnly(false) }  // eslint-disable-line react-hooks/set-state-in-effect
  }, [isConnected])

  // ── Chain mode state ──────────────────────────────────────────────────────
  const [idsRaw, setIdsRaw] = useState('')
  const [validationError, setValidationError] = useState('')
  const { state: chainState, preview } = useAllPermutations()

  // ── Shared filter state ───────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(emptyFilters())

  // ── DB / Token Works mode ─────────────────────────────────────────────────
  const { state: dbState, loadRandom, shuffle: shuffleDB } = usePermutationsDB()

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

  // ── Curated mode ──────────────────────────────────────────────────────────────
  const { state: curatedState, load: loadCurated } = useCuratedOutputs()

  // ── Explore (Curate) mode ─────────────────────────────────────────────────
  const explore = useExplorePermutations()

  // ── Like state (across all modes) ────────────────────────────────────────────
  const { likedKeys, setLikedKeys } = useMyLikedKeys(address?.toLowerCase())
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(new Map())

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

  useEffect(() => {
    if (!dbMode || viewMode !== 'curated') return
    loadCurated(filters, walletOnly, address?.toLowerCase())
  }, [dbMode, viewMode, walletOnly, filters.checks, filters.colorBand, filters.gradient, filters.speed, filters.shift])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (viewMode !== 'explore') { explore.clear(); setExploreEmptyRaw('') }
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!curatedState.outputs.length) return
    const newCounts = new Map<string, number>()
    const newLiked  = new Set(likedKeys)
    for (const o of curatedState.outputs) {
      const [k1, b1, k2, b2] = o.def.tokenIds!
      const key = likedKey(k1, b1, k2, b2)
      newCounts.set(key, o.likeCount)
      if ((o as CuratedPermutationResult).userLiked) newLiked.add(key)
    }
    setLikeCounts(newCounts)  // eslint-disable-line react-hooks/set-state-in-effect
    setLikedKeys(newLiked)
  }, [curatedState.outputs])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chain mode handlers ───────────────────────────────────────────────────
  const ids = useMemo(() => parseIds(idsRaw), [idsRaw])

  function handlePreview() {
    const err = validateIds(ids, hasAlchemyKey())
    setValidationError(err)
    if (err) return
    setFilters(emptyFilters())
    preview(ids)
  }

  const exploreEmptyIds = useMemo(
    () => [...new Set(exploreEmptyRaw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)))],
    [exploreEmptyRaw]
  )

  function handleExploreEmptySubmit(e: React.FormEvent) {
    e.preventDefault()
    explore.search(exploreEmptyIds)
  }

  const exploreEmptyIdCount = exploreEmptyIds.length

  function handleShuffle() {
    if (viewMode === 'my-checks') myCheckPerms.shuffle()
    else if (viewMode === 'search-wallet') searchCheckPerms.shuffle()
    else if (viewMode === 'explore') explore.shuffle()
    else shuffleDB()
  }

  async function handleToggleLike(result: PermutationResult, source: 'token-works' | 'my-checks' | 'search-wallet' | 'curated' | 'explore') {
    if (!address || !supabase) return
    const [k1, b1, k2, b2] = result.def.tokenIds!
    const key = likedKey(k1, b1, k2, b2)
    const wallet = address.toLowerCase()
    // 'curated' and 'explore' are view modes, not sources — attribute to 'token-works'
    const rpcSource = (source === 'curated' || source === 'explore') ? 'token-works' : source

    const wasLiked  = likedKeys.has(key)
    const prevCount = likeCounts.get(key) ?? 0
    setLikedKeys(prev => {
      const next = new Set(prev)
      if (wasLiked) next.delete(key); else next.add(key)
      return next
    })
    setLikeCounts(prev => {
      const next = new Map(prev)
      next.set(key, wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1)
      return next
    })

    const attrs = result.nodeAbcd.attributes
    const getAttr = (t: string) => attrs.find(a => a.trait_type === t)?.value as string | undefined

    // Gather check structs for new likes (curated rows already have structs stored)
    let p_k1_struct = null
    let p_b1_struct = null
    let p_k2_struct = null
    let p_b2_struct = null

    if (!wasLiked && source !== 'curated') {
      if (source === 'my-checks') {
        const m = myChecks.checks
        p_k1_struct = m[k1] ? serializeCheckStruct(m[k1]) : null
        p_b1_struct = m[b1] ? serializeCheckStruct(m[b1]) : null
        p_k2_struct = m[k2] ? serializeCheckStruct(m[k2]) : null
        p_b2_struct = m[b2] ? serializeCheckStruct(m[b2]) : null
      } else if (source === 'explore') {
        const m = explore.checks
        p_k1_struct = m[k1] ? serializeCheckStruct(m[k1]) : null
        p_b1_struct = m[b1] ? serializeCheckStruct(m[b1]) : null
        p_k2_struct = m[k2] ? serializeCheckStruct(m[k2]) : null
        p_b2_struct = m[b2] ? serializeCheckStruct(m[b2]) : null
      } else if (source === 'search-wallet') {
        const m = searchChecks.checks
        p_k1_struct = m[k1] ? serializeCheckStruct(m[k1]) : null
        p_b1_struct = m[b1] ? serializeCheckStruct(m[b1]) : null
        p_k2_struct = m[k2] ? serializeCheckStruct(m[k2]) : null
        p_b2_struct = m[b2] ? serializeCheckStruct(m[b2]) : null
      } else {
        // token-works: fetch from tokenstr_checks
        const structMap = await fetchCheckStructMap([k1, b1, k2, b2].map(Number))
        p_k1_struct = structMap.get(parseInt(k1)) ?? null
        p_b1_struct = structMap.get(parseInt(b1)) ?? null
        p_k2_struct = structMap.get(parseInt(k2)) ?? null
        p_b2_struct = structMap.get(parseInt(b2)) ?? null
      }
    }

    const { error } = await supabase.rpc('toggle_like', {
      p_keeper_1_id:     parseInt(k1),
      p_burner_1_id:     parseInt(b1),
      p_keeper_2_id:     parseInt(k2),
      p_burner_2_id:     parseInt(b2),
      p_wallet:          wallet,
      p_source:          rpcSource,
      p_abcd_checks:     parseInt(getAttr('Checks') ?? '0'),
      p_abcd_color_band: getAttr('Color Band') ?? '',
      p_abcd_gradient:   getAttr('Gradient') ?? '',
      p_abcd_speed:      getAttr('Speed') ?? '',
      p_abcd_shift:      getAttr('Shift') ?? null,
      p_k1_struct,
      p_b1_struct,
      p_k2_struct,
      p_b2_struct,
    })

    if (error) {
      setLikedKeys(prev => {
        const next = new Set(prev)
        if (wasLiked) next.add(key); else next.delete(key)
        return next
      })
      setLikeCounts(prev => {
        const next = new Map(prev)
        next.set(key, prevCount)
        return next
      })
      console.error('toggle_like failed:', error)
    }
  }

  function getLikeInfo(result: PermutationResult): LikeInfo | undefined {
    if (!dbMode) return undefined
    const isCurated = viewMode === 'curated'
    const [k1, b1, k2, b2] = result.def.tokenIds ?? []
    if (!k1 || !b1 || !k2 || !b2) return undefined
    const key = likedKey(k1, b1, k2, b2)
    return {
      isLiked:    likedKeys.has(key),
      likeCount:  isCurated ? (likeCounts.get(key) ?? 0) : undefined,
      alwaysShow: isCurated,
      canLike:    isConnected,
      onLike:     isConnected
        ? () => handleToggleLike(result, viewMode as 'token-works' | 'my-checks' | 'search-wallet' | 'curated' | 'explore')
        : () => {},
    }
  }

  // ── Derive display values ─────────────────────────────────────────────────
  const isMyChecksMode = dbMode && viewMode === 'my-checks'
  const isSearchWalletMode = dbMode && viewMode === 'search-wallet'
  const isCuratedMode = dbMode && viewMode === 'curated'
  const isExploreMode = dbMode && viewMode === 'explore'

  const permutations = isExploreMode
    ? explore.permutations
    : isCuratedMode
      ? curatedState.outputs
      : isSearchWalletMode
        ? searchCheckPerms.permutations
        : isMyChecksMode
          ? myCheckPerms.permutations
          : dbMode ? dbState.permutations : chainState.permutations

  const isLoading = isExploreMode
    ? explore.loading
    : isCuratedMode
      ? curatedState.loading
      : isSearchWalletMode
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

  const showFilters = isExploreMode
    ? explore.searched
    : isCuratedMode
      ? curatedState.outputs.length > 0 || curatedState.loading
      : isSearchWalletMode
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
        dbMode={dbMode}
        viewMode={dbMode ? viewMode : undefined}
        onViewModeChange={dbMode ? setViewMode : undefined}
        showSearchWallet={dbMode && isConnected ? showSearchWallet : false}
        searchWalletAddress={searchWalletAddress}
        onSearchWalletAddressChange={setSearchWalletAddress}
      />
      {navbarError && (
        <div className={`error-banner${showFilters ? ' error-banner--below-filter' : ''}`}>
          {navbarError}
        </div>
      )}
      {showFilters && (
        <FilterBar
          key={isExploreMode ? 'explore' : 'default'}
          filters={filters}
          onChange={setFilters}
          visible={visibleCount}
          onShuffle={(!isCuratedMode && (isMyChecksMode || isExploreMode || dbMode)) ? handleShuffle : undefined}
          permutations={visiblePermutations}
          curatedMode={isCuratedMode}
          walletOnly={walletOnly}
          onWalletOnlyChange={setWalletOnly}
          isConnected={isConnected}
          hideIdFilter={isCuratedMode || isExploreMode}
          exploreMode={isExploreMode}
          exploreRaw={isExploreMode ? exploreEmptyRaw : undefined}
          onExploreRawChange={isExploreMode ? setExploreEmptyRaw : undefined}
          onExploreSearch={isExploreMode ? explore.search : undefined}
          onExploreClear={isExploreMode ? () => { explore.clear(); setExploreEmptyRaw('') } : undefined}
          exploreLoading={isExploreMode ? explore.loading : undefined}
          exploreError={isExploreMode && explore.error ? explore.error : undefined}
          exploreSearched={isExploreMode ? explore.searched : undefined}
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
      {isCuratedMode && !curatedState.loading && curatedState.outputs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          {walletOnly ? "You haven't liked any outputs yet." : 'No curated outputs yet. Be the first to like one!'}
        </div>
      )}
      {isExploreMode && explore.searched && !explore.loading && explore.permutations.length === 0 && !explore.error && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          No compatible permutations found. Tokens must share the same check count.
        </div>
      )}
      {isExploreMode && !explore.searched && (
        <div className="explore-empty">
          <h2 className="explore-empty__headline">View infinite check permutations</h2>
          <p className="explore-empty__subtitle">Enter up to 10 token IDs to see possible outcomes.</p>
          <form className="explore-empty__form" onSubmit={handleExploreEmptySubmit}>
            <input
              className="explore-empty__input"
              type="text"
              placeholder="e.g. 42, 137, 509, 1024"
              value={exploreEmptyRaw}
              onChange={e => setExploreEmptyRaw(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            <button
              type="submit"
              className="explore-empty__submit"
              disabled={exploreEmptyIdCount < 4 || exploreEmptyIdCount > 10}
            >
              →
            </button>
          </form>
          {exploreEmptyIdCount > 10 && (
            <p className="explore-empty__hint">Max 10 IDs</p>
          )}
        </div>
      )}
      <InfiniteGrid
        permutations={permutations}
        ids={ids}
        showFlags={showFlags}
        hasFilters={showFilters}
        hasError={!!navbarError}
        dbMode={dbMode}
        hideBuy={isMyChecksMode || isSearchWalletMode || isExploreMode}
        filtersTall={false}
        getLikeInfo={dbMode ? getLikeInfo : undefined}
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
