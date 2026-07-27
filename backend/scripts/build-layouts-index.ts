/**
 * build-layouts-index.ts
 *
 * Merges consolidated-patterns.json (this session's targeted hunts) and
 * hunt-diversity-results.json (the unbiased diversity census) into one
 * lean, cell-layout-consolidated index for the app's Patterns tab paint-
 * grid composer. Unlike final-pattern-catalog.json (one entry per exact
 * color pair, capped at 500 for the old flat-list UI), this groups by
 * minority cell layout only — color is nested underneath as variations —
 * and keeps only numeric recipe ids (no struct/SVG data; the frontend
 * fetches that on demand only for whichever variation the user opens).
 *
 * Usage: npx tsx scripts/build-layouts-index.ts
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const MAX_VARIATIONS_PER_LAYOUT = 4
const MAX_RECIPES_PER_VARIATION = 3
const OUT_FILE = new URL('../layouts-index.json', import.meta.url).pathname

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing env vars.'); process.exit(1) }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface RawRecipeRaw { [k: string]: number | string | null | undefined }
interface RawEntry {
  patternKey: string
  minoritySize: number
  colors: string[]
  recipeCount: number
  recipes: RawRecipeRaw[]
}

interface Recipe { keeper_1_id: number; burner_1_id: number; keeper_2_id: number; burner_2_id: number; total_cost: number | null }
interface Variation { colors: [string, string]; recipeCount: number; recipes: Recipe[] }
interface LayoutEntry {
  cells: number[]
  minoritySize: number
  variety: number
  totalRecipes: number
  variations: Variation[]
}

function normalizeRecipe(r: RawRecipeRaw): Recipe {
  const k1 = (r.k1 ?? r.keeper_1_id) as number
  const b1 = (r.b1 ?? r.burner_1_id) as number
  const k2 = (r.k2 ?? r.keeper_2_id) as number
  const b2 = (r.b2 ?? r.burner_2_id) as number
  const totalCost = (r.totalCost ?? r.total_cost) as number | null | undefined
  return { keeper_1_id: k1, burner_1_id: b1, keeper_2_id: k2, burner_2_id: b2, total_cost: totalCost ?? null }
}

async function main() {
  const layouts = new Map<string, {
    cells: number[]; size: number
    variations: Map<string, { colors: [string, string]; count: number; recipes: Recipe[] }>
  }>()

  function addEntries(entries: RawEntry[]) {
    for (const e of entries) {
      if (e.minoritySize < 3 || e.minoritySize > 6) continue
      const cellsKey = e.patternKey.split('|')[0]
      const cells = cellsKey.split(',').map(Number)
      let layout = layouts.get(cellsKey)
      if (!layout) { layout = { cells, size: cells.length, variations: new Map() }; layouts.set(cellsKey, layout) }

      const colorKey = e.colors.slice(0, 2).join('|')
      let variation = layout.variations.get(colorKey)
      if (!variation) { variation = { colors: [e.colors[0], e.colors[1]], count: 0, recipes: [] }; layout.variations.set(colorKey, variation) }
      variation.count += e.recipeCount
      for (const r of e.recipes) {
        if (variation.recipes.length >= MAX_RECIPES_PER_VARIATION) break
        const norm = normalizeRecipe(r)
        const dupe = variation.recipes.some(x => x.keeper_1_id === norm.keeper_1_id && x.burner_1_id === norm.burner_1_id && x.keeper_2_id === norm.keeper_2_id && x.burner_2_id === norm.burner_2_id)
        if (!dupe) variation.recipes.push(norm)
      }
    }
  }

  console.log('Loading consolidated-patterns.json…')
  const consolidated = JSON.parse(readFileSync(new URL('../consolidated-patterns.json', import.meta.url).pathname, 'utf8')) as { entries: RawEntry[] }
  addEntries(consolidated.entries)

  console.log('Loading hunt-diversity-results.json…')
  const diversity = JSON.parse(readFileSync(new URL('../hunt-diversity-results.json', import.meta.url).pathname, 'utf8')) as { entries: RawEntry[] }
  addEntries(diversity.entries)

  console.log(`${layouts.size} unique cell layouts before live validation.`)

  const allIds = new Set<number>()
  for (const layout of layouts.values()) {
    for (const v of layout.variations.values()) {
      for (const r of v.recipes) { allIds.add(r.keeper_1_id); allIds.add(r.burner_1_id); allIds.add(r.keeper_2_id); allIds.add(r.burner_2_id) }
    }
  }
  const idList = [...allIds]
  console.log(`Validating ${idList.length} unique token ids against live all_checks…`)
  const liveIds = new Set<number>()
  const BATCH = 1000
  for (let i = 0; i < idList.length; i += BATCH) {
    const { data, error } = await supabase.from('all_checks').select('token_id').in('token_id', idList.slice(i, i + BATCH)).eq('is_burned', false)
    if (error) throw error
    for (const row of data ?? []) liveIds.add(row.token_id as number)
  }
  console.log(`${liveIds.size} of ${idList.length} tokens still live.`)

  const out: LayoutEntry[] = []
  for (const layout of layouts.values()) {
    const variations: Variation[] = []
    for (const v of layout.variations.values()) {
      const liveRecipes = v.recipes.filter(r => liveIds.has(r.keeper_1_id) && liveIds.has(r.burner_1_id) && liveIds.has(r.keeper_2_id) && liveIds.has(r.burner_2_id))
      if (liveRecipes.length === 0) continue
      variations.push({ colors: v.colors, recipeCount: v.count, recipes: liveRecipes })
    }
    if (variations.length === 0) continue
    variations.sort((a, b) => b.recipeCount - a.recipeCount)
    out.push({
      cells: layout.cells,
      minoritySize: layout.size,
      variety: variations.length,
      totalRecipes: variations.reduce((s, v) => s + v.recipeCount, 0),
      variations: variations.slice(0, MAX_VARIATIONS_PER_LAYOUT),
    })
  }

  out.sort((a, b) => a.totalRecipes - b.totalRecipes)

  // Compact wire format — JSON repeats key names per object, and with
  // ~20K layouts x up to 4 variations x up to 3 recipes, verbose keys like
  // "keeper_1_id" alone accounted for several MB. Short keys cut raw size
  // roughly in half; frontend expands these back to named fields on load.
  // total_cost is dropped — the Patterns browse UI doesn't show price, and
  // TreePanel already re-derives live prices from token ids once opened.
  const compact = out.map(l => ({
    c: l.cells,
    m: l.minoritySize,
    nv: l.variety,
    nr: l.totalRecipes,
    v: l.variations.map(v => ({
      c: v.colors,
      n: v.recipeCount,
      r: v.recipes.map(r => [r.keeper_1_id, r.burner_1_id, r.keeper_2_id, r.burner_2_id]),
    })),
  }))

  writeFileSync(OUT_FILE, JSON.stringify(compact))
  const blob = JSON.stringify(compact)
  console.log(`\n${out.length} layouts with at least one live recipe.`)
  console.log(`Payload size: ${(blob.length / 1024).toFixed(1)} KB`)
  console.log(`Written to ${OUT_FILE}`)
}

main().catch(e => { console.error('build-layouts-index failed:', e); process.exit(1) })
