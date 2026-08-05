/**
 * hunt-diversity.ts
 *
 * Every previous hunt this session scored and kept results by relevance to
 * one specific target (minority cells [7,8,10,13]) — near-hit lists were
 * capped at 200-500, sorted by overlap with that target, so plenty of
 * genuinely distinct patterns found along the way were seen and then
 * discarded because they didn't look like the target. This hunt drops that
 * bias entirely: no target, no overlap scoring. It just catalogs every
 * distinct (cell layout + color pair) pattern it encounters, unbounded,
 * for as long as it runs — a real diversity census rather than a search
 * for one thing.
 *
 * Classification: distance-based color clustering (see hunt-color-family.ts
 * for why — fixed hue buckets merge/split colors incorrectly), allowing 2
 * OR 3 color families (build-pattern-catalog.ts's original definition),
 * minority family sized 2-10 cells.
 *
 * Usage: HUNT_SAMPLES=10000000 npm run hunt-diversity
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  checkStructFromJSON, simulateCompositeJS, computeL2, buildL2RenderMap,
  colorIndexes, EIGHTY_COLORS, type CheckStruct, type CheckStructJSON,
} from '../lib/engine.js'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const POOL_CHECKS_COUNT    = 80
const RUN_SAMPLES          = process.env.HUNT_SAMPLES ? Number(process.env.HUNT_SAMPLES) : Infinity
const RUN_MINUTES          = process.env.HUNT_MINUTES ? Number(process.env.HUNT_MINUTES) : Infinity
const MIN_COLOR_DISTANCE   = 120
const CLUSTER_THRESHOLD    = 90
const MAX_RECIPES_PER_PATTERN = 3
const OUT_FILE             = new URL('../hunt-diversity-results.json', import.meta.url).pathname

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}
function colorDistance(hexA: string, hexB: string): number {
  const [r1, g1, b1] = hexToRgb(hexA)
  const [r2, g2, b2] = hexToRgb(hexB)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function clusterHexes(hexes: string[]): Map<string, number> {
  const unique = [...new Set(hexes)]
  const clusters: string[][] = []
  for (const hex of unique) {
    let bestCluster = -1
    let bestDist = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (const h of clusters[i]) {
        const d = colorDistance(h, hex)
        if (d < bestDist) { bestDist = d; bestCluster = i }
      }
    }
    if (bestCluster !== -1 && bestDist < CLUSTER_THRESHOLD) clusters[bestCluster].push(hex)
    else clusters.push([hex])
  }
  let merged = true
  while (merged) {
    merged = false
    outer:
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let minDist = Infinity
        for (const a of clusters[i]) for (const b of clusters[j]) minDist = Math.min(minDist, colorDistance(a, b))
        if (minDist < CLUSTER_THRESHOLD) {
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

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing env vars.'); process.exit(1) }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface PoolToken { id: number; struct: CheckStruct; price: number | null }
interface Recipe { keeper_1_id: number; burner_1_id: number; keeper_2_id: number; burner_2_id: number; total_cost: number | null }
interface PatternEntry {
  patternKey: string
  minorityCells: number[]
  minoritySize: number
  nColors: 2 | 3
  colors: string[]
  recipeCount: number
  recipes: Recipe[]
}

async function loadPool(bands: string[]): Promise<PoolToken[]> {
  const { data, error } = await supabase
    .from('all_checks')
    .select('token_id, check_struct, eth_price')
    .in('color_band', bands)
    .eq('checks_count', POOL_CHECKS_COUNT)
    .eq('is_burned', false)
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.token_id as number,
    struct: checkStructFromJSON(r.check_struct as CheckStructJSON),
    price: (r.eth_price as number | null) ?? null,
  }))
}

function randomInt(max: number): number { return Math.floor(Math.random() * max) }
function pickDistinct(pool: PoolToken[], count: number): PoolToken[] {
  const idx = pool.map((_, i) => i)
  for (let i = 0; i < count; i++) { const j = i + randomInt(idx.length - i);[idx[i], idx[j]] = [idx[j], idx[i]] }
  return idx.slice(0, count).map(i => pool[i])
}
function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1);[a[i], a[j]] = [a[j], a[i]] }
  return a
}
function sampleCandidate(onePool: PoolToken[], restPool: PoolToken[]): PoolToken[] | null {
  const oneCount = 2 + randomInt(2)
  const restCount = 4 - oneCount
  if (onePool.length < oneCount || restPool.length < restCount) return null
  return fisherYates([...pickDistinct(onePool, oneCount), ...pickDistinct(restPool, restCount)])
}

function classify(t0: PoolToken, t1: PoolToken, t2: PoolToken, t3: PoolToken): PatternEntry | null {
  const l1aStruct  = simulateCompositeJS(t0.struct, t1.struct, t1.id)
  const l1bStruct  = simulateCompositeJS(t2.struct, t3.struct, t3.id)
  const abcdStruct = computeL2(l1aStruct, l1bStruct)
  const virtualMap = buildL2RenderMap(l1aStruct, l1bStruct, t1.struct, t3.struct)
  if (abcdStruct.checksCount !== 20) return null

  let colorIdxs: number[]
  try { colorIdxs = colorIndexes(abcdStruct.stored.divisorIndex, abcdStruct, virtualMap) } catch { return null }
  if (colorIdxs.length !== 20) return null

  const cellHexes = colorIdxs.map(idx => EIGHTY_COLORS[idx])
  const hexToFamily = clusterHexes(cellHexes)

  const cellsByFamily = new Map<number, number[]>()
  const hexesByFamily = new Map<number, Set<string>>()
  const sampleHexByFamily = new Map<number, string>()
  cellHexes.forEach((hex, cell) => {
    const family = hexToFamily.get(hex)!
    const arr = cellsByFamily.get(family) ?? []
    arr.push(cell)
    cellsByFamily.set(family, arr)
    const hexSet = hexesByFamily.get(family) ?? new Set<string>()
    hexSet.add(hex)
    hexesByFamily.set(family, hexSet)
    if (!sampleHexByFamily.has(family)) sampleHexByFamily.set(family, hex)
  })
  if (cellsByFamily.size < 2 || cellsByFamily.size > 3) return null

  const sorted = [...cellsByFamily.entries()].sort((a, b) => b[1].length - a[1].length)
  const [majFamily] = sorted[0]
  const [minFamily, minorityCells] = sorted[sorted.length - 1]
  if (minorityCells.length < 2 || minorityCells.length > 10) return null

  // Every OTHER family must be clearly distinct from the minority family
  // (guards the 3-color case too, not just majority-vs-minority).
  for (const [fam, hexSet] of hexesByFamily) {
    if (fam === minFamily) continue
    for (const h1 of hexesByFamily.get(minFamily)!) {
      for (const h2 of hexSet) {
        if (colorDistance(h1, h2) < MIN_COLOR_DISTANCE) return null
      }
    }
  }

  const sortedCells = [...minorityCells].sort((a, b) => a - b)
  const thirdFamily = sorted.length === 3 ? sorted[1][0] : null
  const majHex = sampleHexByFamily.get(majFamily)!
  const minHex = sampleHexByFamily.get(minFamily)!
  const thirdHex = thirdFamily !== null ? sampleHexByFamily.get(thirdFamily)! : null

  const patternKey = `${sortedCells.join(',')}|maj:${majHex}|min:${minHex}|third:${thirdHex ?? 'none'}`
  const allListed = t0.price !== null && t1.price !== null && t2.price !== null && t3.price !== null
  const totalCost = allListed ? t0.price! + t1.price! + t2.price! + t3.price! : null

  return {
    patternKey,
    minorityCells: sortedCells,
    minoritySize: sortedCells.length,
    nColors: thirdHex ? 3 : 2,
    colors: thirdHex ? [majHex, minHex, thirdHex] : [majHex, minHex],
    recipeCount: 1,
    recipes: [{ keeper_1_id: t0.id, burner_1_id: t1.id, keeper_2_id: t2.id, burner_2_id: t3.id, total_cost: totalCost }],
  }
}

async function main() {
  console.log(`Loading band pools at checks_count=${POOL_CHECKS_COUNT}…`)
  const onePool  = await loadPool(['One'])
  const restPool = await loadPool(['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five'])
  console.log(`One-band pool: ${onePool.length}. Rest pool: ${restPool.length}.`)

  const patterns = new Map<string, PatternEntry>()
  const seen = new Set<string>()
  let sampled = 0

  // Resume from a prior run's output if present, so an autorestart after a
  // crash/kill continues accumulating toward RUN_SAMPLES instead of wiping
  // progress and starting the pattern census over from zero each time.
  try {
    const prior = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as { sampled: number; entries: PatternEntry[] }
    for (const entry of prior.entries) {
      // Shrink recipes carried over from before MAX_RECIPES_PER_PATTERN was
      // lowered — otherwise old entries stay bloated forever even though
      // new ones respect the new, smaller cap.
      if (entry.recipes.length > MAX_RECIPES_PER_PATTERN) entry.recipes = entry.recipes.slice(0, MAX_RECIPES_PER_PATTERN)
      patterns.set(entry.patternKey, entry)
    }
    sampled = prior.sampled ?? 0
    console.log(`Resuming from prior run: sampled=${sampled}, unique patterns=${patterns.size}`)
  } catch {
    console.log('No prior results found — starting fresh.')
  }

  const startedAt = Date.now()
  const deadline = Number.isFinite(RUN_MINUTES) ? startedAt + RUN_MINUTES * 60_000 : Infinity

  const flush = () => {
    const allEntries = [...patterns.values()].sort((a, b) => a.recipeCount - b.recipeCount)
    // Compact (no pretty-print indentation) — at 900k+ entries the
    // indented form was doubling+ the string size and pushing
    // JSON.stringify past V8's max string length (RangeError: Invalid
    // string length), crashing the process every flush once the file
    // crossed ~500MB.
    writeFileSync(OUT_FILE, JSON.stringify({
      note: 'Unbiased diversity census — no target, no overlap scoring. Every distinct pattern found, kept.',
      sampled,
      uniquePatternCount: allEntries.length,
      entries: allEntries,
    }))
  }

  console.log(`Hunting for ALL distinct scatter patterns (no target)…`)

  while (Date.now() < deadline && sampled < RUN_SAMPLES) {
    const candidate = sampleCandidate(onePool, restPool)
    if (!candidate) break
    const [t0, t1, t2, t3] = candidate
    const dedupeKey = [t0.id, t1.id, t2.id, t3.id].join(',')
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    sampled++

    let hit: PatternEntry | null
    try { hit = classify(t0, t1, t2, t3) } catch { continue }
    if (hit) {
      const existing = patterns.get(hit.patternKey)
      if (existing) {
        existing.recipeCount++
        const r = hit.recipes[0]
        const alreadyHave = existing.recipes.some(
          e => e.keeper_1_id === r.keeper_1_id && e.burner_1_id === r.burner_1_id && e.keeper_2_id === r.keeper_2_id && e.burner_2_id === r.burner_2_id
        )
        if (!alreadyHave && existing.recipes.length < MAX_RECIPES_PER_PATTERN) existing.recipes.push(r)
      } else {
        patterns.set(hit.patternKey, hit)
      }
    }

    if (sampled % 20_000 === 0) {
      console.log(`Sampled ${sampled}, unique patterns=${patterns.size}, elapsed=${((Date.now() - startedAt) / 60_000).toFixed(1)}min`)
      flush()
    }
  }

  flush()
  console.log(`\nDone. Sampled ${sampled}. Unique patterns found: ${patterns.size}.`)
  console.log(`Results written to ${OUT_FILE}`)
}

main().catch(e => { console.error('hunt-diversity failed:', e); process.exit(1) })
