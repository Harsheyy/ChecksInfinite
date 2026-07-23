// frontend/src/components/PatternsBrowse.tsx
import { useState } from 'react'
import { usePatternCatalog, type BrowsePattern } from '../usePatternCatalog'
import { InfiniteGrid } from './InfiniteGrid'
import type { PermutationResult } from '../useAllPermutations'

function PatternSwatch({ pattern, onClick }: { pattern: BrowsePattern; onClick: () => void }) {
  const svg = pattern.preview.nodeAbcd.svg
  return (
    <div className="pattern-swatch" onClick={onClick}>
      {svg
        ? <div className="pattern-swatch-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        : <div className="perm-card-pulse" />}
      <div className="pattern-swatch-badge">×{pattern.recipeCount}</div>
    </div>
  )
}

export function PatternsBrowse() {
  const { patterns, loading, error, loadPatternRecipes } = usePatternCatalog()
  const [selected, setSelected]   = useState<BrowsePattern | null>(null)
  const [recipes, setRecipes]     = useState<PermutationResult[]>([])
  const [recipesLoading, setRecipesLoading] = useState(false)

  async function openPattern(p: BrowsePattern) {
    setSelected(p)
    setRecipesLoading(true)
    const r = await loadPatternRecipes(p.patternKey)
    setRecipes(r)
    setRecipesLoading(false)
  }

  if (error) {
    return <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>{error}</div>
  }

  if (selected) {
    return (
      <>
        <div className="pattern-detail-header">
          <button type="button" className="pattern-detail-back" onClick={() => setSelected(null)}>← Back to patterns</button>
          <span>{selected.nColors} colors · {selected.minoritySize}-check minority · {selected.recipeCount} recipe{selected.recipeCount === 1 ? '' : 's'}</span>
        </div>
        {recipesLoading ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>Loading recipes…</div>
        ) : (
          <InfiniteGrid
            permutations={recipes}
            ids={[]}
            showFlags={recipes.map(() => true)}
            hasFilters={false}
            dbMode={true}
            hideBuy={true}
          />
        )}
      </>
    )
  }

  return (
    <div className="pattern-browse-grid">
      {loading && <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>Loading patterns…</div>}
      {!loading && patterns.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#666' }}>
          No patterns catalogued yet.
        </div>
      )}
      {patterns.map(p => (
        <PatternSwatch key={p.patternKey} pattern={p} onClick={() => openPattern(p)} />
      ))}
    </div>
  )
}
