// frontend/src/usePatternLayouts.ts
//
// Cell-layout-consolidated pattern data for the Patterns tab's paint-grid
// composer — replaces usePatternCatalog's flat per-color-pair list. Colors
// are nested as "variations" under each layout instead of being part of
// the pattern's identity, so drawing cells 7/8/10/13 surfaces one card
// covering every color pair ever found for that exact layout, not one
// visually-indistinguishable card per color.
//
// Unlike usePatternCatalog (which eagerly attachChecks's every entry's
// preview on load), this fetches only the lean index up front — no struct/
// SVG data — and loads a specific variation's recipes on demand only when
// the user opens it, via loadVariationRecipes.
import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { attachChecks, rowToPermutationResult, type PermRowBasic } from './usePermutationsDB'
import type { PermutationResult } from './useAllPermutations'

// Wire format from build-layouts-index.ts: short keys, recipes as raw
// [k1,b1,k2,b2] tuples (no struct/SVG data — fetched on demand).
interface WireVariation { c: [string, string]; n: number; r: [number, number, number, number][] }
interface WireLayout { c: number[]; m: number; nv: number; nr: number; v: WireVariation[] }

export interface PatternVariation {
  colors: [string, string]
  recipeCount: number
  recipes: [number, number, number, number][]
}
export interface PatternLayout {
  cells: number[]
  minoritySize: number
  variety: number
  totalRecipes: number
  variations: PatternVariation[]
}

// `enabled` defers the fetch (a multi-MB index) until it's actually
// needed — landing on the Patterns tab shouldn't pull it down before the
// user has even started drawing a query.
export function usePatternLayouts(enabled: boolean) {
  const [layouts, setLayouts] = useState<PatternLayout[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!supabase || !enabled || layouts.length > 0) return
    let cancelled = false
    setLoading(true)
    setError('')

    ;(async () => {
      try {
        const { data } = supabase.storage.from('pattern-catalog').getPublicUrl('layouts.json')
        const res = await fetch(data.publicUrl)
        if (!res.ok) throw new Error(`layouts.json fetch failed: ${res.status}`)
        const wire = await res.json() as WireLayout[]
        if (cancelled) return
        setLayouts(wire.map(l => ({
          cells: l.c,
          minoritySize: l.m,
          variety: l.nv,
          totalRecipes: l.nr,
          variations: l.v.map(v => ({ colors: v.c, recipeCount: v.n, recipes: v.r })),
        })))
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [enabled])

  return { layouts, loading, error }
}

// Fetches real check_struct/SVG data for a variation's recipes on demand —
// same attachChecks/rowToPermutationResult pipeline every other feed uses,
// so the resulting PermutationResult[] renders through the existing
// InfiniteGrid/TreePanel flow (mint button, listed-count badge, etc.) with
// no special-casing.
export async function loadVariationRecipes(variation: PatternVariation): Promise<PermutationResult[]> {
  return loadRecipeTuples(variation.recipes)
}

// Same pipeline, but batches every variation's recipes across an entire
// layout into one fetch — clicking a layout card shows every real output
// for that cell arrangement in one go, regardless of color pair, instead
// of making the user pick a color pair first.
export async function loadLayoutRecipes(layout: PatternLayout): Promise<PermutationResult[]> {
  return loadRecipeTuples(layout.variations.flatMap(v => v.recipes))
}

async function loadRecipeTuples(recipes: [number, number, number, number][]): Promise<PermutationResult[]> {
  if (!supabase) return []
  const rows: PermRowBasic[] = recipes.map(([k1, b1, k2, b2]) => ({
    keeper_1_id: k1, burner_1_id: b1, keeper_2_id: k2, burner_2_id: b2,
    abcd_checks: 20, abcd_color_band: null, abcd_gradient: null, abcd_speed: null, abcd_shift: null,
    total_cost: null,
  }))
  const attached = await attachChecks(rows)
  return attached.map(row => ({ ...rowToPermutationResult(row), fromTokenWorks: false }))
}
