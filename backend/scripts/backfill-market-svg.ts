/**
 * backfill-market-svg.ts
 *
 * One-time: computes svg for every all_checks row where svg IS NULL, using
 * the already-stored check_struct and the JS rendering engine — no on-chain
 * calls needed. backfill-market-checks.ts originally left this field null to
 * keep the initial backfill fast (computing it via the real tokenURI() would
 * mean an extra RPC call per token); check_struct already has everything
 * generateSVGJS needs to reproduce the exact same output.
 *
 * Usage: npm run backfill-market-svg
 */

import { createClient } from '@supabase/supabase-js'
import { checkStructFromJSON, generateSVGJS, type CheckStructJSON } from '../lib/engine.js'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const PAGE_SIZE            = 500

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY in backend/.env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

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

      const updates = rows.map(row => {
        const check = checkStructFromJSON(row.check_struct as CheckStructJSON)
        const svg = generateSVGJS(check, new Map())
        return { token_id: row.token_id, svg }
      })

      const { error: rpcError } = await supabase.rpc('bulk_update_check_svg', { p_updates: updates })
      if (rpcError) throw rpcError
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
