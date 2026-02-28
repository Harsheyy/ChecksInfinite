/**
 * compute-permutations.ts — precomputes all P(n,4) ordered composites for
 * TokenWorks-listed checks and stores them in the `permutations` Supabase table.
 *
 * Usage:
 *   npx tsx scripts/compute-permutations.ts              # full run
 *   npx tsx scripts/compute-permutations.ts --incremental  # skip existing rows
 *
 * Scale note: For groups where P(n,4) is very large (80-check tokens with
 * hundreds of listings), set MAX_GROUP_SIZE to cap the run.
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

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const BATCH_SIZE           = 50   // keep upserts small — SVG strings are large
const INCREMENTAL          = process.argv.includes('--incremental')

// Cap group size to avoid P(n,4) explosion.
// Set to Infinity to compute all permutations.
const MAX_GROUP_SIZE       = Number(process.env.MAX_GROUP_SIZE ?? 30)

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Copy .env.example to .env and fill in values.')
  process.exit(1)
}

// ─── Client ───────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckRow {
  token_id:    number
  checks_count: number
  check_struct: CheckStructJSON
}

interface PermutationRow {
  keeper_1_id:     number
  burner_1_id:     number
  keeper_2_id:     number
  burner_2_id:     number
  // SVGs not stored — computed client-side from check_struct data
  abcd_checks:     number | null
  abcd_color_band: string | null
  abcd_gradient:   string | null
  abcd_speed:      string | null
  abcd_shift:      string | null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const logId = await startLog()
  let totalPerms = 0

  try {
    // 1. Load listed checks (non-burned, joined with vv_checks_listings)
    console.log('Loading listed checks from Supabase...')
    const { data: rows, error } = await supabase
      .from('listed_checks')
      .select('token_id, checks_count, check_struct')
      .order('checks_count')

    if (error) throw error
    if (!rows || rows.length === 0) {
      console.log('No listed checks found.')
      await finishLog(logId, 'done', 0)
      return
    }

    console.log(`Loaded ${rows.length} checks.`)

    // 2. Group by divisorIndex (same as checks_count grouping)
    const byCount = new Map<number, CheckRow[]>()
    for (const row of rows as CheckRow[]) {
      const key = row.checks_count
      const group = byCount.get(key) ?? []
      group.push(row)
      byCount.set(key, group)
    }

    // 3. For each group, compute all P(n,4) permutations
    for (const [checksCount, tokens] of byCount) {
      let n = tokens.length
      if (n < 4) {
        console.log(`checks_count=${checksCount}: only ${n} tokens, skipping (need ≥4).`)
        continue
      }

      // Cap group size
      if (n > MAX_GROUP_SIZE) {
        console.log(`checks_count=${checksCount}: ${n} tokens — capping to ${MAX_GROUP_SIZE} (P(${MAX_GROUP_SIZE},4) = ${perm4(MAX_GROUP_SIZE).toLocaleString()} permutations).`)
        n = MAX_GROUP_SIZE
      }

      const group = tokens.slice(0, n)
      const total = perm4(n)
      console.log(`\nchecks_count=${checksCount}: ${n} tokens → ${total.toLocaleString()} permutations`)

      // In incremental mode, build a set of already-computed keys to skip
      const existingKeys = new Set<string>()
      if (INCREMENTAL) {
        const keeperIds = group.map(t => t.token_id)
        const { data: existing } = await supabase
          .from('permutations')
          .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id')
          .in('keeper_1_id', keeperIds)
        for (const row of existing ?? []) {
          existingKeys.add(`${row.keeper_1_id}-${row.burner_1_id}-${row.keeper_2_id}-${row.burner_2_id}`)
        }
        console.log(`  Incremental: ${existingKeys.size} already computed, skipping.`)
      }

      // Precompute CheckStruct objects (avoid repeated JSON → struct conversion)
      const structs: CheckStruct[] = group.map(t => checkStructFromJSON(t.check_struct))

      const batch: PermutationRow[] = []
      let computed = 0
      let skipped  = 0

      for (let i0 = 0; i0 < n; i0++) {
        for (let i1 = 0; i1 < n; i1++) {
          if (i1 === i0) continue
          for (let i2 = 0; i2 < n; i2++) {
            if (i2 === i0 || i2 === i1) continue
            for (let i3 = 0; i3 < n; i3++) {
              if (i3 === i0 || i3 === i1 || i3 === i2) continue

              const t0 = group[i0], t1 = group[i1], t2 = group[i2], t3 = group[i3]

              if (INCREMENTAL) {
                const key = `${t0.token_id}-${t1.token_id}-${t2.token_id}-${t3.token_id}`
                if (existingKeys.has(key)) { skipped++; continue }
              }

              try {
                const row = computePermutation(
                  structs[i0], t0.token_id,
                  structs[i1], t1.token_id,
                  structs[i2], t2.token_id,
                  structs[i3], t3.token_id,
                )
                batch.push(row)
                computed++
              } catch (err) {
                // Individual computation failure — log and continue
                console.warn(`  Skipping (${t0.token_id},${t1.token_id},${t2.token_id},${t3.token_id}): ${String(err)}`)
                continue
              }

              if (batch.length >= BATCH_SIZE) {
                await flushBatch(batch)
                totalPerms += batch.length
                batch.length = 0
                process.stdout.write(`\r  ${computed.toLocaleString()} / ${total.toLocaleString()} computed`)
              }
            }
          }
        }
      }

      if (batch.length > 0) {
        await flushBatch(batch)
        totalPerms += batch.length
        batch.length = 0
      }

      console.log(`\n  Done: ${computed} computed, ${skipped} skipped (incremental).`)
    }

    await finishLog(logId, 'done', totalPerms)
    console.log(`\nFinished. ${totalPerms.toLocaleString()} total permutations stored.`)
  } catch (err) {
    await finishLog(logId, 'error', totalPerms, String(err))
    console.error('Permutation script failed:', err)
    process.exit(1)
  }
}

// ─── Compute one permutation ──────────────────────────────────────────────────

function computePermutation(
  s0: CheckStruct, id0: number,
  s1: CheckStruct, id1: number,
  s2: CheckStruct, id2: number,
  s3: CheckStruct, id3: number,
): PermutationRow {
  // L1a = composite(keeper=p0, burner=p1)
  const l1aStruct = simulateCompositeJS(s0, s1, id1)

  // L1b = composite(keeper=p2, burner=p3)
  const l1bStruct = simulateCompositeJS(s2, s3, id3)

  // ABCD attributes only — SVG is computed client-side from check_struct data
  const abcdStruct = computeL2(l1aStruct, l1bStruct)
  const abcdAttrs  = mapCheckAttributes(abcdStruct)

  const getAttr = (name: string) => abcdAttrs.find(a => a.trait_type === name)?.value ?? null

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
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function flushBatch(batch: PermutationRow[]) {
  const { error } = await supabase
    .from('permutations')
    .upsert(batch, {
      onConflict: 'keeper_1_id,burner_1_id,keeper_2_id,burner_2_id',
      ignoreDuplicates: true,
    })
  if (error) throw error
}

/** P(n, 4) = n × (n-1) × (n-2) × (n-3) */
function perm4(n: number): number {
  return n * (n - 1) * (n - 2) * (n - 3)
}

// ─── sync_log helpers ─────────────────────────────────────────────────────────

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'permutations', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

async function finishLog(
  id: number,
  status: 'done' | 'error',
  permsComputed: number,
  errorMessage?: string
) {
  await supabase
    .from('sync_log')
    .update({
      status,
      perms_computed: permsComputed,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
}

main()
