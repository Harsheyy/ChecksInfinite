/**
 * build-pattern-library.ts
 *
 * Merges every pattern the hunts have ever found into the `pattern_layouts` /
 * `pattern_variations` tables (migration 056), which is what the app's Patterns
 * tab queries.
 *
 * Sources — both, always:
 *   consolidated-patterns.json    the 33 targeted-hunt result files, rolled up
 *                                 (see its `sourceFiles` field) before those
 *                                 one-off scripts were deleted in f8953d2
 *   hunt-diversity-results.json   the unbiased 10M-sample diversity census
 *
 * Replaces build-layouts-index.ts + upload-layouts-index.ts, which packed the
 * same data into a single 38.9 MB layouts.json the browser downloaded and
 * parsed in full. Fitting that in a download forced caps of 4 colour variations
 * per layout and 3 recipes per variation, which threw away 68% of the
 * variations and 72% of the distinct recipes. Nothing is capped here — the
 * caps that remain are read-side page limits inside the RPCs.
 *
 * Usage: npm run build-pattern-library
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const INSERT_BATCH   = 2000
const INSERT_WORKERS = 4

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing env vars.'); process.exit(1) }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface RawRecipe { [k: string]: number | string | null | undefined }
interface RawEntry {
  patternKey: string
  minoritySize: number
  colors: string[]
  recipeCount: number
  recipes: RawRecipe[]
}

interface Variation {
  colors: [string, string]
  huntHits: number
  // Recipes are held as "k1,b1,k2,b2" strings purely to dedupe across the two
  // source files without an O(n^2) scan — 2M+ tuples make the array `.some()`
  // the old builder used unaffordable once the per-variation cap is gone.
  recipes: Set<string>
}
interface Layout {
  cells: number[]
  variations: Map<string, Variation>
}

function recipeKey(r: RawRecipe): string {
  const k1 = (r.k1 ?? r.keeper_1_id) as number
  const b1 = (r.b1 ?? r.burner_1_id) as number
  const k2 = (r.k2 ?? r.keeper_2_id) as number
  const b2 = (r.b2 ?? r.burner_2_id) as number
  return `${k1},${b1},${k2},${b2}`
}

async function inParallel<T>(items: T[], workers: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i], i)
    }
  }))
}

async function main() {
  const layouts = new Map<string, Layout>()

  function addEntries(entries: RawEntry[]) {
    for (const e of entries) {
      if (e.minoritySize < 2 || e.minoritySize > 10) continue
      const cellsKey = e.patternKey.split('|')[0]
      let layout = layouts.get(cellsKey)
      if (!layout) {
        layout = { cells: cellsKey.split(',').map(Number), variations: new Map() }
        layouts.set(cellsKey, layout)
      }
      // Three-colour patterns are keyed on their majority/minority pair, same
      // as the old builder — the third family is a rendering detail the
      // Patterns UI never surfaced.
      const colorKey = e.colors.slice(0, 2).join('|')
      let variation = layout.variations.get(colorKey)
      if (!variation) {
        variation = { colors: [e.colors[0], e.colors[1]], huntHits: 0, recipes: new Set() }
        layout.variations.set(colorKey, variation)
      }
      variation.huntHits += e.recipeCount
      for (const r of e.recipes) variation.recipes.add(recipeKey(r))
    }
  }

  console.log('Loading consolidated-patterns.json (33 targeted hunts)…')
  addEntries((JSON.parse(readFileSync(new URL('../consolidated-patterns.json', import.meta.url).pathname, 'utf8')) as { entries: RawEntry[] }).entries)
  console.log(`  ${layouts.size} cell layouts so far.`)

  console.log('Loading hunt-diversity-results.json (diversity census)…')
  addEntries((JSON.parse(readFileSync(new URL('../hunt-diversity-results.json', import.meta.url).pathname, 'utf8')) as { entries: RawEntry[] }).entries)
  console.log(`  ${layouts.size} cell layouts total.`)

  // Liveness: a recipe naming a burned token can never be minted, so it is
  // dropped. The pool is 80-check tokens only, so this is a couple of thousand
  // ids however many millions of recipes reference them.
  const allIds = new Set<number>()
  for (const layout of layouts.values())
    for (const v of layout.variations.values())
      for (const key of v.recipes)
        for (const id of key.split(',')) allIds.add(Number(id))

  const idList = [...allIds]
  console.log(`Validating ${idList.length} unique token ids against live all_checks…`)
  const liveIds = new Set<number>()
  for (let i = 0; i < idList.length; i += 1000) {
    const { data, error } = await supabase
      .from('all_checks').select('token_id')
      .in('token_id', idList.slice(i, i + 1000)).eq('is_burned', false)
    if (error) throw error
    for (const row of data ?? []) liveIds.add(row.token_id as number)
  }
  console.log(`  ${liveIds.size} of ${idList.length} tokens still live.`)

  const layoutRows: { cells_mask: number; cells_key: string; minority_size: number; variety: number; total_recipes: number }[] = []
  const variationRows: { cells_key: string; maj_hex: string; min_hex: string; recipe_count: number; recipes: number[] }[] = []
  let droppedLayouts = 0

  for (const [cellsKey, layout] of layouts) {
    const kept: typeof variationRows = []
    let totalRecipes = 0

    for (const v of layout.variations.values()) {
      const flat: number[] = []
      for (const key of v.recipes) {
        const ids = key.split(',').map(Number)
        if (ids.every(id => liveIds.has(id))) flat.push(...ids)
      }
      if (flat.length === 0) continue
      totalRecipes += flat.length / 4
      kept.push({
        cells_key: cellsKey,
        maj_hex: v.colors[0],
        min_hex: v.colors[1],
        recipe_count: v.huntHits,
        recipes: flat,
      })
    }

    if (kept.length === 0) { droppedLayouts++; continue }

    variationRows.push(...kept)
    layoutRows.push({
      // 20-bit mask, bit i = cell i. search_pattern_layouts matches on this.
      cells_mask: layout.cells.reduce((m, c) => m | (1 << c), 0),
      cells_key: cellsKey,
      minority_size: layout.cells.length,
      variety: kept.length,
      total_recipes: totalRecipes,
    })
  }

  console.log(`\n${layoutRows.length} layouts, ${variationRows.length} colour variations, ` +
              `${variationRows.reduce((s, v) => s + v.recipes.length / 4, 0)} live recipes.`)
  console.log(`(${droppedLayouts} layouts dropped — every recipe referenced a burned token.)`)

  console.log('\nClearing staging…')
  {
    const { error } = await supabase.rpc('truncate_pattern_staging')
    if (error) throw error
  }

  async function load<T>(table: string, rows: T[]) {
    const batches: T[][] = []
    for (let i = 0; i < rows.length; i += INSERT_BATCH) batches.push(rows.slice(i, i + INSERT_BATCH))
    let done = 0
    await inParallel(batches, INSERT_WORKERS, async batch => {
      const { error } = await supabase.from(table).insert(batch)
      if (error) throw new Error(`${table} insert failed: ${error.message}`)
      done += batch.length
      if (done % (INSERT_BATCH * 20) < INSERT_BATCH) console.log(`  ${table}: ${done}/${rows.length}`)
    })
    console.log(`  ${table}: ${rows.length}/${rows.length} done.`)
  }

  await load('pattern_layouts_staging', layoutRows)
  await load('pattern_variations_staging', variationRows)

  // Single transaction, and it refuses to publish empty staging — a crash
  // anywhere above leaves the previous library serving untouched.
  console.log('\nSwapping staging into the live tables…')
  const { data: swapped, error: swapErr } = await supabase.rpc('swap_pattern_library')
  if (swapErr) throw swapErr
  const result = Array.isArray(swapped) ? swapped[0] : swapped
  console.log(`Published ${result.layouts} layouts and ${result.variations} variations.`)
}

main().catch(e => { console.error('build-pattern-library failed:', e); process.exit(1) })
