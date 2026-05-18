/**
 * backfill-market-checks.ts
 *
 * Syncs ALL Checks VV tokens (not just TokenWorks wallet) into all_checks.
 * Uses Alchemy getNFTsForContract to enumerate token IDs, then viem multicall
 * to batch getCheck() + ownerOf() for all tokens in one RPC round-trip per batch.
 *
 * Derives attributes directly from check_struct — no tokenURI calls needed.
 * Sets is_tokenstr = false for all rows (existing tokenstr rows keep is_tokenstr = true).
 * Skips token IDs already marked is_tokenstr = true (managed by the tokenstr pipeline).
 *
 * Usage:
 *   npm run backfill-market
 *   npm run backfill-market -- --incremental   (skip tokens synced <24h ago)
 */

import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { createClient } from '@supabase/supabase-js'
import {
  mapCheckAttributes,
  checkStructToJSON,
  colorBandName,
  gradientName,
  type CheckStruct,
} from '../lib/engine.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const ALCHEMY_KEY          = process.env.ALCHEMY_API_KEY!
const CHECKS_CONTRACT      = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1' as const
const TOKENSTR_WALLET      = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'
const BATCH                = 500
const INCREMENTAL          = process.argv.includes('--incremental')

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ALCHEMY_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, ALCHEMY_API_KEY in backend/.env')
  process.exit(1)
}

// ─── Clients ─────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const viemClient = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  batch: { multicall: true },
})

// ─── ABI ─────────────────────────────────────────────────────────────────────

const ABI = [
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
              { name: 'composites',    type: 'uint16[6]' },
              { name: 'colorBands',    type: 'uint8[5]' },
              { name: 'gradients',     type: 'uint8[5]' },
              { name: 'divisorIndex',  type: 'uint8' },
              { name: 'epoch',         type: 'uint32' },
              { name: 'seed',          type: 'uint16' },
              { name: 'day',           type: 'uint24' },
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
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// ─── Alchemy: enumerate all token IDs for the contract ───────────────────────

async function fetchAllContractTokenIds(): Promise<number[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForContract`
  const ids: number[] = []
  let pageKey: string | undefined

  do {
    const params = new URLSearchParams({
      contractAddress: CHECKS_CONTRACT,
      withMetadata:    'false',
      limit:           '100',
      ...(pageKey ? { pageKey } : {}),
    })
    const res = await fetch(`${base}?${params}`)
    if (!res.ok) throw new Error(`Alchemy error: ${res.status} ${await res.text()}`)
    const json = await res.json() as { nfts: { tokenId: string }[]; pageKey?: string }
    for (const nft of json.nfts) ids.push(Number(nft.tokenId))
    pageKey = json.pageKey
  } while (pageKey)

  return ids
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const logId = await startLog()
  let tokensProcessed = 0

  try {
    console.log('Fetching all Checks VV token IDs from Alchemy...')
    let allIds = await fetchAllContractTokenIds()
    console.log(`Found ${allIds.length} tokens on-chain.`)

    // Skip tokens already managed by the tokenstr pipeline
    const { data: tokenstrRows } = await supabase
      .from('all_checks')
      .select('token_id')
      .eq('is_tokenstr', true)
    const tokenstrIds = new Set((tokenstrRows ?? []).map((r: { token_id: number }) => r.token_id))
    allIds = allIds.filter(id => !tokenstrIds.has(id))
    console.log(`Excluding ${tokenstrIds.size} tokenstr-managed tokens. Processing ${allIds.length} market tokens.`)

    if (INCREMENTAL) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: synced } = await supabase
        .from('all_checks')
        .select('token_id')
        .eq('is_tokenstr', false)
        .gt('last_synced_at', cutoff)
      const syncedSet = new Set((synced ?? []).map((r: { token_id: number }) => r.token_id))
      const before = allIds.length
      allIds = allIds.filter(id => !syncedSet.has(id))
      console.log(`Incremental: skipping ${before - allIds.length} recently synced, processing ${allIds.length}.`)
    }

    for (let start = 0; start < allIds.length; start += BATCH) {
      const ids    = allIds.slice(start, start + BATCH)
      const bigIds = ids.map(id => BigInt(id))
      const batchNum = Math.floor(start / BATCH) + 1
      const totalBatches = Math.ceil(allIds.length / BATCH)
      console.log(`Batch ${batchNum}/${totalBatches}: tokens ${ids[0]}…${ids[ids.length - 1]}`)

      const [checkResults, ownerResults] = await Promise.all([
        Promise.allSettled(
          bigIds.map(id =>
            viemClient.readContract({ address: CHECKS_CONTRACT, abi: ABI, functionName: 'getCheck', args: [id] })
          )
        ),
        Promise.allSettled(
          bigIds.map(id =>
            viemClient.readContract({ address: CHECKS_CONTRACT, abi: ABI, functionName: 'ownerOf', args: [id] })
          )
        ),
      ])

      const rows: object[] = []

      for (let i = 0; i < ids.length; i++) {
        if (checkResults[i].status === 'rejected' || ownerResults[i].status === 'rejected') continue

        const checkStruct = (checkResults[i] as PromiseFulfilledResult<unknown>).value as CheckStruct
        const owner       = ((ownerResults[i] as PromiseFulfilledResult<unknown>).value as string).toLowerCase()
        const isBurned    = owner === '0x0000000000000000000000000000000000000000'
        const isTokenstr  = owner === TOKENSTR_WALLET

        const attrs   = mapCheckAttributes(checkStruct)
        const getAttr = (name: string) => attrs.find(a => a.trait_type === name)?.value ?? null

        rows.push({
          token_id:       ids[i],
          owner,
          is_burned:      isBurned,
          is_tokenstr:    isTokenstr,
          checks_count:   checkStruct.checksCount,
          color_band:     checkStruct.hasManyChecks ? colorBandName(checkStruct.colorBand) : null,
          gradient:       checkStruct.hasManyChecks ? gradientName(checkStruct.gradient)   : null,
          speed:          getAttr('Speed'),
          shift:          getAttr('Shift'),
          svg:            null,
          check_struct:   checkStructToJSON(checkStruct),
          last_synced_at: new Date().toISOString(),
        })
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from('all_checks')
          .upsert(rows, { onConflict: 'token_id', ignoreDuplicates: false })
        if (error) throw error
        tokensProcessed += rows.length
        console.log(`  Upserted ${rows.length} (${tokensProcessed} total)`)
      }
    }

    await finishLog(logId, 'done', tokensProcessed)
    console.log(`\nDone. ${tokensProcessed} market tokens synced.`)
  } catch (err) {
    await finishLog(logId, 'error', tokensProcessed, String(err))
    console.error('Backfill failed:', err)
    process.exit(1)
  }
}

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'backfill-market-checks', status: 'running' })
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
