/**
 * populate-market-permutations.ts
 *
 * Nightly refresh of the all_permutations table — 500K diversity-weighted
 * permutations across ALL market checks (is_tokenstr = false).
 *
 * Sampling strategy:
 *   - Group tokens by checks_count (must have ≥ 4 in group to compute)
 *   - Within each group, sort by weighted priority (rare bands first) then
 *     Fisher-Yates shuffle with weights so rare tokens appear early
 *   - Iterate P(n,4) ordered permutations until the total cap is hit
 *
 * Weight map: One→10, Five→8, Ten→6, Twenty→4, Forty→3, Sixty→2, Eighty/null→1
 * Gradient bonus: +3 if gradient is set and not 'None'
 *
 * Usage:
 *   npm run populate-market
 */

import { createClient } from '@supabase/supabase-js'
import {
  simulateCompositeJS,
  mapCheckAttributes,
  computeL2,
  buildL2RenderMap,
  colorIndexes,
  checkStructFromJSON,
  type CheckStruct,
  type CheckStructJSON,
} from '../lib/engine.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const BATCH_SIZE           = 500
const MAX_TOTAL            = 500_000

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY in backend/.env')
  process.exit(1)
}

// ─── Client ───────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckRow {
  token_id:     number
  checks_count: number
  color_band:   string | null
  gradient:     string | null
  check_struct: CheckStructJSON
  eth_price:    number | null
}

interface AllPermRow {
  keeper_1_id:     number
  burner_1_id:     number
  keeper_2_id:     number
  burner_2_id:     number
  abcd_checks:     number | null
  abcd_color_band: string | null
  abcd_gradient:   string | null
  abcd_speed:      string | null
  abcd_shift:      string | null
  color_family:    number | null
  total_cost:      number | null
}

// ─── Rarity weight for weighted shuffle ───────────────────────────────────────

const BAND_WEIGHT: Record<string, number> = {
  One:    10,
  Five:   8,
  Ten:    6,
  Twenty: 4,
  Forty:  3,
  Sixty:  2,
  Eighty: 1,
}

function tokenWeight(row: CheckRow): number {
  const base    = BAND_WEIGHT[row.color_band ?? ''] ?? 1
  const gradBonus = (row.gradient && row.gradient !== 'None') ? 3 : 0
  return base + gradBonus
}

/** Weighted random sort: each token gets key = -log(rand) / weight.
 *  Sorting ascending by key gives a weighted random permutation where
 *  high-weight tokens appear earlier in expectation. */
function weightedShuffle<T>(items: T[], weight: (t: T) => number): T[] {
  return items
    .map(t => ({ t, key: -Math.log(Math.random()) / weight(t) }))
    .sort((a, b) => a.key - b.key)
    .map(({ t }) => t)
}

// ─── Compute one permutation row ─────────────────────────────────────────────

function computePermutation(
  s0: CheckStruct, id0: number, price0: number | null,
  s1: CheckStruct, id1: number, price1: number | null,
  s2: CheckStruct, id2: number, price2: number | null,
  s3: CheckStruct, id3: number, price3: number | null,
): AllPermRow {
  const l1aStruct  = simulateCompositeJS(s0, s1, id1)
  const l1bStruct  = simulateCompositeJS(s2, s3, id3)
  const abcdStruct = computeL2(l1aStruct, l1bStruct)
  const virtualMap = buildL2RenderMap(l1aStruct, l1bStruct, s1, s3)

  const abcdAttrs = mapCheckAttributes(abcdStruct)
  const getAttr   = (name: string) => abcdAttrs.find(a => a.trait_type === name)?.value ?? null

  let colorFamily: number | null = null
  try {
    const colors = colorIndexes(abcdStruct.stored.divisorIndex, abcdStruct, virtualMap)
    if (colors.length > 0) colorFamily = Math.floor(colors[0] / 10)
  } catch {
    // non-critical — bucket remains null
  }

  const total_cost = (price0 !== null && price1 !== null && price2 !== null && price3 !== null)
    ? price0 + price1 + price2 + price3
    : null

  return {
    keeper_1_id:     id0,
    burner_1_id:     id1,
    keeper_2_id:     id2,
    burner_2_id:     id3,
    abcd_checks:     getAttr('Checks') !== null ? Number(getAttr('Checks')) : null,
    abcd_color_band: getAttr('Color Band') as string | null,
    abcd_gradient:   getAttr('Gradient')   as string | null,
    abcd_speed:      getAttr('Speed')      as string | null,
    abcd_shift:      getAttr('Shift')      as string | null,
    color_family:    colorFamily,
    total_cost,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function flushBatch(batch: AllPermRow[]) {
  const { error } = await supabase.from('all_permutations').insert(batch)
  if (error) throw error
}

function perm4(n: number): number {
  return n * (n - 1) * (n - 2) * (n - 3)
}

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'populate-market-permutations', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

async function finishLog(id: number, status: 'done' | 'error', permsComputed: number, errorMessage?: string) {
  await supabase
    .from('sync_log')
    .update({
      status,
      perms_computed:  permsComputed,
      error_message:   errorMessage ?? null,
      finished_at:     new Date().toISOString(),
    })
    .eq('id', id)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const logId = await startLog()
  let totalPerms = 0

  try {
    // 0. Wipe existing rows
    console.log('Truncating all_permutations…')
    const { error: truncErr } = await supabase.rpc('truncate_all_permutations')
    if (truncErr) throw truncErr
    console.log('Truncated.')

    // 1. Load all non-tokenstr, non-burned checks
    console.log('Loading market checks from Supabase…')
    const { data: rawRows, error } = await supabase
      .from('all_checks')
      .select('token_id, checks_count, color_band, gradient, check_struct, eth_price')
      .eq('is_burned', false)
      .eq('is_tokenstr', false)
      .order('checks_count')

    if (error) throw error

    const rows = rawRows as CheckRow[]
    console.log(`${rows.length} market tokens loaded.`)

    if (rows.length === 0) {
      await finishLog(logId, 'done', 0)
      return
    }

    // 2. Group by checks_count
    const byCount = new Map<number, CheckRow[]>()
    for (const row of rows) {
      const group = byCount.get(row.checks_count) ?? []
      group.push(row)
      byCount.set(row.checks_count, group)
    }

    // 3. For each checks_count group, compute diversity-weighted permutations
    const batch: AllPermRow[] = []

    groupLoop:
    for (const [checksCount, tokens] of byCount) {
      const n = tokens.length
      if (n < 4) {
        console.log(`checks_count=${checksCount}: only ${n} tokens, skipping (need ≥4).`)
        continue
      }

      // Allocate up to remaining budget for this group
      const remaining = MAX_TOTAL - totalPerms
      if (remaining <= 0) break

      const perGroup = Math.min(perm4(n), remaining)
      console.log(`\nchecks_count=${checksCount}: ${n} tokens → sampling up to ${perGroup.toLocaleString()} perms`)

      // Weighted shuffle so rare tokens appear earlier in iteration
      const shuffled = weightedShuffle(tokens, tokenWeight)
      const structs  = shuffled.map(t => checkStructFromJSON(t.check_struct))

      let computed  = 0
      let lastPct   = -1

      outer:
      for (let i0 = 0; i0 < n; i0++) {
        for (let i1 = 0; i1 < n; i1++) {
          if (i1 === i0) continue
          for (let i2 = 0; i2 < n; i2++) {
            if (i2 === i0 || i2 === i1) continue
            for (let i3 = 0; i3 < n; i3++) {
              if (i3 === i0 || i3 === i1 || i3 === i2) continue

              try {
                batch.push(computePermutation(
                  structs[i0], shuffled[i0].token_id, shuffled[i0].eth_price,
                  structs[i1], shuffled[i1].token_id, shuffled[i1].eth_price,
                  structs[i2], shuffled[i2].token_id, shuffled[i2].eth_price,
                  structs[i3], shuffled[i3].token_id, shuffled[i3].eth_price,
                ))
                computed++
              } catch (err) {
                console.warn(`  Skip (${shuffled[i0].token_id},${shuffled[i1].token_id},${shuffled[i2].token_id},${shuffled[i3].token_id}): ${String(err)}`)
                continue
              }

              if (batch.length >= BATCH_SIZE) {
                await flushBatch(batch)
                totalPerms += batch.length
                batch.length = 0

                const pct = Math.floor((computed / perGroup) * 10) * 10
                if (pct !== lastPct) {
                  lastPct = pct
                  const filled = Math.floor(pct * 30 / 100)
                  const bar = '█'.repeat(filled) + '░'.repeat(30 - filled)
                  console.log(`  [${bar}] ${pct}% (${computed.toLocaleString()} / ${perGroup.toLocaleString()})`)
                }
              }

              if (computed >= perGroup || totalPerms + batch.length >= MAX_TOTAL) break outer
            }
          }
        }
      }

      // Flush remaining rows from this group
      if (batch.length > 0) {
        await flushBatch(batch)
        totalPerms += batch.length
        batch.length = 0
      }

      console.log(`  Done: ${computed.toLocaleString()} perms stored (total: ${totalPerms.toLocaleString()})`)

      if (totalPerms >= MAX_TOTAL) break groupLoop
    }

    await finishLog(logId, 'done', totalPerms)
    console.log(`\nFinished. ${totalPerms.toLocaleString()} total permutations stored.`)
  } catch (err) {
    await finishLog(logId, 'error', totalPerms, String(err))
    console.error('Script failed:', err)
    process.exit(1)
  }
}

main()
