/**
 * backfill-market-prices.ts
 *
 * Syncs ETH floor prices for all non-tokenstr Checks VV tokens via OpenSea's
 * seaport listings API. Paginates through all active listings for the collection,
 * picks the lowest ask per token, writes eth_price + is_listed=true, and
 * marks unlisted tokens is_listed=false / eth_price=null.
 *
 * Set OPENSEA_API_KEY in backend/.env before running.
 *
 * Usage:
 *   npm run backfill-market-prices
 */

import { createClient } from '@supabase/supabase-js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const OPENSEA_API_KEY      = process.env.OPENSEA_API_KEY!
const COLLECTION_SLUG      = 'vv-checks-originals'
const CHECKS_CONTRACT      = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const DB_BATCH             = 500

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENSEA_API_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENSEA_API_KEY in backend/.env')
  process.exit(1)
}

// ─── Client ───────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── OpenSea types ───────────────────────────────────────────────────────────

interface OSListing {
  price: {
    current: {
      currency: string
      decimals: number
      value:    string  // wei as string
    }
  }
  protocol_data: {
    parameters: {
      offer: {
        itemType:               number
        token:                  string
        identifierOrCriteria:   string  // token ID
      }[]
    }
  }
}

interface OSListingsResponse {
  listings: OSListing[]
  next?:    string
}

// ─── Fetch all active OpenSea listings for the collection ─────────────────────

async function fetchAllListings(): Promise<Map<number, number>> {
  // tokenId → lowest ETH price
  const priceMap = new Map<number, number>()
  const base = `https://api.opensea.io/api/v2/listings/collection/${COLLECTION_SLUG}/all`
  let cursor: string | undefined

  console.log('Fetching active OpenSea listings for checks-vv…')
  let page = 0

  do {
    const params = new URLSearchParams({ limit: '100', ...(cursor ? { next: cursor } : {}) })
    const url = `${base}?${params}`

    const res = await fetch(url, {
      headers: {
        'accept':       'application/json',
        'x-api-key':    OPENSEA_API_KEY,
      },
    })

    if (res.status === 429) {
      // rate-limited — back off and retry
      console.warn('  Rate limited by OpenSea, waiting 10s…')
      await new Promise(r => setTimeout(r, 10_000))
      continue
    }

    if (!res.ok) {
      throw new Error(`OpenSea error: ${res.status} ${await res.text()}`)
    }

    const json = await res.json() as OSListingsResponse
    page++

    for (const listing of json.listings) {
      const offer = listing.protocol_data?.parameters?.offer?.[0]
      if (!offer) continue
      if (offer.token.toLowerCase() !== CHECKS_CONTRACT) continue

      const tokenId = Number(offer.identifierOrCriteria)
      const priceWei = BigInt(listing.price.current.value)
      const priceEth = Number(priceWei) / 1e18

      // Keep the lowest ask per token
      const existing = priceMap.get(tokenId)
      if (existing === undefined || priceEth < existing) {
        priceMap.set(tokenId, priceEth)
      }
    }

    cursor = json.next
    if (page % 10 === 0) {
      process.stdout.write(`  Page ${page}, ${priceMap.size} unique listings so far…\r`)
    }
  } while (cursor)

  console.log(`\nFetched ${page} pages — ${priceMap.size} uniquely listed tokens.`)
  return priceMap
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const priceMap = await fetchAllListings()

    // 1. Load all non-tokenstr, non-burned token IDs from DB
    const { data: allRows, error } = await supabase
      .from('all_checks')
      .select('token_id')
      .eq('is_tokenstr', false)
      .eq('is_burned', false)

    if (error) throw error
    const allMarketIds = (allRows ?? []).map((r: { token_id: number }) => r.token_id)
    console.log(`${allMarketIds.length} non-tokenstr market tokens in DB.`)

    // 2. Build update batches: listed vs unlisted
    const listedUpdates:   { token_id: number; eth_price: number; is_listed: boolean; price_source: string }[] = []
    const unlistedUpdates: { token_id: number; eth_price: null;   is_listed: boolean }[] = []

    for (const tokenId of allMarketIds) {
      const price = priceMap.get(tokenId)
      if (price !== undefined) {
        listedUpdates.push({ token_id: tokenId, eth_price: price, is_listed: true, price_source: 'opensea' })
      } else {
        unlistedUpdates.push({ token_id: tokenId, eth_price: null, is_listed: false })
      }
    }

    console.log(`Listed: ${listedUpdates.length}  |  Unlisted: ${unlistedUpdates.length}`)

    // 3. Update listed tokens (rows already exist from backfill-market-checks)
    let updated = 0
    for (const row of listedUpdates) {
      const { error: e } = await supabase
        .from('all_checks')
        .update({ eth_price: row.eth_price, is_listed: row.is_listed, price_source: row.price_source })
        .eq('token_id', row.token_id)
        .eq('is_tokenstr', false)
      if (e) throw e
      updated++
      process.stdout.write(`  Listed update: ${updated}/${listedUpdates.length}\r`)
    }
    if (listedUpdates.length > 0) console.log()

    // 4. Update unlisted tokens (clear price)
    let cleared = 0
    for (let i = 0; i < unlistedUpdates.length; i += DB_BATCH) {
      const batch = unlistedUpdates.slice(i, i + DB_BATCH)
      const ids   = batch.map(r => r.token_id)
      const { error: e } = await supabase
        .from('all_checks')
        .update({ eth_price: null, is_listed: false })
        .in('token_id', ids)
        .eq('is_tokenstr', false)
      if (e) throw e
      cleared += batch.length
      process.stdout.write(`  Unlisted clear: ${cleared}/${unlistedUpdates.length}\r`)
    }
    if (unlistedUpdates.length > 0) console.log()

    console.log(`\nDone. ${listedUpdates.length} prices set, ${unlistedUpdates.length} cleared.`)
  } catch (err) {
    console.error('Price backfill failed:', err)
    process.exit(1)
  }
}

main()
