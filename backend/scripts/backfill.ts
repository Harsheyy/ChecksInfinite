/**
 * backfill.ts — fetches all Checks held by the TokenStrategy wallet from
 * the Alchemy NFT API and upserts them into the `tokenstr_checks` Supabase table.
 *
 * Usage:
 *   npx tsx scripts/backfill.ts              # full run
 *   npx tsx scripts/backfill.ts --incremental  # skip already-synced tokens
 */

import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { createClient } from '@supabase/supabase-js'
import { parseTokenURI, mapCheckAttributes, checkStructToJSON, type CheckStruct } from '../lib/engine.js'

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const ALCHEMY_KEY       = process.env.ALCHEMY_API_KEY!
const CHECKS_CONTRACT   = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1' as const
const TOKENSTR_WALLET   = '0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc'
const BATCH             = 500   // for cheap calls (ownerOf, getCheck) via multicall
const URI_CONCURRENCY   = 20    // tokenURI: parallel individual eth_calls (no multicall)
const INCREMENTAL       = process.argv.includes('--incremental')

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ALCHEMY_KEY) {
  console.error('Missing env vars. Copy .env.example to .env and fill in values.')
  process.exit(1)
}

// ─── Clients ─────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Multicall client — for cheap calls (ownerOf, getCheck) that aggregate well
const viemClient = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  batch: { multicall: true },
})

// No-multicall client — for tokenURI which generates SVG on-chain (~2M gas each).
const viemClientDirect = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
})

// ─── ABI fragments ───────────────────────────────────────────────────────────

const ABI = [
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
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
          { name: 'isRevealed',   type: 'bool' },
          { name: 'seed',         type: 'uint256' },
          { name: 'checksCount',  type: 'uint8' },
          { name: 'hasManyChecks',type: 'bool' },
          { name: 'composite',    type: 'uint16' },
          { name: 'isRoot',       type: 'bool' },
          { name: 'colorBand',    type: 'uint8' },
          { name: 'gradient',     type: 'uint8' },
          { name: 'direction',    type: 'uint8' },
          { name: 'speed',        type: 'uint8' },
        ],
      },
    ],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAttr(attributes: { trait_type: string; value: string }[], name: string): string | null {
  return attributes.find(a => a.trait_type === name)?.value ?? null
}

// Fetch all Checks token IDs held by the TokenStrategy wallet via Alchemy NFT API
async function fetchWalletTokenIds(): Promise<number[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner`
  const ids: number[] = []
  let pageKey: string | undefined

  do {
    const params = new URLSearchParams({
      owner: TOKENSTR_WALLET,
      'contractAddresses[]': CHECKS_CONTRACT,
      withMetadata: 'false',
      pageSize: '100',
      ...(pageKey ? { pageKey } : {}),
    })

    const res  = await fetch(`${base}?${params}`)
    if (!res.ok) throw new Error(`Alchemy NFT API error: ${res.status} ${await res.text()}`)
    const json = await res.json() as { ownedNfts: { tokenId: string }[]; pageKey?: string }

    for (const nft of json.ownedNfts) {
      ids.push(Number(nft.tokenId))
    }
    pageKey = json.pageKey
  } while (pageKey)

  return ids
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const logId = await startLog()
  let tokensProcessed = 0

  try {
    // 1. Fetch token IDs from the TokenStrategy wallet
    console.log(`Fetching Checks held by TokenStrategy wallet (${TOKENSTR_WALLET})...`)
    let allIds = await fetchWalletTokenIds()
    console.log(`Found ${allIds.length} tokens.`)

    if (allIds.length === 0) {
      console.log('No tokens found in wallet.')
      await finishLog(logId, 'done', 0)
      return
    }

    // 2. In incremental mode, skip tokens synced in the last 24h
    if (INCREMENTAL) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: synced } = await supabase
        .from('tokenstr_checks')
        .select('token_id')
        .gt('last_synced_at', cutoff)

      const syncedSet = new Set((synced ?? []).map((r: { token_id: number }) => r.token_id))
      const before = allIds.length
      allIds = allIds.filter(id => !syncedSet.has(id))
      console.log(`Incremental: skipping ${before - allIds.length} recently synced, processing ${allIds.length}.`)
    }

    // 3. Process in batches
    for (let start = 0; start < allIds.length; start += BATCH) {
      const ids = allIds.slice(start, start + BATCH)
      const bigIds = ids.map(id => BigInt(id))

      console.log(`Batch ${Math.floor(start / BATCH) + 1}/${Math.ceil(allIds.length / BATCH)}: tokens ${ids[0]}…${ids[ids.length - 1]}`)

      // Phase A: ownerOf + getCheck — cheap, batch all at once
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

      const validIndices = ids
        .map((_, i) => i)
        .filter(i => ownerResults[i].status === 'fulfilled' && checkResults[i].status === 'fulfilled')

      console.log(`  ${validIndices.length}/${ids.length} tokens exist on-chain`)

      // Phase B: tokenURI — direct eth_calls, URI_CONCURRENCY at a time
      const uriResults: PromiseSettledResult<string>[] = new Array(ids.length).fill({ status: 'rejected', reason: 'skipped' })
      for (let s = 0; s < validIndices.length; s += URI_CONCURRENCY) {
        const subIndices = validIndices.slice(s, s + URI_CONCURRENCY)
        const subResults = await Promise.allSettled(
          subIndices.map(i =>
            viemClientDirect.readContract({ address: CHECKS_CONTRACT, abi: ABI, functionName: 'tokenURI', args: [bigIds[i]] })
          )
        )
        subIndices.forEach((origIdx, j) => {
          uriResults[origIdx] = subResults[j] as PromiseSettledResult<string>
        })
      }

      const rows: object[] = []
      for (const i of validIndices) {
        const ownerResult = ownerResults[i] as PromiseFulfilledResult<unknown>
        const checkResult = checkResults[i] as PromiseFulfilledResult<unknown>
        const uriResult   = uriResults[i]
        if (uriResult.status === 'rejected') continue

        const owner    = ownerResult.value as string
        const isBurned = owner === '0x0000000000000000000000000000000000000000'

        let parsed: ReturnType<typeof parseTokenURI>
        try {
          parsed = parseTokenURI(uriResult.value)
        } catch {
          console.warn(`  Token ${ids[i]}: failed to parse tokenURI`)
          continue
        }

        const checkStruct = checkResult.value as CheckStruct

        rows.push({
          token_id:     ids[i],
          owner,
          is_burned:    isBurned,
          checks_count: Number(getAttr(parsed.attributes, 'Checks') ?? 0),
          color_band:   getAttr(parsed.attributes, 'Color Band'),
          gradient:     getAttr(parsed.attributes, 'Gradient'),
          speed:        getAttr(parsed.attributes, 'Speed'),
          shift:        getAttr(parsed.attributes, 'Shift'),
          svg:          parsed.svg,
          check_struct: checkStructToJSON(checkStruct),
          last_synced_at: new Date().toISOString(),
        })
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from('tokenstr_checks')
          .upsert(rows, { onConflict: 'token_id' })
        if (error) throw error
        tokensProcessed += rows.length
        console.log(`  Upserted ${rows.length} tokens (${tokensProcessed} total)`)
      }
    }

    await finishLog(logId, 'done', tokensProcessed)
    console.log(`\nDone. ${tokensProcessed} tokens synced.`)
  } catch (err) {
    await finishLog(logId, 'error', tokensProcessed, String(err))
    console.error('Backfill failed:', err)
    process.exit(1)
  }
}

// ─── sync_log helpers ─────────────────────────────────────────────────────────

async function startLog(): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'backfill', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

async function finishLog(
  id: number,
  status: 'done' | 'error',
  tokensProcessed: number,
  error_message?: string
) {
  await supabase
    .from('sync_log')
    .update({ status, tokens_processed: tokensProcessed, error_message: error_message ?? null, finished_at: new Date().toISOString() })
    .eq('id', id)
}

main()
