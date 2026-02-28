// frontend/src/App.tsx
import { useState, useMemo, useEffect } from 'react'
import { Navbar } from './components/Navbar'
import { FilterBar, emptyFilters, matchesFilters, type Filters } from './components/FilterBar'
import { InfiniteGrid } from './components/InfiniteGrid'
import { useAllPermutations } from './useAllPermutations'
import { usePermutationsDB } from './usePermutationsDB'
import { hasSupabase } from './supabaseClient'
import { hasAlchemyKey } from './client'
import { parseIds, validateIds } from './utils'

export default function App() {
  const dbMode = hasSupabase()

  // ── Chain mode state ──────────────────────────────────────────────────────
  const [idsRaw, setIdsRaw] = useState('')
  const [validationError, setValidationError] = useState('')
  const { state: chainState, preview } = useAllPermutations()

  // ── Shared filter state ───────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(emptyFilters())

  // ── DB mode ───────────────────────────────────────────────────────────────
  const { state: dbState, load, loadRandom } = usePermutationsDB()

  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  // Load on mount and whenever filters change
  useEffect(() => {
    if (!dbMode) return
    if (hasActiveFilters) load(filters)
    else loadRandom()
  }, [dbMode, filters])   // eslint-disable-line react-hooks/exhaustive-deps

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
    loadRandom()
  }

  // ── Derive display values ─────────────────────────────────────────────────
  const permutations = dbMode ? dbState.permutations : chainState.permutations
  const isLoading    = dbMode ? dbState.loading       : chainState.permutations.some(p => p.nodeAbcd.loading)

  // Chain mode: filter client-side. DB mode: already filtered server-side.
  const showFlags = dbMode
    ? permutations.map(() => true)
    : permutations.map(p =>
        !p.nodeAbcd.loading && !p.nodeAbcd.error
          ? matchesFilters(p.nodeAbcd.attributes, filters)
          : true
      )
  const visibleCount     = showFlags.filter(Boolean).length
  const showFilters      = dbMode
    ? dbState.total > 0 || dbState.loading || hasActiveFilters
    : permutations.length > 0

  const navbarError = dbMode
    ? (dbState.error || '')
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
      />
      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          visible={dbMode ? dbState.permutations.length : visibleCount}
          onShuffle={dbMode && !hasActiveFilters ? handleShuffle : undefined}
        />
      )}
      {dbMode && !dbState.loading && hasActiveFilters && dbState.total === 0 && (
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
      />
      {dbMode && dbState.loading && (
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
