/**
 * backfill-editions.ts
 *
 * One-time: fetch all Checks Editions token IDs + images from Alchemy and
 * insert them into editions_checks with eth_price/is_listed unset. Prices
 * are filled in afterward by the sync-editions-prices edge function.
 *
 * Usage: npm run backfill-editions
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const ALCHEMY_KEY          = process.env.ALCHEMY_API_KEY!
const EDITIONS_CONTRACT    = '0x34eebee6942d8def3c125458d1a86e0a897fd6f9'
const BATCH                = 500

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ALCHEMY_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY in backend/.env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface EditionToken {
  tokenId: number
  imageUrl: string
}

async function fetchAllEditions(): Promise<EditionToken[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForContract`
  const tokens: EditionToken[] = []
  let pageKey: string | undefined

  do {
    const params = new URLSearchParams({
      contractAddress: EDITIONS_CONTRACT,
      withMetadata:    'true',
      limit:            '100',
      ...(pageKey ? { pageKey } : {}),
    })
    const res = await fetch(`${base}?${params}`)
    if (!res.ok) throw new Error(`Alchemy error: ${res.status} ${await res.text()}`)
    const json = await res.json() as {
      nfts: { tokenId: string; image?: { originalUrl?: string }; raw?: { metadata?: { image?: string } } }[]
      pageKey?: string
    }
    for (const nft of json.nfts) {
      tokens.push({
        tokenId:  Number(nft.tokenId),
        imageUrl: nft.image?.originalUrl ?? nft.raw?.metadata?.image ?? '',
      })
    }
    pageKey = json.pageKey
  } while (pageKey)

  return tokens
}

async function main() {
  const logId = await startLog()
  let tokensProcessed = 0

  try {
    console.log('Fetching all Checks Editions token IDs from Alchemy...')
    const tokens = await fetchAllEditions()
    console.log(`Found ${tokens.length} Editions tokens.`)

    for (let start = 0; start < tokens.length; start += BATCH) {
      const batch = tokens.slice(start, start + BATCH)
      const rows = batch.map(t => ({
        token_id:       t.tokenId,
        image_url:      t.imageUrl,
        is_listed:      false,
        last_synced_at: new Date().toISOString(),
      }))
      const { error } = await supabase
        .from('editions_checks')
        .upsert(rows, { onConflict: 'token_id', ignoreDuplicates: false })
      if (error) throw error
      tokensProcessed += rows.length
      console.log(`  Upserted ${rows.length} (${tokensProcessed} total)`)
    }

    await finishLog(logId, 'done', tokensProcessed)
    console.log(`\nDone. ${tokensProcessed} Editions tokens synced.`)
  } catch (err) {
    await finishLog(logId, 'error', tokensProcessed, String(err))
    console.error('Backfill failed:', err)
    process.exit(1)
  }
}

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'backfill-editions', status: 'running' })
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
