/**
 * populate-ranked-permutations.ts
 *
 * Nightly refresh of the permutations table (Token Works feed) — up to 100K
 * tokenstr permutations, biased heavily toward gradient and low-band results.
 *
 * Eligibility: input token must have a low color band (Twenty/Ten/Five/One)
 *              OR a gradient — unlisted plain Eighty-band checks are excluded.
 *
 * Sampling strategy:
 *   - Filter eligible tokenstr checks (is_tokenstr = true, not burned)
 *   - Group by checks_count (to pair same-depth tokens)
 *   - Within each group, use weighted shuffle so gradient + low-band tokens
 *     appear earlier in the P(n,4) iteration
 *   - Stop globally at MAX_TOTAL across all groups
 *
 * Weight map: One→12, Five→9, Ten→6, Twenty→4, Forty→2, Eighty/null→1
 * Gradient bonus: +5 (primary emphasis per product spec)
 *
 * Usage:
 *   npm run populate-ranked
 */

import { createClient } from '@supabase/supabase-js'
import {
  simulateCompositeJS,
  mapCheckAttributes,
  computeL2,
  checkStructFromJSON,
  type CheckStruct,
  type CheckStructJSON,
} from '../lib/engine.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const BATCH_SIZE           = 500
const MAX_TOTAL            = 100_000

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Copy .env.example to .env and fill in values.')
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

interface PermutationRow {
  keeper_1_id:     number
  burner_1_id:     number
  keeper_2_id:     number
  burner_2_id:     number
  abcd_checks:     number | null
  abcd_color_band: string | null
  abcd_gradient:   string | null
  abcd_speed:      string | null
  abcd_shift:      string | null
  rank_score:      number
  rand_key:        number
  total_cost:      number | null
}

// ─── Eligibility: low-band OR gradient ───────────────────────────────────────

const LOW_BAND_NAMES = new Set(['Twenty', 'Ten', 'Five', 'One'])

function isEligible(row: CheckRow): boolean {
  return LOW_BAND_NAMES.has(row.color_band ?? '') ||
    (row.gradient !== null && row.gradient !== 'None')
}

/**
 * The engine needs a decoded check_struct. The three edge functions currently
 * write `{ _raw: "0x…" }` — decodeGetCheck() never decoded anything — so rows
 * they touch have no `stored` key and blow up checkStructFromJSON with
 * "Cannot read properties of undefined (reading 'composites')".
 *
 * That took the whole nightly run down on 2026-08-06 and, because the run
 * truncates first, left the Explore feed with an empty table. Skipping these
 * rows keeps one bad token from costing the entire feed. It is a guard, not
 * the fix: the real fix is to make decodeGetCheck decode.
 */
function hasUsableStruct(row: CheckRow): boolean {
  const s = row.check_struct as { stored?: unknown } | null
  return !!s && typeof s === 'object' && s.stored !== undefined
}

// ─── Weighted shuffle — gradient has primary emphasis ─────────────────────────

const BAND_WEIGHT: Record<string, number> = {
  One:    12,
  Five:   9,
  Ten:    6,
  Twenty: 4,
  Forty:  2,
  Sixty:  1,
  Eighty: 1,
}

function tokenWeight(row: CheckRow): number {
  const base       = BAND_WEIGHT[row.color_band ?? ''] ?? 1
  const gradBonus  = (row.gradient && row.gradient !== 'None') ? 5 : 0
  return base + gradBonus
}

function weightedShuffle<T>(items: T[], weight: (t: T) => number): T[] {
  return items
    .map(t => ({ t, key: -Math.log(Math.random()) / weight(t) }))
    .sort((a, b) => a.key - b.key)
    .map(({ t }) => t)
}

// ─── rank_score: stored for potential future ordering ─────────────────────────

function computeRankScore(structs: CheckStruct[]): number {
  const gradientCount = structs.filter(s => s.gradient > 0).length
  const rarityScore   = structs.reduce((sum, s) => sum + Math.max(0, s.colorBand - 2), 0)
  return gradientCount * 4 + rarityScore
}

// ─── Compute one permutation row ─────────────────────────────────────────────

function computePermutation(
  s0: CheckStruct, id0: number, price0: number | null,
  s1: CheckStruct, id1: number, price1: number | null,
  s2: CheckStruct, id2: number, price2: number | null,
  s3: CheckStruct, id3: number, price3: number | null,
): PermutationRow {
  const l1aStruct  = simulateCompositeJS(s0, s1, id1)
  const l1bStruct  = simulateCompositeJS(s2, s3, id3)
  const abcdStruct = computeL2(l1aStruct, l1bStruct)
  const abcdAttrs  = mapCheckAttributes(abcdStruct)
  const getAttr    = (name: string) => abcdAttrs.find(a => a.trait_type === name)?.value ?? null

  const total_cost = (price0 !== null && price1 !== null && price2 !== null && price3 !== null)
    ? price0 + price1 + price2 + price3
    : null

  return {
    keeper_1_id:     id0,
    burner_1_id:     id1,
    keeper_2_id:     id2,
    burner_2_id:     id3,
    abcd_checks:     getAttr('Checks') !== null ? Number(getAttr('Checks')) : null,
    abcd_color_band: getAttr('Color Band'),
    abcd_gradient:   getAttr('Gradient'),
    abcd_speed:      getAttr('Speed'),
    abcd_shift:      getAttr('Shift'),
    rank_score:      computeRankScore([s0, s1, s2, s3]),
    rand_key:        Math.random(),
    total_cost,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Rows go to staging, never straight to `permutations` — the live table is
 * replaced in one transaction by swap_permutations() only after a full run
 * succeeds. See migration 054.
 */
async function flushBatch(batch: PermutationRow[]) {
  const { error } = await supabase.from('permutations_staging').insert(batch)
  if (error) throw error
}

function perm4(n: number): number {
  return n * (n - 1) * (n - 2) * (n - 3)
}

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'permutations', status: 'running' })
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
    // Clear staging only. The live `permutations` table keeps serving the old
    // set for the whole run and is replaced by swap_permutations() at the end,
    // so a crash here costs nothing but a stale day.
    console.log('Clearing staging table…')
    const { error: truncErr } = await supabase.rpc('truncate_permutations_staging')
    if (truncErr) throw truncErr
    console.log('Staging cleared.')

    console.log('Loading tokenstr checks…')
    const { data: rawRows, error } = await supabase
      .from('all_checks')
      .select('token_id, checks_count, color_band, gradient, check_struct, eth_price')
      .eq('is_burned', false)
      .eq('is_tokenstr', true)
      .order('checks_count', { ascending: false }) // largest groups first

    if (error) throw error

    const allRows  = rawRows as CheckRow[]
    const usable   = allRows.filter(hasUsableStruct)
    const skipped  = allRows.filter(row => !hasUsableStruct(row))
    const rows     = usable.filter(isEligible)

    if (skipped.length > 0) {
      // Loud, and with the ids, so this can't rot unnoticed the way it did.
      console.warn(
        `WARNING: skipping ${skipped.length} token(s) with an undecoded check_struct — ` +
        `these need decodeGetCheck() fixed and a backfill: ` +
        skipped.map(r => r.token_id).join(', '),
      )
    }

    console.log(`${allRows.length} tokenstr checks → ${rows.length} eligible (low-band or gradient).`)

    if (rows.length === 0) {
      // Don't swap — the live table keeps yesterday's rows. An empty eligible
      // set is a fault upstream (bad structs, a failed token sync), not a
      // legitimate "today there is nothing", so it fails loudly rather than
      // logging a green run over a silently broken feed.
      console.error('No eligible tokens with a usable check_struct — leaving the live feed untouched.')
      await finishLog(logId, 'error', 0, 'no eligible tokens; skipped swap')
      process.exit(1)
    }

    // Group by checks_count
    const byCount = new Map<number, CheckRow[]>()
    for (const row of rows) {
      const group = byCount.get(row.checks_count) ?? []
      group.push(row)
      byCount.set(row.checks_count, group)
    }

    // Process groups largest-first (80-check tokenstr tokens dominate)
    const groups = [...byCount.entries()].sort((a, b) => b[0] - a[0])
    const batch: PermutationRow[] = []

    for (const [checksCount, tokens] of groups) {
      if (totalPerms >= MAX_TOTAL) break

      const n = tokens.length
      if (n < 4) {
        console.log(`checks_count=${checksCount}: only ${n} eligible tokens, skipping.`)
        continue
      }

      const remaining = MAX_TOTAL - totalPerms
      const perGroup  = Math.min(perm4(n), remaining)
      console.log(`\nchecks_count=${checksCount}: ${n} eligible tokens → up to ${perGroup.toLocaleString()} perms`)

      // Weighted shuffle: gradient tokens and rare bands appear earlier
      const shuffled = weightedShuffle(tokens, tokenWeight)
      const structs  = shuffled.map(t => checkStructFromJSON(t.check_struct))

      let computed = 0
      let lastPct  = -1

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
                console.warn(`  Skip: ${String(err)}`)
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

      if (batch.length > 0) {
        await flushBatch(batch)
        totalPerms += batch.length
        batch.length = 0
      }

      console.log(`  Done: ${computed.toLocaleString()} perms stored (total: ${totalPerms.toLocaleString()})`)
    }

    await finishLog(logId, 'done', totalPerms)
    // Publish. Everything above touched staging only; this is the first and
    // only moment the live table changes, and it changes in one transaction.
    console.log('\nSwapping staging into permutations…')
    const { data: swapped, error: swapErr } = await supabase.rpc('swap_permutations')
    if (swapErr) throw swapErr
    console.log(`Swapped. ${Number(swapped).toLocaleString()} rows now live.`)

    console.log(`Finished. ${totalPerms.toLocaleString()} total permutations stored.`)
  } catch (err) {
    await finishLog(logId, 'error', totalPerms, String(err))
    console.error('Script failed:', err)
    process.exit(1)
  }
}

main()
