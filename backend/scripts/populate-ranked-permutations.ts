/**
 * populate-ranked-permutations.ts
 *
 * Repopulates the permutations table with only low-band and gradient checks.
 * Eligible: color_band IN ('Twenty','Ten','Five','One') OR gradient != 'None'
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
const MAX_PERMS_PER_GROUP  = 500_000  // cap per checks_count group for storage safety

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
}

// ─── Eligibility & scoring ────────────────────────────────────────────────────

const LOW_BAND_NAMES = new Set(['Twenty', 'Ten', 'Five', 'One'])

function isEligible(row: CheckRow): boolean {
  return LOW_BAND_NAMES.has(row.color_band ?? '') ||
    (row.gradient !== null && row.gradient !== 'None')
}

/** rank_score = gradient_count × 4 + rarity_score
 *  rarity: colorBand index 3→1, 4→2, 5→3, 6→4 (Twenty/Ten/Five/One) */
function computeRankScore(structs: CheckStruct[]): number {
  const gradientCount = structs.filter(s => s.gradient > 0).length
  const rarityScore   = structs.reduce((sum, s) => sum + Math.max(0, s.colorBand - 2), 0)
  return gradientCount * 4 + rarityScore
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const logId = await startLog()
  let totalPerms = 0

  try {
    // 0. Wipe existing permutations for a clean nightly refresh
    console.log('Truncating existing permutations...')
    const { error: truncErr } = await supabase.rpc('truncate_permutations')
    if (truncErr) throw truncErr
    console.log('Truncated.')

    // 1. Load all non-burned checks with band/gradient metadata
    console.log('Loading checks from Supabase...')
    const { data: rawRows, error } = await supabase
      .from('tokenstr_checks')
      .select('token_id, checks_count, color_band, gradient, check_struct')
      .eq('is_burned', false)
      .order('checks_count')

    if (error) throw error

    // 2. Filter to eligible checks (low-band OR gradient)
    const rows = (rawRows as CheckRow[]).filter(isEligible)
    console.log(`${rawRows?.length ?? 0} total checks → ${rows.length} eligible (low-band or gradient).`)

    if (rows.length === 0) {
      console.log('No eligible checks found.')
      await finishLog(logId, 'done', 0)
      return
    }

    // 3. Group by checks_count
    const byCount = new Map<number, CheckRow[]>()
    for (const row of rows) {
      const key   = row.checks_count
      const group = byCount.get(key) ?? []
      group.push(row)
      byCount.set(key, group)
    }

    // 4. For each group, compute all P(n, 4) permutations
    for (const [checksCount, tokens] of byCount) {
      const n = tokens.length
      if (n < 4) {
        console.log(`checks_count=${checksCount}: only ${n} eligible tokens, skipping (need ≥4).`)
        continue
      }

      const total = perm4(n)
      console.log(`\nchecks_count=${checksCount}: ${n} tokens → ${total.toLocaleString()} permutations`)

      // Shuffle tokens so each nightly run samples a different subset of P(n,4)
      const shuffled = [...tokens]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }

      // Pre-convert to CheckStruct once per token (after shuffle)
      const structs: CheckStruct[] = shuffled.map(t => checkStructFromJSON(t.check_struct))

      const batch: PermutationRow[] = []
      let computed = 0

      const cappedTotal = Math.min(total, MAX_PERMS_PER_GROUP)
      console.log(`  Sampling up to ${cappedTotal.toLocaleString()} permutations (cap: ${MAX_PERMS_PER_GROUP.toLocaleString()})`)

      outer:
      for (let i0 = 0; i0 < n; i0++) {
        for (let i1 = 0; i1 < n; i1++) {
          if (i1 === i0) continue
          for (let i2 = 0; i2 < n; i2++) {
            if (i2 === i0 || i2 === i1) continue
            for (let i3 = 0; i3 < n; i3++) {
              if (i3 === i0 || i3 === i1 || i3 === i2) continue

              try {
                const row = computePermutation(
                  structs[i0], shuffled[i0].token_id,
                  structs[i1], shuffled[i1].token_id,
                  structs[i2], shuffled[i2].token_id,
                  structs[i3], shuffled[i3].token_id,
                )
                batch.push(row)
                computed++
              } catch (err) {
                console.warn(`  Skipping (${shuffled[i0].token_id},${shuffled[i1].token_id},${shuffled[i2].token_id},${shuffled[i3].token_id}): ${String(err)}`)
                continue
              }

              if (batch.length >= BATCH_SIZE) {
                await flushBatch(batch)
                totalPerms += batch.length
                batch.length = 0
                process.stdout.write(`\r  ${computed.toLocaleString()} / ${cappedTotal.toLocaleString()} computed`)
              }

              if (computed >= MAX_PERMS_PER_GROUP) break outer
            }
          }
        }
      }

      if (batch.length > 0) {
        await flushBatch(batch)
        totalPerms += batch.length
        batch.length = 0
      }

      console.log(`\n  Done: ${computed.toLocaleString()} permutations stored.`)
    }

    await finishLog(logId, 'done', totalPerms)
    console.log(`\nFinished. ${totalPerms.toLocaleString()} total permutations stored.`)
  } catch (err) {
    await finishLog(logId, 'error', totalPerms, String(err))
    console.error('Script failed:', err)
    process.exit(1)
  }
}

// ─── Compute one permutation ───────────────────────────────────────────────

function computePermutation(
  s0: CheckStruct, id0: number,
  s1: CheckStruct, id1: number,
  s2: CheckStruct, id2: number,
  s3: CheckStruct, id3: number,
): PermutationRow {
  const l1aStruct  = simulateCompositeJS(s0, s1, id1)
  const l1bStruct  = simulateCompositeJS(s2, s3, id3)
  const abcdStruct = computeL2(l1aStruct, l1bStruct)
  const abcdAttrs  = mapCheckAttributes(abcdStruct)
  const getAttr    = (name: string) => abcdAttrs.find(a => a.trait_type === name)?.value ?? null

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
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function flushBatch(batch: PermutationRow[]) {
  const { error } = await supabase
    .from('permutations')
    .insert(batch)
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

main()
