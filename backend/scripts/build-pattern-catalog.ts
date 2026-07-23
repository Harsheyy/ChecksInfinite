/**
 * build-pattern-catalog.ts
 *
 * Scans all_permutations for 20-check composites whose rendered pattern
 * uses <=3 unique hex colors with a 3-6 cell minority cluster, groups
 * matches by visual pattern signature, and uploads patterns.json to the
 * public `pattern-catalog` Storage bucket.
 *
 * Not automated — all_permutations itself has no nightly refresh (see
 * README.md); re-run this manually after each `npm run populate-market`.
 *
 * Usage: npm run build-pattern-catalog
 */

import { createClient } from '@supabase/supabase-js'
import {
  checkStructFromJSON,
  simulateCompositeJS,
  computeL2,
  buildL2RenderMap,
  colorIndexes,
  EIGHTY_COLORS,
  mapCheckAttributes,
  type CheckStruct,
  type CheckStructJSON,
} from '../lib/engine.js'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const PAGE_SIZE            = 1000
const MAX_SCANNED          = 300_000  // safety cap on all_permutations rows scanned
const MAX_RECIPES_PER_PATTERN = 20

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY in backend/.env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface PermRow {
  keeper_1_id: number
  burner_1_id: number
  keeper_2_id: number
  burner_2_id: number
  abcd_checks: number | null
  abcd_color_band: string | null
  abcd_gradient: string | null
  abcd_speed: string | null
  abcd_shift: string | null
  total_cost: number | null
}

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
  colors: string[]        // [majorityHex, minorityHex] or [majorityHex, minorityHex, thirdHex]
  recipeCount: number
  recipes: PatternRecipe[]
}

// ─── Engine classification ───────────────────────────────────────────────────

interface Classification {
  patternKey: string
  minoritySize: number
  nColors: 2 | 3
  colors: string[]
}

function classify(
  s0: CheckStruct, id1: number,
  s2: CheckStruct, id3: number,
  s1: CheckStruct, s3: CheckStruct,
): Classification | null {
  const l1aStruct  = simulateCompositeJS(s0, s1, id1)
  const l1bStruct  = simulateCompositeJS(s2, s3, id3)
  const abcdStruct = computeL2(l1aStruct, l1bStruct)
  const virtualMap = buildL2RenderMap(l1aStruct, l1bStruct, s1, s3)

  const abcdAttrs = mapCheckAttributes(abcdStruct)
  const checksCount = Number(abcdAttrs.find(a => a.trait_type === 'Checks')?.value ?? 0)
  if (checksCount !== 20) return null

  let colorIdxs: number[]
  try {
    colorIdxs = colorIndexes(abcdStruct.stored.divisorIndex, abcdStruct, virtualMap)
  } catch {
    return null
  }
  if (colorIdxs.length !== 20) return null

  const cellsByHex = new Map<string, number[]>()
  colorIdxs.forEach((idx, cell) => {
    const hex = EIGHTY_COLORS[idx]
    const arr = cellsByHex.get(hex) ?? []
    arr.push(cell)
    cellsByHex.set(hex, arr)
  })

  if (cellsByHex.size < 2 || cellsByHex.size > 3) return null

  const sorted = [...cellsByHex.entries()].sort((a, b) => b[1].length - a[1].length)
  const [majorityHex] = sorted[0]
  const [minorityHex, minorityCells] = sorted[sorted.length - 1]
  const thirdHex = sorted.length === 3 ? sorted[1][0] : null

  if (minorityCells.length < 3 || minorityCells.length > 6) return null

  const sortedMinorityCells = [...minorityCells].sort((a, b) => a - b)
  const patternKey = `${sortedMinorityCells.join(',')}|maj:${majorityHex}|min:${minorityHex}|third:${thirdHex ?? 'none'}`

  return {
    patternKey,
    minoritySize: minorityCells.length,
    nColors: sorted.length as 2 | 3,
    colors: thirdHex ? [majorityHex, minorityHex, thirdHex] : [majorityHex, minorityHex],
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading candidate all_permutations rows (abcd_checks = 20)…')

  const patterns = new Map<string, { entry: PatternCatalogEntry }>()
  const structCache = new Map<number, CheckStruct>()
  const colorBandCache = new Map<number, string | null>()

  async function getStruct(id: number): Promise<CheckStruct | null> {
    const cached = structCache.get(id)
    if (cached) return cached
    const { data, error } = await supabase
      .from('all_checks')
      .select('check_struct')
      .eq('token_id', id)
      .single()
    if (error || !data) return null
    const s = checkStructFromJSON(data.check_struct as CheckStructJSON)
    structCache.set(id, s)
    return s
  }

  let scanned = 0
  let offset = 0

  while (scanned < MAX_SCANNED) {
    const { data, error } = await supabase
      .from('all_permutations')
      .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost')
      .eq('abcd_checks', 20)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    const rows = data as PermRow[]

    // Batch-fetch structs for every token in this page not already cached
    const idsNeeded = [...new Set(
      rows.flatMap(r => [r.keeper_1_id, r.burner_1_id, r.keeper_2_id, r.burner_2_id])
        .filter(id => !structCache.has(id))
    )]
    if (idsNeeded.length > 0) {
      const { data: structRows, error: structErr } = await supabase
        .from('all_checks')
        .select('token_id, check_struct, color_band')
        .in('token_id', idsNeeded)
      if (structErr) throw structErr
      for (const row of (structRows ?? []) as { token_id: number; check_struct: CheckStructJSON; color_band: string | null }[]) {
        structCache.set(row.token_id, checkStructFromJSON(row.check_struct))
        colorBandCache.set(row.token_id, row.color_band)
      }
    }

    for (const row of rows) {
      scanned++
      const s0 = structCache.get(row.keeper_1_id)
      const s1 = structCache.get(row.burner_1_id)
      const s2 = structCache.get(row.keeper_2_id)
      const s3 = structCache.get(row.burner_2_id)
      if (!s0 || !s1 || !s2 || !s3) continue

      const lowBandCount = [row.keeper_1_id, row.burner_1_id, row.keeper_2_id, row.burner_2_id]
        .filter(id => {
          const band = colorBandCache.get(id)
          return band === 'One' || band === 'Five' || band === 'Ten'
        }).length
      if (lowBandCount < 3) continue

      let classification: Classification | null
      try {
        classification = classify(s0, row.burner_1_id, s2, row.burner_2_id, s1, s3)
      } catch {
        continue
      }
      if (!classification) continue

      const recipe: PatternRecipe = {
        keeper_1_id: row.keeper_1_id,
        burner_1_id: row.burner_1_id,
        keeper_2_id: row.keeper_2_id,
        burner_2_id: row.burner_2_id,
        abcd_checks: 20,
        abcd_color_band: row.abcd_color_band,
        abcd_gradient: row.abcd_gradient,
        abcd_speed: row.abcd_speed,
        abcd_shift: row.abcd_shift,
        total_cost: row.total_cost,
      }

      const existing = patterns.get(classification.patternKey)
      if (existing) {
        if (existing.entry.recipes.length < MAX_RECIPES_PER_PATTERN) {
          existing.entry.recipes.push(recipe)
          existing.entry.recipeCount++
        } else {
          existing.entry.recipeCount++
        }
      } else {
        patterns.set(classification.patternKey, {
          entry: {
            patternKey: classification.patternKey,
            minoritySize: classification.minoritySize,
            nColors: classification.nColors,
            colors: classification.colors,
            recipeCount: 1,
            recipes: [recipe],
          },
        })
      }
    }

    console.log(`Scanned ${scanned} rows, ${patterns.size} distinct patterns so far…`)
    offset += PAGE_SIZE
    if (rows.length < PAGE_SIZE) break
  }

  // Sort each pattern's recipes cheapest-first; sort patterns rarest-first
  const entries = [...patterns.values()]
    .map(({ entry }) => {
      entry.recipes.sort((a, b) => (a.total_cost ?? Infinity) - (b.total_cost ?? Infinity))
      return entry
    })
    .sort((a, b) => a.recipeCount - b.recipeCount)

  console.log(`\nDone. ${entries.length} distinct patterns from ${scanned} scanned rows.`)

  const json = JSON.stringify(entries)
  const { error: uploadErr } = await supabase.storage
    .from('pattern-catalog')
    .upload('patterns.json', new Blob([json], { type: 'application/json' }), {
      upsert: true,
      contentType: 'application/json',
    })
  if (uploadErr) throw uploadErr

  console.log('Uploaded patterns.json to Storage bucket pattern-catalog.')
}

main().catch(e => {
  console.error('build-pattern-catalog failed:', e)
  process.exit(1)
})
