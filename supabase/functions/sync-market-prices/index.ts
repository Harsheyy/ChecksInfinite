/**
 * sync-market-prices — Supabase Edge Function
 *
 * Hourly sync of OpenSea listing prices for all market (non-tokenstr) Checks:
 *   1. Fetch all active listings for the vv-checks-originals collection via OpenSea API
 *   2. Write the lowest ask per token into all_checks.eth_price
 *   3. Clear eth_price for tokens that are no longer listed
 *   4. Call sync_all_listed_permutations() to refresh is_all_listed on all_permutations
 *
 * Deploy:   supabase functions deploy sync-market-prices
 * Schedule: supabase/migrations/025_cron_auth.sql (pg_cron, hourly at :15)
 * Manual:   POST /functions/v1/sync-market-prices with header x-cron-secret: <CRON_SECRET>
 *
 * Required secrets (set in Supabase dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENSEA_API_KEY, CRON_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const COLLECTION_SLUG  = 'vv-checks-originals'
const CHECKS_CONTRACT  = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const DB_BATCH         = 500

Deno.serve(async (req: Request) => {
  // This function is deployed with JWT verification off (pg_net can't sign
  // JWTs), so gate it with a shared secret instead. Fail closed if unset.
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
    console.log(`Fetched ${priceMap.size} unique listed tokens from OpenSea`)

    // ── 2. Load all non-tokenstr, non-burned token IDs from DB ────────────────
    const { data: allRows, error: dbErr } = await supabase
      .from('all_checks')
      .select('token_id')
      .eq('is_tokenstr', false)
      .eq('is_burned', false)
    if (dbErr) throw dbErr

    const allMarketIds = (allRows ?? []).map((r: { token_id: number }) => r.token_id)
    console.log(`${allMarketIds.length} market tokens in DB`)

    // ── 3. Build update batches ────────────────────────────────────────────────
    const listedIds:   number[] = []
    const unlistedIds: number[] = []
    for (const id of allMarketIds) {
      if (priceMap.has(id)) listedIds.push(id)
      else unlistedIds.push(id)
    }
    console.log(`Listed: ${listedIds.length} | Unlisted: ${unlistedIds.length}`)

    // ── 4. Update listed tokens ────────────────────────────────────────────────
    let updated = 0
    for (const id of listedIds) {
      const { error } = await supabase
        .from('all_checks')
        .update({ eth_price: priceMap.get(id)!, is_listed: true, price_source: 'opensea' })
        .eq('token_id', id)
        .eq('is_tokenstr', false)
      if (error) console.warn(`Update error for ${id}:`, error.message)
      else updated++
    }

    // ── 5. Clear unlisted tokens in batches ───────────────────────────────────
    let cleared = 0
    for (let i = 0; i < unlistedIds.length; i += DB_BATCH) {
      const batch = unlistedIds.slice(i, i + DB_BATCH)
      const { error } = await supabase
        .from('all_checks')
        .update({ eth_price: null, is_listed: false })
        .in('token_id', batch)
        .eq('is_tokenstr', false)
      if (error) console.warn(`Clear error batch ${i}:`, error.message)
      else cleared += batch.length
    }

    // ── 6. Sync is_all_listed on all_permutations ─────────────────────────────
    const { error: syncErr } = await supabase.rpc('sync_all_listed_permutations')
    if (syncErr) console.warn('sync_all_listed_permutations error:', syncErr.message)
    else console.log('is_all_listed synced')

    await finishLog(supabase, logId, 'done', updated + cleared)
    return new Response(
      JSON.stringify({ ok: true, listed: updated, cleared, total: allMarketIds.length }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('sync-market-prices error:', err)
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
      if (offer.token.toLowerCase() !== CHECKS_CONTRACT) continue
      const tokenId  = Number(offer.identifierOrCriteria)
      const priceEth = Number(BigInt(listing.price.current.value)) / 1e18
      const existing = priceMap.get(tokenId)
      if (existing === undefined || priceEth < existing) priceMap.set(tokenId, priceEth)
    }

    cursor = json.next
    if (page % 10 === 0) console.log(`Page ${page}, ${priceMap.size} listings so far…`)
  } while (cursor)

  console.log(`Fetched ${page} pages — ${priceMap.size} listed tokens`)
  return priceMap
}

// ─── sync_log helpers ─────────────────────────────────────────────────────────

async function startLog(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'sync-market-prices', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

// Postgrest errors are plain objects, not Errors — String() would log "[object Object]"
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
