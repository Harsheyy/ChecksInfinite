// frontend/src/usePatternCatalog.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import { attachChecks, rowToPermutationResult, type PermRowBasic } from './usePermutationsDB'
import type { PermutationResult } from './useAllPermutations'

interface PatternRecipe {
  keeper_1_id: number
  burner_1_id: number
  keeper_2_id: number
  burner_2_id: number
  abcd_checks: number
  abcd_color_band: string | null
  abcd_gradient: string | null
  abcd_speed: string | null
  abcd_shift: string | null
  total_cost: number | null
}

interface PatternCatalogEntry {
  patternKey: string
  minoritySize: number
  nColors: 2 | 3
  colors: string[]
  recipeCount: number
  recipes: PatternRecipe[]
}

export interface BrowsePattern {
  patternKey: string
  minoritySize: number
  nColors: 2 | 3
  colors: string[]
  recipeCount: number
  preview: PermutationResult
}

function recipeToRow(r: PatternRecipe): PermRowBasic {
  return {
    keeper_1_id: r.keeper_1_id,
    burner_1_id: r.burner_1_id,
    keeper_2_id: r.keeper_2_id,
    burner_2_id: r.burner_2_id,
    abcd_checks: r.abcd_checks,
    abcd_color_band: r.abcd_color_band,
    abcd_gradient: r.abcd_gradient,
    abcd_speed: r.abcd_speed,
    abcd_shift: r.abcd_shift,
    total_cost: r.total_cost,
  }
}

export function usePatternCatalog() {
  const [patterns, setPatterns] = useState<BrowsePattern[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const catalogRef = useRef<Map<string, PatternCatalogEntry>>(new Map())

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    setError('')

    ;(async () => {
      try {
        const { data } = supabase.storage.from('pattern-catalog').getPublicUrl('patterns.json')
        const res = await fetch(data.publicUrl)
        if (!res.ok) throw new Error(`patterns.json fetch failed: ${res.status}`)
        const entries = await res.json() as PatternCatalogEntry[]
        if (cancelled) return

        for (const e of entries) catalogRef.current.set(e.patternKey, e)

        // Build one PermutationResult per pattern (its cheapest recipe) in a
        // single batched attachChecks call — not one DB round-trip per pattern.
        // attachChecks silently DROPS rows whose 4 structs aren't all found
        // (e.g. a token burned since the catalog was built), so `attached`
        // can be shorter than `entries` — match back by token-ID key, never
        // by array index, or later patterns silently get the wrong preview.
        const key = (r: { keeper_1_id: number; burner_1_id: number; keeper_2_id: number; burner_2_id: number }) =>
          `${r.keeper_1_id},${r.burner_1_id},${r.keeper_2_id},${r.burner_2_id}`

        const firstRows = entries.map(e => recipeToRow(e.recipes[0]))
        const attached  = await attachChecks(firstRows)
        const previewByKey = new Map(
          attached.map(row => [key(row), { ...rowToPermutationResult(row), fromTokenWorks: false }])
        )

        if (cancelled) return
        const built: BrowsePattern[] = []
        for (const e of entries) {
          const preview = previewByKey.get(key(e.recipes[0]))
          if (!preview) continue  // preview recipe's tokens no longer resolvable — skip
          built.push({
            patternKey:   e.patternKey,
            minoritySize: e.minoritySize,
            nColors:      e.nColors,
            colors:       e.colors,
            recipeCount:  e.recipeCount,
            preview,
          })
        }
        setPatterns(built)
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [])

  const loadPatternRecipes = useCallback(async (patternKey: string): Promise<PermutationResult[]> => {
    const entry = catalogRef.current.get(patternKey)
    if (!entry) return []
    const rows = await attachChecks(entry.recipes.map(recipeToRow))
    return rows.map(row => ({ ...rowToPermutationResult(row), fromTokenWorks: false }))
  }, [])

  return { patterns, loading, error, loadPatternRecipes }
}
