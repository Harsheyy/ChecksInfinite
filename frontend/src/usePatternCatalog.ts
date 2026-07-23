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
  // Cell indices (0-19) for the "third" color — non-empty only for 3-color
  // patterns. Rendered as a mid gray in the silhouette, distinct from both
  // the majority (dark) and the true minority (white/brightest — "the
  // pattern" the recipe count refers to).
  thirdCells: number[]
  // Cell indices for the minority color — the classifier's official
  // "N-check minority", same definition as the pattern's own label text.
  minorityCells: number[]
}

// generateSVGJS always emits background rects first (fill="black" / a 3-digit
// hex like "#111"), then exactly one fill="#RRGGBB" per cell in cell order —
// so matching only 6-digit hex fills yields the 20 cell colors in position order.
const HEX_FILL_RE = /fill="(#[0-9A-Fa-f]{6})"/g

function cellRolesFromSvg(svg: string): { thirdCells: number[]; minorityCells: number[] } {
  const hexes = [...svg.matchAll(HEX_FILL_RE)].map(m => m[1])
  if (hexes.length !== 20) return { thirdCells: [], minorityCells: [] }  // not a 20-check composite

  const counts = new Map<string, number>()
  for (const h of hexes) counts.set(h, (counts.get(h) ?? 0) + 1)
  // Same sort direction classify() uses server-side: descending by count,
  // so the last entry is always the official minority (smallest count).
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const minorityHex = sorted[sorted.length - 1][0]
  const thirdHex = sorted.length === 3 ? sorted[1][0] : null

  const cellsOf = (hex: string) => hexes.reduce<number[]>((cells, h, i) => (h === hex ? [...cells, i] : cells), [])
  return {
    thirdCells:    thirdHex ? cellsOf(thirdHex) : [],
    minorityCells: cellsOf(minorityHex),
  }
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
          const { thirdCells, minorityCells } = cellRolesFromSvg(preview.nodeAbcd.svg)
          built.push({
            patternKey:   e.patternKey,
            minoritySize: e.minoritySize,
            nColors:      e.nColors,
            colors:       e.colors,
            recipeCount:  e.recipeCount,
            preview,
            thirdCells,
            minorityCells,
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
