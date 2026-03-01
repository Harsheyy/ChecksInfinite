/**
 * backfill-prices.ts — fetches nftForSale() prices from the TokenStrategy contract
 * for all checks in tokenstr_checks and populates eth_price.
 * Then calls backfill_permutation_costs() to fill total_cost in permutations.
 *
 * Usage:
 *   npx tsx scripts/backfill-prices.ts
 *
 * Required env vars (same .env as backfill.ts):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY
 */

import { createPublicClient, http, formatEther } from 'viem'
import { mainnet } from 'viem/chains'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const ALCHEMY_KEY          = process.env.ALCHEMY_API_KEY!
const TOKEN_STRATEGY       = '0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc' as const
const BATCH                = 500

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ALCHEMY_KEY) {
  console.error('Missing env vars.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const viemClient = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  batch: { multicall: true },
})

const NFT_FOR_SALE_ABI = [{
  name: 'nftForSale',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

async function main() {
  // 1. Fetch all token IDs from tokenstr_checks
  const { data: rows, error } = await supabase
    .from('tokenstr_checks')
    .select('token_id')
  if (error) throw error

  const tokenIds = (rows ?? []).map((r: { token_id: number }) => r.token_id)
  console.log(`Found ${tokenIds.length} checks. Fetching prices...`)

  let updated = 0

  // 2. Batch-call nftForSale() for all token IDs
  for (let start = 0; start < tokenIds.length; start += BATCH) {
    const batch = tokenIds.slice(start, start + BATCH)
    console.log(`Batch ${Math.floor(start / BATCH) + 1}/${Math.ceil(tokenIds.length / BATCH)}: tokens ${batch[0]}…${batch[batch.length - 1]}`)

    const results = await Promise.allSettled(
      batch.map(id =>
        viemClient.readContract({
          address: TOKEN_STRATEGY,
          abi: NFT_FOR_SALE_ABI,
          functionName: 'nftForSale',
          args: [BigInt(id)],
        })
      )
    )

    const upsertRows = batch
      .map((tokenId, i) => {
        const result = results[i]
        if (result.status !== 'fulfilled') return null
        const weiPrice = result.value as bigint
        const ethPrice = parseFloat(formatEther(weiPrice))
        return { token_id: tokenId, eth_price: ethPrice }
      })
      .filter(Boolean)

    if (upsertRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('tokenstr_checks')
        .upsert(upsertRows, { onConflict: 'token_id' })
      if (upsertErr) throw upsertErr
      updated += upsertRows.length
      console.log(`  Updated ${upsertRows.length} prices (${updated} total)`)
    }
  }

  // 3. Backfill total_cost in permutations
  console.log('\nBackfilling permutation total_cost...')
  const { data: count, error: rpcErr } = await supabase.rpc('backfill_permutation_costs')
  if (rpcErr) throw rpcErr
  console.log(`Done. ${count} permutations have a total_cost.`)
}

main().catch(err => { console.error(err); process.exit(1) })
