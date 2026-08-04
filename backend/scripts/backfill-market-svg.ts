/**
 * backfill-market-svg.ts
 *
 * One-time: computes svg for every all_checks row where svg IS NULL.
 *
 * Base tokens (divisorIndex === 0, i.e. checksCount === 80) are rendered
 * locally via the JS engine using the already-stored check_struct — no
 * on-chain call needed, and it reproduces the exact same output as the
 * contract.
 *
 * Composited tokens (divisorIndex > 0) can't be reconstructed locally:
 * generateSVGJS needs the merge partner's data via a virtual map, but the
 * burned partner referenced by `check.composite` frequently has no row in
 * `all_checks` at all. For these we fetch the real on-chain tokenURI() and
 * decode the embedded SVG instead — mirroring the pattern already used in
 * backfill.ts for TokenStrategy-held (also composited) tokens.
 *
 * Usage: npm run backfill-market-svg
 */

import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { createClient } from '@supabase/supabase-js'
import { checkStructFromJSON, generateSVGJS, parseTokenURI, type CheckStructJSON } from '../lib/engine.js'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const ALCHEMY_KEY          = process.env.ALCHEMY_API_KEY!
const CHECKS_CONTRACT      = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1' as const
const PAGE_SIZE            = 100
const URI_CONCURRENCY      = 20    // tokenURI: parallel individual eth_calls (no multicall)

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ALCHEMY_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY in backend/.env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// No-multicall client — for tokenURI which generates SVG on-chain (~2M gas each),
// same reasoning as backfill.ts's viemClientDirect.
const viemClientDirect = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
})

const ABI = [
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

async function main() {
  const logId = await startLog()
  let tokensProcessed = 0

  try {
    for (;;) {
      // No offset needed: each batch's svg gets set before the next query,
      // so already-processed rows drop out of the `svg IS NULL` filter —
      // querying from the start each time naturally advances through the
      // whole table without skipping or repeating rows.
      const { data, error } = await supabase
        .from('all_checks')
        .select('token_id, check_struct')
        .is('svg', null)
        .order('token_id', { ascending: true })
        .range(0, PAGE_SIZE - 1)
      if (error) throw error

      const rows = data ?? []
      if (rows.length === 0) break

      // Split into base tokens (renderable locally) and composited tokens
      // (need a real on-chain tokenURI call).
      const baseRows: typeof rows = []
      const compositedRows: typeof rows = []
      for (const row of rows) {
        const check = checkStructFromJSON(row.check_struct as CheckStructJSON)
        if (check.stored.divisorIndex === 0) {
          baseRows.push(row)
        } else {
          compositedRows.push(row)
        }
      }

      const updates: { token_id: number; svg: string }[] = []

      for (const row of baseRows) {
        const check = checkStructFromJSON(row.check_struct as CheckStructJSON)
        const svg = generateSVGJS(check, new Map())
        updates.push({ token_id: row.token_id, svg })
      }

      for (let s = 0; s < compositedRows.length; s += URI_CONCURRENCY) {
        const chunk = compositedRows.slice(s, s + URI_CONCURRENCY)
        const results = await Promise.allSettled(
          chunk.map(row =>
            viemClientDirect.readContract({
              address: CHECKS_CONTRACT,
              abi: ABI,
              functionName: 'tokenURI',
              args: [BigInt(row.token_id)],
            })
          )
        )
        results.forEach((result, i) => {
          const row = chunk[i]
          if (result.status !== 'fulfilled') {
            console.warn(`  Token ${row.token_id}: tokenURI call failed, skipping`)
            return
          }
          try {
            const parsed = parseTokenURI(result.value)
            updates.push({ token_id: row.token_id, svg: parsed.svg })
          } catch {
            console.warn(`  Token ${row.token_id}: failed to parse tokenURI, skipping`)
          }
        })
      }

      if (updates.length === 0) {
        // Every row in this batch failed to produce an svg (e.g. all
        // tokenURI calls failed) — nothing to update, so break rather than
        // looping forever on the same unresolvable rows.
        console.warn(`Batch produced no updates out of ${rows.length} rows; stopping to avoid an infinite loop.`)
        break
      }

      const { data: updateCount, error: rpcError } = await supabase.rpc('bulk_update_check_svg', { p_updates: updates })
      if (rpcError) throw rpcError
      if (typeof updateCount === 'number' && updateCount !== updates.length) {
        throw new Error(
          `bulk_update_check_svg updated ${updateCount} rows but ${updates.length} were submitted — ` +
          `stopping to avoid looping on rows that never actually got updated.`
        )
      }
      tokensProcessed += updates.length

      console.log(`Processed ${tokensProcessed} tokens so far…`)

      if (rows.length < PAGE_SIZE) break
    }

    await finishLog(logId, 'done', tokensProcessed)
    console.log(`\nDone. ${tokensProcessed} tokens backfilled with svg.`)
  } catch (err) {
    await finishLog(logId, 'error', tokensProcessed, String(err))
    console.error('Backfill failed:', err)
    process.exit(1)
  }
}

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'backfill-market-svg', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

async function finishLog(id: number, status: 'done' | 'error', tokensProcessed: number, error_message?: string) {
  await supabase
    .from('sync_log')
    .update({ status, tokens_processed: tokensProcessed, error_message: error_message ?? null, finished_at: new Date().toISOString() })
    .eq('id', id)
}

main()
