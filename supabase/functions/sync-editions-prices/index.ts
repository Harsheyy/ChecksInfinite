/**
 * sync-editions-prices — Supabase Edge Function
 *
 * Hourly sync of OpenSea listing prices for the Checks Editions collection:
 *   1. Fetch all active listings for the vv-checks collection via OpenSea API
 *   2. Write the lowest ask per token into editions_checks.eth_price
 *   3. Clear eth_price for tokens that are no longer listed
 *
 * Deploy:   supabase functions deploy sync-editions-prices
 * Schedule: supabase/migrations/043_editions_prices_cron.sql (pg_cron, hourly at :20)
 * Manual:   POST /functions/v1/sync-editions-prices with header x-cron-secret: <CRON_SECRET>
 *
 * Required secrets (set in Supabase dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENSEA_API_KEY, CRON_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const COLLECTION_SLUG     = 'vv-checks'
const EDITIONS_CONTRACT   = '0x34eebee6942d8def3c125458d1a86e0a897fd6f9'
const DB_BATCH            = 500

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET not set — rejecting request')
    return new Response('CRON_SECRET not configured', { status: 500 })
  }
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', cronSecret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const OPENSEA_API_KEY = Deno.env.get('OPENSEA_API_KEY')!
  if (!OPENSEA_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENSEA_API_KEY secret not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const logId = await startLog(supabase)

  try {
    // ── 1. Fetch all active OpenSea listings ───────────────────────────────────
    const priceMap = await fetchAllListings(OPENSEA_API_KEY)
    console.log(`Fetched ${priceMap.size} unique listed Editions tokens from OpenSea`)

    // ── 2. Load all known token IDs from DB ────────────────────────────────────
    const { data: allRows, error: dbErr } = await supabase
      .from('editions_checks')
      .select('token_id')
    if (dbErr) throw dbErr

    const allIds = (allRows ?? []).map((r: { token_id: number }) => r.token_id)
    console.log(`${allIds.length} Editions tokens in DB`)

    // ── 3. Build update batches ────────────────────────────────────────────────
    const updates = allIds.map(id => ({
      token_id:  id,
      eth_price: priceMap.get(id) ?? null,
      is_listed: priceMap.has(id),
    }))

    // ── 4. Bulk update in batches ──────────────────────────────────────────────
    let updated = 0
    for (let i = 0; i < updates.length; i += DB_BATCH) {
      const batch = updates.slice(i, i + DB_BATCH)
      const { data, error } = await supabase.rpc('bulk_update_editions_prices', { p_updates: batch })
      if (error) console.warn(`Update error batch ${i}:`, error.message)
      else updated += (data as number) ?? 0
    }

    await finishLog(supabase, logId, 'done', updated)
    return new Response(
      JSON.stringify({ ok: true, updated, listed: priceMap.size, total: allIds.length }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('sync-editions-prices error:', err)
    await finishLog(supabase, logId, 'error', 0, errMsg(err))
    return new Response(JSON.stringify({ error: errMsg(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ─── OpenSea listings fetch ───────────────────────────────────────────────────

async function fetchAllListings(apiKey: string): Promise<Map<number, number>> {
  const priceMap = new Map<number, number>()
  const base = `https://api.opensea.io/api/v2/listings/collection/${COLLECTION_SLUG}/all`
  let cursor: string | undefined
  let page = 0

  do {
    const params = new URLSearchParams({ limit: '100', ...(cursor ? { next: cursor } : {}) })
    const res = await fetch(`${base}?${params}`, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
    })

    if (res.status === 429) {
      console.warn('Rate limited by OpenSea, waiting 10s…')
      await new Promise(r => setTimeout(r, 10_000))
      continue
    }
    if (!res.ok) throw new Error(`OpenSea error: ${res.status} ${await res.text()}`)

    const json = await res.json() as {
      listings: {
        price: { current: { currency: string; decimals: number; value: string } }
        protocol_data: { parameters: { offer: { itemType: number; token: string; identifierOrCriteria: string }[] } }
      }[]
      next?: string
    }
    page++

    for (const listing of json.listings) {
      const offer = listing.protocol_data?.parameters?.offer?.[0]
      if (!offer) continue
      if (offer.token.toLowerCase() !== EDITIONS_CONTRACT) continue
      const tokenId  = Number(offer.identifierOrCriteria)
      const priceEth = Number(BigInt(listing.price.current.value)) / 1e18
      const existing = priceMap.get(tokenId)
      if (existing === undefined || priceEth < existing) priceMap.set(tokenId, priceEth)
    }

    cursor = json.next
    if (page % 10 === 0) console.log(`Page ${page}, ${priceMap.size} listings so far…`)
  } while (cursor)

  console.log(`Fetched ${page} pages — ${priceMap.size} listed Editions tokens`)
  return priceMap
}

// ─── sync_log helpers ─────────────────────────────────────────────────────────

async function startLog(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'sync-editions-prices', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

async function finishLog(
  supabase: ReturnType<typeof createClient>,
  id: number,
  status: 'done' | 'error',
  tokensProcessed: number,
  errorMessage?: string,
) {
  await supabase
    .from('sync_log')
    .update({
      status,
      tokens_processed: tokensProcessed,
      error_message:    errorMessage ?? null,
      finished_at:      new Date().toISOString(),
    })
    .eq('id', id)
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab  = enc.encode(a)
  const bb  = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}
