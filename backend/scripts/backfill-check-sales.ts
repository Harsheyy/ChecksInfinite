/**
 * backfill-check-sales — one-off history fill for checkmath_events.
 *
 * sync-checkmath records sales incrementally each hour, but it only walks
 * back as far as the newest sale it already has. This script seeds that
 * history in the first place, by paging OpenSea's event feed further back
 * than the hourly job ever would.
 *
 * Run:  npx tsx --env-file=backend/.env backend/scripts/backfill-check-sales.ts
 *
 * The window is the age of checkmath_snapshots itself — sales are only
 * recorded from the moment we started tracking single prices, so every
 * marker on the chart sits over a stretch of line it can be compared
 * against. A marker floating to the left of where the lines begin would be
 * claiming a comparison the data can't support.
 *
 * That window also happens to be the only one where the collection test is
 * sound: "was this token a single?" is judged from its CURRENT checks_count,
 * which is exact for recent sales (singles are terminal — a checks_count=1
 * token can only leave that state by being burned into an Infinity) but
 * would misjudge a token sold long ago as a 4-check and composed up since.
 *
 * Safe to re-run: rows are keyed on sale:<tx>:<tokenId> and inserted with
 * ignoreDuplicates.
 */

import { createClient } from '@supabase/supabase-js'

const COLLECTION = 'vv-checks-originals'
const PAGE_LIMIT = 50
const MAX_PAGES = 200

interface SaleEvent {
  event_timestamp: number
  transaction?: string
  nft?: { identifier?: string }
  payment?: { quantity?: string; decimals?: number; symbol?: string }
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENSEA_API_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set')
  if (!OPENSEA_API_KEY) throw new Error('OPENSEA_API_KEY not set')

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Start of history: the first snapshot. Sales before this have no line to
  // be read against.
  const { data: firstSnap, error: snapErr } = await supabase
    .from('checkmath_snapshots')
    .select('computed_at')
    .order('computed_at', { ascending: true })
    .limit(1)
  if (snapErr) throw snapErr
  const firstAt = firstSnap?.[0]?.computed_at
  if (!firstAt) throw new Error('checkmath_snapshots is empty — nothing to align sales to')
  const cutoff = Math.floor(Date.parse(firstAt) / 1000)
  console.log(`recording sales from ${firstAt} (first snapshot) onward`)

  const { data: singleRows, error: singlesErr } = await supabase
    .from('all_checks')
    .select('token_id')
    .eq('checks_count', 1)
    .eq('is_burned', false)
  if (singlesErr) throw singlesErr
  const singleIds = new Set((singleRows ?? []).map(r => r.token_id as number))
  console.log(`${singleIds.size} tokens are currently singles`)

  const rows: {
    kind: string
    token_id: number
    occurred_at: string
    eth_price: number | null
    event_key: string
  }[] = []

  let cursor: string | null = null
  let scanned = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://api.opensea.io/api/v2/events/collection/${COLLECTION}`)
    url.searchParams.set('event_type', 'sale')
    url.searchParams.set('limit', String(PAGE_LIMIT))
    if (cursor) url.searchParams.set('next', cursor)

    const res = await fetch(url, { headers: { 'x-api-key': OPENSEA_API_KEY } })
    if (!res.ok) throw new Error(`OpenSea ${res.status}: ${await res.text()}`)
    const body = (await res.json()) as { asset_events?: SaleEvent[]; next?: string }

    const batch = body.asset_events ?? []
    if (batch.length === 0) break
    scanned += batch.length

    let pastCutoff = false
    for (const ev of batch) {
      if (ev.event_timestamp < cutoff) { pastCutoff = true; continue }
      const tokenId = Number(ev.nft?.identifier)
      if (!Number.isFinite(tokenId) || !singleIds.has(tokenId) || !ev.transaction) continue

      rows.push({
        kind: 'sale',
        token_id: tokenId,
        occurred_at: new Date(ev.event_timestamp * 1000).toISOString(),
        eth_price: parseEth(ev.payment),
        event_key: `sale:${ev.transaction}:${tokenId}`,
      })
    }

    cursor = body.next ?? null
    if (pastCutoff || !cursor) break
    await new Promise(r => setTimeout(r, 250)) // stay well under OpenSea's rate limit
  }

  console.log(`scanned ${scanned} sales, ${rows.length} were singles`)
  if (rows.length === 0) return

  const { error: upsertErr } = await supabase
    .from('checkmath_events')
    .upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true })
  if (upsertErr) throw upsertErr

  const byDay = new Map<string, number>()
  for (const r of rows) {
    const day = r.occurred_at.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  console.log('single sales by day:')
  for (const day of [...byDay.keys()].sort()) console.log(`  ${day}  ${byDay.get(day)}`)
}

function parseEth(payment: SaleEvent['payment']): number | null {
  if (!payment?.quantity) return null
  const symbol = (payment.symbol ?? 'ETH').toUpperCase()
  if (symbol !== 'ETH' && symbol !== 'WETH') return null
  const value = Number(payment.quantity) / 10 ** (payment.decimals ?? 18)
  return Number.isFinite(value) ? value : null
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
