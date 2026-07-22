// frontend/src/App.tsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAccount, useReadContracts } from 'wagmi'
import { formatEther } from 'viem'
import { Navbar } from './components/Navbar'
import { FilterBar, emptyFilters, matchesFilters, type Filters } from './components/FilterBar'
import { InfiniteGrid } from './components/InfiniteGrid'
import { useAllPermutations } from './useAllPermutations'
import type { PermutationResult } from './useAllPermutations'
import { usePermutationsDB, fetchCheckStructMap } from './usePermutationsDB'
import { hasSupabase, supabase } from './supabaseClient'
import { hasAlchemyKey } from './client'
import { parseIds, validateIds } from './utils'
import { tokenStrategyAbi, TOKEN_STRATEGY_ADDRESS } from './tokenStrategyAbi'
import { useWalletTracking } from './useWalletTracking'
import { useCuratedOutputs, type CuratedPermutationResult } from './useCuratedOutputs'
import { useMyLikedKeys, likedKey } from './useMyLikedKeys'
import type { LikeInfo } from './components/PermutationCard'
import { SearchPage } from './components/SearchPage'
import { useAllChecksPermutations } from './useAllChecksPermutations'

type FeedSource = 'token-works' | 'opensea'

export default function App() {
  const dbMode = hasSupabase()
  const { address, isConnected } = useAccount()
  useWalletTracking(address, isConnected)

  // ── View mode — derived from the URL path ───────────────────────────────────
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const viewMode: 'explore' | 'search' | 'curated' =
    pathname === '/curated' ? 'curated' : pathname === '/search' ? 'search' : 'explore'
  const feedSource: FeedSource = pathname === '/opensea' ? 'opensea' : 'token-works'
  const [walletOnly, setWalletOnly] = useState(false)

  // Clicking "Explore" returns to whichever source the user last browsed
  const lastExploreSource = useRef<FeedSource>(feedSource)
  useEffect(() => {
    if (viewMode === 'explore') lastExploreSource.current = feedSource
  }, [viewMode, feedSource])

  const handleViewModeChange = useCallback((mode: 'explore' | 'search' | 'curated') => {
    navigate(mode === 'explore'
      ? (lastExploreSource.current === 'opensea' ? '/opensea' : '/')
      : `/${mode}`)
  }, [navigate])

  const handleFeedSourceChange = useCallback((v: FeedSource) => {
    navigate(v === 'opensea' ? '/opensea' : '/')
  }, [navigate])

  // ── Chain mode state ──────────────────────────────────────────────────────
  const [idsRaw, setIdsRaw] = useState('')
  const [validationError, setValidationError] = useState('')
  const { state: chainState, preview } = useAllPermutations()

  // ── Shared filter state ───────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(emptyFilters())

  // ── URL ⇄ state sync ──────────────────────────────────────────────────────
  // Read once on first render: URL is the source of truth for a shared link.
  const didInitFromUrl = useRef(false)
  useEffect(() => {
    if (didInitFromUrl.current) return
    didInitFromUrl.current = true
    const f = emptyFilters()
    f.checks    = searchParams.get('checks')   ?? ''
    f.colorBand = searchParams.get('band')     ?? ''
    f.gradient  = searchParams.get('gradient') ?? ''
    f.speed     = searchParams.get('speed')    ?? ''
    f.shift     = searchParams.get('shift')    ?? ''
    f.priceMin  = searchParams.get('pmin')     ?? ''
    f.priceMax  = searchParams.get('pmax')     ?? ''
    const idsParam = searchParams.get('ids')
    if (idsParam) f.selectedIds = idsParam.split(',').filter(s => /^\d+$/.test(s))
    setFilters(f)
    if (searchParams.get('mine') === '1') setWalletOnly(true)
  }, [searchParams])

  // Write back on change (replace — filter tweaks shouldn't pile up history).
  // Only touches its own keys, so `recipe` survives untouched.
  useEffect(() => {
    if (!didInitFromUrl.current) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      const setOrDel = (k: string, v: string) => { if (v) next.set(k, v); else next.delete(k) }
      setOrDel('checks',   filters.checks)
      setOrDel('band',     filters.colorBand)
      setOrDel('gradient', filters.gradient)
      setOrDel('speed',    filters.speed)
      setOrDel('shift',    filters.shift)
      setOrDel('ids',      filters.selectedIds.join(','))
      setOrDel('pmin',     filters.priceMin)
      setOrDel('pmax',     filters.priceMax)
      setOrDel('mine',     walletOnly ? '1' : '')
      return next.toString() === prev.toString() ? prev : next
    }, { replace: true })
  }, [filters, walletOnly, setSearchParams])

  // Recipe deep link: ?recipe=k1,b1,k2,b2 opens that output's tree panel
  const recipeParam = searchParams.get('recipe')
  const initialRecipeIds = useMemo(() => {
    if (!recipeParam) return null
    const parts = recipeParam.split(',')
    return parts.length === 4 && parts.every(p => /^\d+$/.test(p)) ? parts : null
  }, [recipeParam])

  const handleSelectedRecipeChange = useCallback((tokenIds: string[] | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (tokenIds) next.set('recipe', tokenIds.join(','))
      else next.delete('recipe')
      return next.toString() === prev.toString() ? prev : next
    }, { replace: true })
  }, [setSearchParams])

  // ── DB / Token Works feed ─────────────────────────────────────────────────
  const { state: dbState, loadRandom, shuffle: shuffleDB } = usePermutationsDB()

  useEffect(() => {
    if (!dbMode || viewMode !== 'explore') return
    loadRandom()
  }, [dbMode, viewMode])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Market (OpenSea) feed — loaded on demand when the OpenSea source is selected ──
  const { state: allChecksState, load: loadAllChecks, shuffle: shuffleAllChecks } = useAllChecksPermutations()

  useEffect(() => {
    if (!dbMode || viewMode !== 'explore' || feedSource !== 'opensea') return
    if (allChecksState.permutations.length > 0 || allChecksState.loading) return
    loadAllChecks()
  }, [dbMode, viewMode, feedSource])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Curated mode ──────────────────────────────────────────────────────────
  const { state: curatedState, load: loadCurated } = useCuratedOutputs()

  // ── Like state ────────────────────────────────────────────────────────────
  const { likedKeys, setLikedKeys } = useMyLikedKeys(address?.toLowerCase())
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    if (!dbMode || viewMode !== 'curated') return
    loadCurated(filters, walletOnly, address?.toLowerCase())
  }, [dbMode, viewMode, walletOnly, filters.checks, filters.colorBand, filters.gradient, filters.speed, filters.shift])  // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleShuffle() {
    if (viewMode === 'explore') {
      if (feedSource === 'opensea') shuffleAllChecks()
      else shuffleDB()
    }
  }

  async function handleToggleLike(result: PermutationResult, source: 'explore' | 'curated' | 'search') {
    if (!address || !supabase) return
    const [k1, b1, k2, b2] = result.def.tokenIds!
    const key = likedKey(k1, b1, k2, b2)
    const wallet = address.toLowerCase()
    const rpcSource = source === 'search' ? 'search' : feedSource // 'token-works' or 'opensea' for explore and curated

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

    let p_k1_struct = null
    let p_b1_struct = null
    let p_k2_struct = null
    let p_b2_struct = null

    if (!wasLiked && source !== 'curated') {
      const structMap = await fetchCheckStructMap([k1, b1, k2, b2].map(Number))
      p_k1_struct = structMap.get(parseInt(k1)) ?? null
      p_b1_struct = structMap.get(parseInt(b1)) ?? null
      p_k2_struct = structMap.get(parseInt(k2)) ?? null
      p_b2_struct = structMap.get(parseInt(b2)) ?? null
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

  function getLikeInfo(result: PermutationResult, source: 'explore' | 'curated' | 'search' = viewMode as 'explore' | 'curated' | 'search'): LikeInfo | undefined {
    if (!dbMode) return undefined
    const isCurated = source === 'curated'
    const [k1, b1, k2, b2] = result.def.tokenIds ?? []
    if (!k1 || !b1 || !k2 || !b2) return undefined
    const key = likedKey(k1, b1, k2, b2)
    return {
      isLiked:    likedKeys.has(key),
      likeCount:  isCurated ? (likeCounts.get(key) ?? 0) : undefined,
      alwaysShow: isCurated,
      canLike:    isConnected,
      onLike:     isConnected ? () => handleToggleLike(result, source) : () => {},
    }
  }

  // ── Derive display values ─────────────────────────────────────────────────
  const isExploreMode    = dbMode && viewMode === 'explore'
  const isSearchMode     = dbMode && viewMode === 'search'
  const isCuratedMode    = dbMode && viewMode === 'curated'

  // Feed for the Explore tab
  const feedPermutations = useMemo<PermutationResult[]>(() => {
    if (feedSource === 'opensea') return allChecksState.permutations
    return dbState.permutations
  }, [feedSource, dbState.permutations, allChecksState.permutations])

  const permutations = isCuratedMode
    ? curatedState.outputs
    : isExploreMode
      ? feedPermutations
      : dbMode ? feedPermutations : chainState.permutations

  const isLoading = isCuratedMode
    ? curatedState.loading
    : isExploreMode
      ? (feedSource === 'opensea' ? allChecksState.loading : dbState.loading)
      : dbMode ? dbState.loading : chainState.permutations.some(p => p.nodeAbcd.loading)

  // ── Price filter ──────────────────────────────────────────────────────────
  // Token Works: prices from TokenStrategy contract (on-chain, bigint wei)
  // OpenSea:     prices from DB total_cost column (ETH float, pre-summed)
  const priceFilterEnabled = dbMode && isExploreMode && feedSource === 'token-works'

  const uniqueTokenIds = useMemo(() => {
    if (!priceFilterEnabled) return []
    const set = new Set<string>()
    for (const p of permutations) {
      for (const id of p.def.tokenIds ?? []) set.add(id)
    }
    return Array.from(set)
  }, [priceFilterEnabled, permutations])

  const { data: priceResults } = useReadContracts({
    contracts: uniqueTokenIds.map(id => ({
      address: TOKEN_STRATEGY_ADDRESS,
      abi: tokenStrategyAbi,
      functionName: 'nftForSale' as const,
      args: [BigInt(id)] as const,
    })),
    query: { enabled: priceFilterEnabled && uniqueTokenIds.length > 0 },
  })

  const tokenPriceMap = useMemo(() => {
    const map = new Map<string, bigint>()
    if (!priceResults) return map
    uniqueTokenIds.forEach((id, i) => {
      const r = priceResults[i]?.result as bigint | undefined
      if (r !== undefined) map.set(id, r)
    })
    return map
  }, [priceResults, uniqueTokenIds])

  const priceRange = useMemo(() => {
    if (!tokenPriceMap.size) return undefined
    let minCost = Infinity, maxCost = -Infinity
    for (const p of permutations) {
      const tids = p.def.tokenIds
      if (!tids || tids.length !== 4) continue
      const prices = tids.map(id => tokenPriceMap.get(id))
      if (!prices.every(p => p !== undefined)) continue
      const total = prices.reduce((sum, p) => sum + Number(formatEther(p!)), 0)
      minCost = Math.min(minCost, total)
      maxCost = Math.max(maxCost, total)
    }
    if (minCost === Infinity) return undefined
    return { min: minCost, max: maxCost }
  }, [tokenPriceMap, permutations])

  // OpenSea price range — derived directly from total_cost (ETH, pre-summed in DB)
  const openSeaPriceRange = useMemo(() => {
    if (feedSource !== 'opensea' || !isExploreMode) return undefined
    let min = Infinity, max = -Infinity
    for (const p of feedPermutations) {
      if (p.total_cost == null) continue
      min = Math.min(min, p.total_cost)
      max = Math.max(max, p.total_cost)
    }
    return min === Infinity ? undefined : { min, max }
  }, [feedSource, isExploreMode, feedPermutations])

  const showFlags = permutations.map(p => {
    if (p.nodeAbcd.loading || p.nodeAbcd.error) return true
    const [p0, p1, p2, p3] = p.def.indices
    const tids = p.def.tokenIds ?? [ids[p0], ids[p1], ids[p2], ids[p3]]
    if (!matchesFilters(p.nodeAbcd.attributes, filters, tids)) return false
    if (filters.priceMin || filters.priceMax) {
      if (p.fromTokenWorks === false) {
        // OpenSea: use pre-summed total_cost (ETH)
        if (p.total_cost != null) {
          if (filters.priceMin && parseFloat(filters.priceMin) > p.total_cost) return false
          if (filters.priceMax && parseFloat(filters.priceMax) < p.total_cost) return false
        }
      } else if (tids.length === 4) {
        // Token Works: sum from TokenStrategy contract (wei)
        const prices = tids.map(id => tokenPriceMap.get(id))
        if (prices.every(p => p !== undefined)) {
          const total = prices.reduce((sum, p) => sum + Number(formatEther(p!)), 0)
          if (filters.priceMin && parseFloat(filters.priceMin) > total) return false
          if (filters.priceMax && parseFloat(filters.priceMax) < total) return false
        }
      }
    }
    return true
  })

  const visibleCount = showFlags.filter(Boolean).length
  const visiblePermutations = permutations.filter((_, i) => showFlags[i])

  const showFilters = isCuratedMode
    ? curatedState.outputs.length > 0 || curatedState.loading
    : isExploreMode
      ? feedPermutations.length > 0 || isLoading || feedSource === 'opensea'
      : permutations.length > 0

  const navbarError = dbMode
    ? (dbState.error || allChecksState.error || '')
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
        onViewModeChange={dbMode ? handleViewModeChange : undefined}
      />
      {isSearchMode ? (
        isConnected ? (
          <SearchPage
            getLikeInfo={dbMode ? (r, source) => getLikeInfo(r, source) : undefined}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '6rem 1.5rem', color: '#888' }}>
            <div style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#ccc' }}>
              Connect your wallet
            </div>
            <div style={{ fontSize: '0.85rem', marginBottom: '1.5rem', maxWidth: '28rem', marginLeft: 'auto', marginRight: 'auto' }}>
              You need to connect your wallet to use Search.
            </div>
            <button
              type="button"
              className="nav-wallet"
              onClick={async () => {
                const { openWalletModal } = await import('./appkit')
                await openWalletModal('Connect')
              }}
            >
              Connect Wallet
            </button>
          </div>
        )
      ) : (
        <>
          {navbarError && (
            <div className={`error-banner${showFilters ? ' error-banner--below-filter' : ''}`}>
              {navbarError}
            </div>
          )}
          {showFilters && (
            <FilterBar
              key={'default'}
              filters={filters}
              onChange={setFilters}
              visible={visibleCount}
              onShuffle={(!isCuratedMode && (isExploreMode || dbMode)) ? handleShuffle : undefined}
              permutations={visiblePermutations}
              curatedMode={isCuratedMode}
              walletOnly={walletOnly}
              onWalletOnlyChange={setWalletOnly}
              isConnected={isConnected}
              hideIdFilter={isCuratedMode}
              priceRange={feedSource === 'opensea' ? openSeaPriceRange : priceRange}
              feedSource={isExploreMode ? feedSource : undefined}
              onFeedSourceChange={isExploreMode ? handleFeedSourceChange : undefined}
            />
          )}
          {isCuratedMode && !curatedState.loading && curatedState.outputs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
              {walletOnly ? "You haven't liked any outputs yet." : 'No curated outputs yet. Be the first to like one!'}
            </div>
          )}
          {isExploreMode && feedSource === 'opensea' && !allChecksState.loading && allChecksState.permutations.length === 0 && !allChecksState.error && (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
              No fully purchasable combos right now — prices refresh hourly as listings change on OpenSea.
            </div>
          )}
          <InfiniteGrid
            permutations={permutations}
            ids={ids}
            showFlags={showFlags}
            hasFilters={showFilters}
            hasError={!!navbarError}
            dbMode={dbMode}
            hideBuy={isExploreMode && feedSource !== 'token-works'}
            filtersTall={false}
            getLikeInfo={dbMode ? getLikeInfo : undefined}
            tokenPriceMap={tokenPriceMap}
            initialSelectedIds={dbMode ? initialRecipeIds : null}
            onSelectedChange={dbMode ? handleSelectedRecipeChange : undefined}
          />
          {(dbMode && isLoading) && (
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
      )}
    </>
  )
}
