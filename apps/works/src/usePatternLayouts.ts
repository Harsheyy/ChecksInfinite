// apps/works/src/usePatternLayouts.ts
//
// Query-backed access to the pattern library (tables `pattern_layouts` /
// `pattern_variations`, migration 056).
//
// This used to fetch layouts.json — a 38.9 MB blob holding every layout, its
// colour variations and their recipes — and scan it in memory on each keystroke
// of the paint grid. Making that blob downloadable at all meant capping each
// layout at 4 colour variations x 3 recipes at build time, which discarded 68%
// of the variations and 72% of the recipes the hunts found. Both halves now
// live in Postgres, uncapped: cell matching is one `search_pattern_layouts`
// call and a layout's recipes are fetched only when it is opened.
import { useState, useEffect } from 'react'
import { supabase } from '@checks-wiki/shared'
import { attachChecks, rowToPermutationResult, type PermRowBasic } from './usePermutationsDB'
import type { PermutationResult } from './useAllPermutations'

// Cap on recipes materialised for one opened layout. The library holds every
// one (the busiest layout has ~7k); this is what a single grid view can
// usefully render, and get_pattern_layout_recipes returns the most-hit colour
// pairs first.
const RECIPES_PER_LAYOUT = 500

// Debounce on the paint grid: toggling a cell re-queries, and a user painting a
// 6-cell shape would otherwise fire six round-trips for five throwaway states.
const SEARCH_DEBOUNCE_MS = 180

export interface PatternLayout {
  cells: number[]
  cellsKey: string
  minoritySize: number
  variety: number       // distinct colour pairs known for this layout
  totalRecipes: number  // distinct live recipes across all those pairs
  overlap: number       // painted cells this layout covers
  isExact: boolean
}

interface LayoutRow {
  cells_key: string
  cells_mask: number
  minority_size: number
  variety: number
  total_recipes: number
  overlap: number
  is_exact: boolean
}

function cellsToMask(cells: number[]): number {
  return cells.reduce((m, c) => m | (1 << c), 0)
}

function rowToLayout(r: LayoutRow): PatternLayout {
  return {
    cells: r.cells_key.split(',').map(Number),
    cellsKey: r.cells_key,
    minoritySize: r.minority_size,
    variety: r.variety,
    totalRecipes: r.total_recipes,
    overlap: r.overlap,
    isExact: r.is_exact,
  }
}

// `enabled` mirrors the old hook's deferral: no query runs until the selection
// is actually searchable.
export function usePatternLayouts(cells: number[], enabled: boolean) {
  const [layouts, setLayouts] = useState<PatternLayout[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Keyed on the mask, not the array: a re-render handing back an equal-but-new
  // array must not re-fire the query.
  const mask = cellsToMask(cells)

  useEffect(() => {
    if (!supabase || !enabled || mask === 0) { setLayouts([]); return }
    let cancelled = false
    setLoading(true)
    setError('')

    const timer = setTimeout(() => {
      supabase!
        .rpc('search_pattern_layouts', { p_mask: mask, p_limit: 60 })
        .then(({ data, error: rpcError }) => {
          if (cancelled) return
          if (rpcError) setError(rpcError.message)
          else setLayouts(((data ?? []) as LayoutRow[]).map(rowToLayout))
          setLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [mask, enabled])

  return { layouts, loading, error }
}

// Fetches a layout's recipes across every colour variation it has, then runs
// them through the same attachChecks/rowToPermutationResult pipeline every
// other feed uses — so the result renders through the existing InfiniteGrid/
// TreePanel flow (mint button, listed-count badge, etc.) with no special-casing.
export async function loadLayoutRecipes(layout: PatternLayout): Promise<PermutationResult[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('get_pattern_layout_recipes', {
    p_cells_key: layout.cellsKey,
    p_limit: RECIPES_PER_LAYOUT,
  })
  if (error) throw error

  const rows: PermRowBasic[] = ((data ?? []) as { keeper_1_id: number; burner_1_id: number; keeper_2_id: number; burner_2_id: number }[])
    .map(r => ({
      keeper_1_id: r.keeper_1_id, burner_1_id: r.burner_1_id,
      keeper_2_id: r.keeper_2_id, burner_2_id: r.burner_2_id,
      abcd_checks: 20, abcd_color_band: null, abcd_gradient: null, abcd_speed: null, abcd_shift: null,
      total_cost: null,
    }))

  const attached = await attachChecks(rows)
  return attached.map(row => ({ ...rowToPermutationResult(row), fromTokenWorks: false }))
}
