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
  // Cells for a color that's clearly distinguishable from majority AND from
  // the brightCells color (only populated for 3-color patterns where both
  // non-majority colors read as visually distinct) — rendered mid gray.
  dimCells: number[]
  // Cells for whichever non-majority color is most visually distinct from
  // majority — rendered brightest. Not necessarily the classifier's official
  // "minority" (smallest count): a technically-smaller color that's nearly
  // indistinguishable from majority in real RGB terms is folded into the
  // majority/dark tier instead, since it wouldn't read as "the pattern" to
  // the eye. minoritySize/colors (the classifier's own labels) are untouched.
  brightCells: number[]
}

// generateSVGJS always emits background rects first (fill="black" / a 3-digit
// hex like "#111"), then exactly one fill="#RRGGBB" per cell in cell order —
// so matching only 6-digit hex fills yields the 20 cell colors in position order.
const HEX_FILL_RE = /fill="(#[0-9A-Fa-f]{6})"/g

// Below this Euclidean RGB distance, two colors read as "the same" at a
// glance (e.g. #371471 vs #3B088C, distance ~30) — a real Checks palette
// example of "different hue, same practical color" tested against a clearly
// distinct pair (#371471 vs #6AD1DE, distance ~224) puts a safe cutoff here.
const DISTINGUISHABLE_THRESHOLD = 60

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function rgbDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

// Groups hexes into families by mutual RGB proximity (single-linkage —
// same threshold as "reads as the same color", so e.g. 3 shades of blue
// that are each within DISTINGUISHABLE_THRESHOLD of another blue in the
// set all land in one family, chained transitively) rather than by exact
// hex match. Without this, a composite whose majority is rendered across
// several close-but-not-identical shades (common — the engine's gradient/
// branch-inheritance logic rarely produces one single hex across 14+ cells)
// got treated as multiple small color groups instead of one big majority,
// which could wrongly promote a majority shade into looking like a second
// accent color and make genuinely-identical patterns render with different
// dot counts.
function clusterHexes(hexes: string[]): Map<string, number> {
  const unique = [...new Set(hexes)]
  const clusters: string[][] = []
  for (const hex of unique) {
    let bestCluster = -1
    let bestDist = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (const h of clusters[i]) {
        const d = rgbDistance(h, hex)
        if (d < bestDist) { bestDist = d; bestCluster = i }
      }
    }
    if (bestCluster !== -1 && bestDist < DISTINGUISHABLE_THRESHOLD) clusters[bestCluster].push(hex)
    else clusters.push([hex])
  }
  // Greedy single-pass order can leave clusters that are themselves close
  // enough to merge — sweep until stable.
  let merged = true
  while (merged) {
    merged = false
    outer:
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let minDist = Infinity
        for (const a of clusters[i]) for (const b of clusters[j]) minDist = Math.min(minDist, rgbDistance(a, b))
        if (minDist < DISTINGUISHABLE_THRESHOLD) {
          clusters[i] = clusters[i].concat(clusters[j])
          clusters.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  const hexToFamily = new Map<string, number>()
  clusters.forEach((cluster, idx) => cluster.forEach(h => hexToFamily.set(h, idx)))
  return hexToFamily
}

function cellRolesFromSvg(svg: string): { dimCells: number[]; brightCells: number[] } {
  const hexes = [...svg.matchAll(HEX_FILL_RE)].map(m => m[1])
  if (hexes.length !== 20) return { dimCells: [], brightCells: [] }  // not a 20-check composite

  const hexToFamily = clusterHexes(hexes)
  const cellsByFamily = new Map<number, number[]>()
  const hexesByFamily = new Map<number, Set<string>>()
  hexes.forEach((hex, i) => {
    const family = hexToFamily.get(hex)!
    const cells = cellsByFamily.get(family) ?? []
    cells.push(i)
    cellsByFamily.set(family, cells)
    const hexSet = hexesByFamily.get(family) ?? new Set<string>()
    hexSet.add(hex)
    hexesByFamily.set(family, hexSet)
  })

  const sortedFamilies = [...cellsByFamily.entries()].sort((a, b) => b[1].length - a[1].length)
  const majorityFamily = sortedFamilies[0][0]
  const majorityHexes = hexesByFamily.get(majorityFamily)!

  // Every non-majority family, ranked by how visually distinct it is from
  // majority — most distinct first, so a single accent tier always picks
  // the one that actually reads as "the pattern". Distance between families
  // is the closest pair across them (consistent with the clustering above).
  const candidates = sortedFamilies.slice(1)
    .map(([family, cells]) => {
      let distance = Infinity
      for (const h1 of hexesByFamily.get(family)!) for (const h2 of majorityHexes) distance = Math.min(distance, rgbDistance(h1, h2))
      return { cells, distance }
    })
    .sort((a, b) => b.distance - a.distance)

  const distinguishable = candidates.filter(c => c.distance >= DISTINGUISHABLE_THRESHOLD)
  // Guarantee at least one accent tier even if nothing clears the threshold
  // (e.g. an unusually low-contrast palette) — an all-dark silhouette reads
  // as broken, not as "no pattern".
  const included = distinguishable.length > 0 ? distinguishable : candidates.slice(0, 1)

  return {
    brightCells: included[0] ? included[0].cells : [],
    dimCells:    included[1] ? included[1].cells : [],
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
          const { dimCells, brightCells } = cellRolesFromSvg(preview.nodeAbcd.svg)
          built.push({
            patternKey:   e.patternKey,
            minoritySize: e.minoritySize,
            nColors:      e.nColors,
            colors:       e.colors,
            recipeCount:  e.recipeCount,
            preview,
            dimCells,
            brightCells,
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
