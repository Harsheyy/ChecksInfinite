/**
 * build-pattern-catalog.ts
 *
 * Randomly samples 20-check composites built from a targeted band mix (2-3
 * One-band input tokens + the remaining slots from Eighty/Twenty-band —
 * the combination the July-21 research session found actually produces
 * low-color-count composites), classifies each for <=3 unique hex colors
 * with a 3-6 cell minority cluster, groups matches by visual pattern
 * signature, and uploads patterns.json to the public `pattern-catalog`
 * Storage bucket.
 *
 * Earlier version scanned the existing (general-population) all_permutations
 * table — that sample is dominated by common Eighty-band composites and
 * essentially never lands on <=3 colors. Sampling directly from band-filtered
 * all_checks pools, restricted to checks_count=80 (where One/Twenty/Eighty
 * bands all coexist — see live counts checked 2026-07-23: One=115,
 * Twenty=280, Eighty=963 tokens at checks_count=80), finds real patterns.
 *
 * Not automated — re-run manually; live supply changes as tokens burn.
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
  mapCheckAttributes,
  EIGHTY_COLORS,
  type CheckStruct,
  type CheckStructJSON,
} from '../lib/engine.js'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const SAMPLE_TARGET        = 200_000  // candidate 4-token combos to try
const MAX_RECIPES_PER_PATTERN = 10
const MAX_PATTERNS_IN_CATALOG = 500   // keep only the rarest — a browse list, not a dump
const POOL_CHECKS_COUNT    = 80       // generation where One/Twenty/Eighty bands overlap

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY in backend/.env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface PoolToken {
  id: number
  struct: CheckStruct
  price: number | null
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
  abcdColorBand: string | null
  abcdGradient: string | null
  abcdSpeed: string | null
  abcdShift: string | null
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
  const getAttr = (name: string) => abcdAttrs.find(a => a.trait_type === name)?.value ?? null
  const checksCount = Number(getAttr('Checks') ?? 0)
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
    abcdColorBand: getAttr('Color Band'),
    abcdGradient:  getAttr('Gradient'),
    abcdSpeed:     getAttr('Speed'),
    abcdShift:     getAttr('Shift'),
  }
}

// ─── Band-targeted candidate pools ────────────────────────────────────────────

async function loadPool(bands: string[]): Promise<PoolToken[]> {
  const { data, error } = await supabase
    .from('all_checks')
    .select('token_id, check_struct, eth_price')
    .in('color_band', bands)
    .eq('checks_count', POOL_CHECKS_COUNT)
    .eq('is_burned', false)
  if (error) throw error
  return (data ?? []).map(r => ({
    id:     r.token_id as number,
    struct: checkStructFromJSON(r.check_struct as CheckStructJSON),
    price:  (r.eth_price as number | null) ?? null,
  }))
}

function randomInt(max: number): number {
  return Math.floor(Math.random() * max)
}

// Pick `count` distinct tokens from a pool via partial Fisher-Yates on a
// scratch index array — avoids rejection-sampling collisions on small pools.
function pickDistinct(pool: PoolToken[], count: number): PoolToken[] {
  const idx = pool.map((_, i) => i)
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(idx.length - i)
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, count).map(i => pool[i])
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// One random 4-token candidate: 2 or 3 from onePool, the rest from restPool,
// shuffled into the 4 (keeper1, burner1, keeper2, burner2) roles.
function sampleCandidate(onePool: PoolToken[], restPool: PoolToken[]): PoolToken[] | null {
  const oneCount = 2 + randomInt(2)  // 2 or 3
  const restCount = 4 - oneCount
  if (onePool.length < oneCount || restPool.length < restCount) return null
  const chosen = [...pickDistinct(onePool, oneCount), ...pickDistinct(restPool, restCount)]
  return fisherYates(chosen)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Loading band pools at checks_count=${POOL_CHECKS_COUNT}…`)
  const onePool  = await loadPool(['One'])
  const restPool = await loadPool(['Eighty', 'Twenty'])
  console.log(`One-band pool: ${onePool.length} tokens. Eighty/Twenty pool: ${restPool.length} tokens.`)
  if (onePool.length < 2 || restPool.length < 1) {
    console.error('Pools too small to sample a valid 2-3 One-band combo.')
    process.exit(1)
  }

  const patterns = new Map<string, { entry: PatternCatalogEntry }>()
  const seen = new Set<string>()
  let sampled = 0
  let skippedDuplicate = 0

  while (sampled < SAMPLE_TARGET) {
    const candidate = sampleCandidate(onePool, restPool)
    if (!candidate) break
    const [t0, t1, t2, t3] = candidate  // keeper1, burner1, keeper2, burner2

    const dedupeKey = [t0.id, t1.id, t2.id, t3.id].join(',')
    if (seen.has(dedupeKey)) { skippedDuplicate++; continue }
    seen.add(dedupeKey)

    sampled++

    let classification: Classification | null
    try {
      classification = classify(t0.struct, t1.id, t2.struct, t3.id, t1.struct, t3.struct)
    } catch {
      continue
    }
    if (!classification) continue

    const allListed = t0.price !== null && t1.price !== null && t2.price !== null && t3.price !== null
    const totalCost = allListed ? t0.price! + t1.price! + t2.price! + t3.price! : null

    const recipe: PatternRecipe = {
      keeper_1_id: t0.id,
      burner_1_id: t1.id,
      keeper_2_id: t2.id,
      burner_2_id: t3.id,
      abcd_checks: 20,
      abcd_color_band: classification.abcdColorBand,
      abcd_gradient:   classification.abcdGradient,
      abcd_speed:      classification.abcdSpeed,
      abcd_shift:      classification.abcdShift,
      total_cost:      totalCost,
    }

    const existing = patterns.get(classification.patternKey)
    if (existing) {
      if (existing.entry.recipes.length < MAX_RECIPES_PER_PATTERN) {
        existing.entry.recipes.push(recipe)
      }
      existing.entry.recipeCount++
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

    if (sampled % 10_000 === 0) {
      console.log(`Sampled ${sampled}/${SAMPLE_TARGET}, ${patterns.size} distinct patterns so far…`)
    }
  }

  // Sort each pattern's recipes cheapest-first; sort patterns rarest-first;
  // keep only the rarest MAX_PATTERNS_IN_CATALOG — this is a curated browse
  // list, and an uncapped catalog here hit ~18K patterns (200K-sample run),
  // which produced a JSON payload too large for a reliable single upload.
  const allEntries = [...patterns.values()]
    .map(({ entry }) => {
      entry.recipes.sort((a, b) => (a.total_cost ?? Infinity) - (b.total_cost ?? Infinity))
      return entry
    })
    .sort((a, b) => a.recipeCount - b.recipeCount)
  const entries = allEntries.slice(0, MAX_PATTERNS_IN_CATALOG)

  console.log(`\nDone. ${allEntries.length} distinct patterns from ${sampled} sampled combos (${skippedDuplicate} duplicate combos skipped).`)
  console.log(`Uploading rarest ${entries.length} (of ${allEntries.length}) patterns…`)

  const json = JSON.stringify(entries)
  const blob = new Blob([json], { type: 'application/json' })
  console.log(`Payload size: ${(blob.size / 1024).toFixed(1)} KB`)

  let uploadErr: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.storage
      .from('pattern-catalog')
      .upload('patterns.json', blob, { upsert: true, contentType: 'application/json' })
    if (!error) { uploadErr = null; break }
    uploadErr = error
    console.warn(`Upload attempt ${attempt} failed: ${(error as Error).message ?? error}`)
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
  }
  if (uploadErr) throw uploadErr

  console.log('Uploaded patterns.json to Storage bucket pattern-catalog.')
}

main().catch(e => {
  console.error('build-pattern-catalog failed:', e)
  process.exit(1)
})
