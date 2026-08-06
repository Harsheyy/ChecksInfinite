/**
 * backfill-check-structs — repair all_checks rows whose check_struct was never
 * decoded.
 *
 * Until 2026-08-06 the three edge functions' decodeGetCheck() returned
 * `{ _raw: "0x…" }` instead of decoding, so every token they wrote had no
 * `stored` key. Those rows are invisible to the permutation engine
 * (checkStructFromJSON reads j.stored.composites) and took the nightly refresh
 * down. The functions decode properly now; this repairs what they already
 * wrote.
 *
 * Idempotent: it only touches rows that are still missing `stored`, so it is
 * safe to re-run.
 *
 * Run: npx tsx --env-file=.env scripts/backfill-check-structs.ts
 * Needs: SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { decodeFunctionResult } from 'viem'

const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const GET_CHECK_SELECTOR = '0x9db797f0'

const BATCH = 10          // tokens fetched in parallel
const PAUSE_MS = 250      // between batches, to stay inside Alchemy's CU budget

const supabaseUrl = process.env.SUPABASE_URL
const serviceKey  = process.env.SUPABASE_SERVICE_KEY
const alchemyKey  = process.env.ALCHEMY_API_KEY
if (!supabaseUrl || !serviceKey || !alchemyKey) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY or ALCHEMY_API_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)
const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`

const getCheckAbi = [
  {
    name: 'getCheck',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'check',
        type: 'tuple',
        components: [
          {
            name: 'stored',
            type: 'tuple',
            components: [
              { name: 'composites',   type: 'uint16[6]' },
              { name: 'colorBands',   type: 'uint8[5]' },
              { name: 'gradients',    type: 'uint8[5]' },
              { name: 'divisorIndex', type: 'uint8' },
              { name: 'epoch',        type: 'uint32' },
              { name: 'seed',         type: 'uint16' },
              { name: 'day',          type: 'uint24' },
            ],
          },
          { name: 'isRevealed',    type: 'bool' },
          { name: 'seed',          type: 'uint256' },
          { name: 'checksCount',   type: 'uint8' },
          { name: 'hasManyChecks', type: 'bool' },
          { name: 'composite',     type: 'uint16' },
          { name: 'isRoot',        type: 'bool' },
          { name: 'colorBand',     type: 'uint8' },
          { name: 'gradient',      type: 'uint8' },
          { name: 'direction',     type: 'uint8' },
          { name: 'speed',         type: 'uint8' },
        ],
      },
    ],
  },
] as const

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchStruct(tokenId: number): Promise<Record<string, unknown> | null> {
  const data = GET_CHECK_SELECTOR + tokenId.toString(16).padStart(64, '0')
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: CHECKS_CONTRACT, data }, 'latest'],
    }),
  })
  const json = await res.json()
  if (json.error || !json.result || json.result === '0x') {
    console.warn(`  token ${tokenId}: eth_call failed — ${JSON.stringify(json.error ?? json.result)}`)
    return null
  }

  const c = decodeFunctionResult({
    abi: getCheckAbi, functionName: 'getCheck', data: json.result,
  }) as any

  // Same shape as checkStructToJSON — seed as a decimal string so the uint256
  // survives jsonb without precision loss.
  return {
    stored: {
      composites:   [...c.stored.composites],
      colorBands:   [...c.stored.colorBands],
      gradients:    [...c.stored.gradients],
      divisorIndex: c.stored.divisorIndex,
      epoch:        c.stored.epoch,
      seed:         c.stored.seed,
      day:          c.stored.day,
    },
    isRevealed:    c.isRevealed,
    seed:          c.seed.toString(),
    checksCount:   c.checksCount,
    hasManyChecks: c.hasManyChecks,
    composite:     c.composite,
    isRoot:        c.isRoot,
    colorBand:     c.colorBand,
    gradient:      c.gradient,
    direction:     c.direction,
    speed:         c.speed,
  }
}

async function main() {
  const { data: rows, error } = await supabase
    .from('all_checks')
    .select('token_id')
    .is('check_struct->stored', null)
    .order('token_id')

  if (error) throw error

  const tokenIds = (rows ?? []).map((r: { token_id: number }) => r.token_id)
  console.log(`${tokenIds.length} token(s) with an undecoded check_struct.`)
  if (tokenIds.length === 0) return

  let repaired = 0
  let failed   = 0

  for (let i = 0; i < tokenIds.length; i += BATCH) {
    if (i > 0) await sleep(PAUSE_MS)
    const batch = tokenIds.slice(i, i + BATCH)
    const structs = await Promise.all(batch.map(id => fetchStruct(id).catch(e => {
      console.warn(`  token ${id}: ${e}`)
      return null
    })))

    for (let j = 0; j < batch.length; j++) {
      const struct = structs[j]
      if (!struct) { failed++; continue }
      const { error: updErr } = await supabase
        .from('all_checks')
        .update({ check_struct: struct })
        .eq('token_id', batch[j])
      if (updErr) { console.warn(`  token ${batch[j]}: update failed — ${updErr.message}`); failed++ }
      else repaired++
    }

    console.log(`  ${Math.min(i + BATCH, tokenIds.length)} / ${tokenIds.length}`)
  }

  console.log(`\nRepaired ${repaired}, failed ${failed}.`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error('Script failed:', e); process.exit(1) })
