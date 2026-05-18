/**
 * sync-tokenstr — Supabase Edge Function
 *
 * Hourly full reconciliation of all_checks against on-chain truth:
 *   1. Fetch all Checks currently owned by the TokenStrategy wallet (Alchemy NFT API)
 *   2. Delete DB rows for tokens no longer in the wallet (sold/transferred, webhook missed)
 *   3. Refresh eth_price for every on-chain token (nftForSale can change without Transfer events)
 *   4. Full upsert for tokens in wallet but missing from DB (webhook missed incoming transfer)
 *   5. Recalculate permutation total_cost for changed prices
 *
 * Deploy:   supabase functions deploy sync-tokenstr
 * Schedule: see supabase/migrations/014_sync_cron.sql (pg_cron via pg_net, hourly)
 * Manual:   POST /functions/v1/sync-tokenstr  (no auth required — read/write to your own DB only)
 *
 * Required secrets (same as tokenstr-webhook):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALCHEMY_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const TOKENSTR_WALLET = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'
const TOKEN_STRATEGY  = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'

const PRICE_BATCH     = 50   // parallel nftForSale calls per round
const NEW_TOKEN_LIMIT = 20   // max new tokens to full-upsert per run (SVG fetch is expensive)

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const alchemyKey = Deno.env.get('ALCHEMY_API_KEY')!
  const rpcUrl     = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`

  const logId = await startLog(supabase)

  try {
    // ── 1. On-chain truth ────────────────────────────────────────────────────
    const onChainIds  = await getNFTsForOwner(alchemyKey)
    const onChainSet  = new Set(onChainIds)
    console.log(`On-chain: ${onChainIds.length} tokens in TokenStrategy wallet`)

    // ── 2. DB state ──────────────────────────────────────────────────────────
    const { data: dbRows, error: dbErr } = await supabase
      .from('all_checks')
      .select('token_id')
    if (dbErr) throw dbErr

    const dbIds  = (dbRows ?? []).map((r: { token_id: number }) => r.token_id)
    const dbSet  = new Set(dbIds)
    console.log(`DB: ${dbIds.length} tokens tracked`)

    // ── 3. Compute diffs ─────────────────────────────────────────────────────
    const toDelete  = dbIds.filter(id => !onChainSet.has(id))
    const toAdd     = onChainIds.filter(id => !dbSet.has(id))
    const toRefresh = onChainIds  // refresh prices for ALL wallet tokens
    console.log(`Diff — delete: ${toDelete.length}, add: ${toAdd.length}, price-refresh: ${toRefresh.length}`)

    // ── 4. Remove tokens no longer in wallet ─────────────────────────────────
    for (const tokenId of toDelete) {
      console.log(`Deleting token ${tokenId} (no longer in wallet)`)
      await supabase.from('all_checks').delete().eq('token_id', tokenId)
      await supabase.from('permutations').delete().or(
        `keeper_1_id.eq.${tokenId},burner_1_id.eq.${tokenId},keeper_2_id.eq.${tokenId},burner_2_id.eq.${tokenId}`
      )
    }

    // ── 5. Refresh eth_price for all on-chain tokens ─────────────────────────
    let priceUpdates = 0
    for (let i = 0; i < toRefresh.length; i += PRICE_BATCH) {
      const batch   = toRefresh.slice(i, i + PRICE_BATCH)
      const prices  = await Promise.all(batch.map(id => fetchEthPrice(id, rpcUrl)))

      const updates = batch
        .map((tokenId, j) => ({ tokenId, ethPrice: prices[j] }))
        .filter(u => u.ethPrice !== null)

      await Promise.allSettled(
        updates.map(u =>
          supabase.from('all_checks')
            .update({ eth_price: u.ethPrice, last_synced_at: new Date().toISOString() })
            .eq('token_id', u.tokenId)
        )
      )
      priceUpdates += updates.length
    }
    console.log(`Updated ${priceUpdates} prices`)

    // ── 6. Full upsert for new tokens (missed incoming transfers) ────────────
    const newToProcess = toAdd.slice(0, NEW_TOKEN_LIMIT)
    if (newToProcess.length > 0) {
      console.log(`Upserting ${newToProcess.length} new tokens (${toAdd.length - newToProcess.length} deferred to next run)`)
      await Promise.allSettled(
        newToProcess.map(id => refetchAndUpsert(id, alchemyKey, rpcUrl, supabase))
      )
    }

    // ── 7. Recalculate permutation costs ─────────────────────────────────────
    if (priceUpdates > 0 || toDelete.length > 0 || newToProcess.length > 0) {
      await supabase.rpc('backfill_permutation_costs')
      console.log('Permutation costs recalculated')
    }

    const summary = {
      onChain:      onChainIds.length,
      deleted:      toDelete.length,
      added:        newToProcess.length,
      deferred:     toAdd.length - newToProcess.length,
      priceUpdates,
    }

    await finishLog(supabase, logId, 'done', onChainIds.length)
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Sync error:', err)
    await finishLog(supabase, logId, 'error', 0, String(err))
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ─── Alchemy NFT API ──────────────────────────────────────────────────────────

async function getNFTsForOwner(alchemyKey: string): Promise<number[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner`
  const ids: number[] = []
  let pageKey: string | undefined

  do {
    const params = new URLSearchParams({
      owner:                TOKENSTR_WALLET,
      'contractAddresses[]': CHECKS_CONTRACT,
      withMetadata:          'false',
      pageSize:              '100',
      ...(pageKey ? { pageKey } : {}),
    })
    const res  = await fetch(`${base}?${params}`)
    if (!res.ok) throw new Error(`Alchemy NFT API error: ${res.status} ${await res.text()}`)
    const text = await res.text()
    let json: { ownedNfts: { tokenId: string }[]; pageKey?: string }
    try { json = JSON.parse(text) } catch { throw new Error(`Alchemy NFT API bad JSON: ${text.slice(0, 200)}`) }
    for (const nft of json.ownedNfts) ids.push(Number(nft.tokenId))
    pageKey = json.pageKey
  } while (pageKey)

  return ids
}

// ─── Full token upsert (for tokens missed by the webhook) ────────────────────

async function refetchAndUpsert(
  tokenId: number,
  alchemyKey: string,
  rpcUrl: string,
  supabase: ReturnType<typeof createClient>
) {
  const [uriResult, checkResult, ownerResult, ethPrice] = await Promise.all([
    ethCall(rpcUrl, CHECKS_CONTRACT, tokenURICalldata(tokenId)),
    ethCall(rpcUrl, CHECKS_CONTRACT, getCheckCalldata(tokenId)),
    ethCall(rpcUrl, CHECKS_CONTRACT, ownerOfCalldata(tokenId)),
    fetchEthPrice(tokenId, rpcUrl),
  ])

  if (!uriResult || !checkResult || !ownerResult) {
    console.warn(`Token ${tokenId}: one or more eth_calls returned null — skipping`)
    return
  }

  const owner       = '0x' + ownerResult.slice(26)
  const isBurned    = owner.toLowerCase() === '0x0000000000000000000000000000000000000000'
  const svg         = decodeTokenURISVG(uriResult)
  const checkStruct = decodeGetCheck(checkResult)
  const attrs       = decodeTokenURIAttrs(uriResult)

  await supabase.from('all_checks').upsert({
    token_id:       tokenId,
    owner,
    is_burned:      isBurned,
    checks_count:   Number(attrs['Checks'] ?? 0),
    color_band:     attrs['Color Band'] ?? null,
    gradient:       attrs['Gradient']   ?? null,
    speed:          attrs['Speed']      ?? null,
    shift:          attrs['Shift']      ?? null,
    svg,
    check_struct:   checkStruct,
    eth_price:      ethPrice,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'token_id' })

  await supabase.rpc('update_permutation_costs', { p_token_id: tokenId })
  console.log(`Upserted new token ${tokenId} (price: ${ethPrice ?? 'unlisted'})`)
}

// ─── eth_call helpers ─────────────────────────────────────────────────────────

async function fetchEthPrice(tokenId: number, rpcUrl: string): Promise<number | null> {
  const result = await ethCall(rpcUrl, TOKEN_STRATEGY, nftForSaleCalldata(tokenId))
  if (!result) return null
  return decodeUint256Wei(result)
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string | null> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  })
  if (!res.ok) { console.warn(`eth_call HTTP ${res.status}`); return null }
  const text = await res.text()
  let json: { result?: string; error?: unknown }
  try { json = JSON.parse(text) } catch { console.warn(`eth_call bad JSON: ${text.slice(0, 200)}`); return null }
  if (json.error) return null
  return json.result ?? null
}

function tokenURICalldata(tokenId: number): string {
  return '0xc87b56dd' + tokenId.toString(16).padStart(64, '0')
}
function getCheckCalldata(tokenId: number): string {
  return '0x755edd17' + tokenId.toString(16).padStart(64, '0')
}
function ownerOfCalldata(tokenId: number): string {
  return '0x6352211e' + tokenId.toString(16).padStart(64, '0')
}
function nftForSaleCalldata(tokenId: number): string {
  return '0xf8a2810f' + tokenId.toString(16).padStart(64, '0')
}

function decodeUint256Wei(hexResult: string): number {
  const wei = BigInt(hexResult.slice(0, 66))
  return Number(wei) / 1e18
}

function decodeTokenURISVG(abiEncodedString: string): string {
  const hex    = abiEncodedString.slice(2)
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const len    = parseInt(hex.slice(offset, offset + 64), 16)
  const strHex = hex.slice(offset + 64, offset + 64 + len * 2)
  const dataUri = hexToUtf8(strHex)
  const base64  = dataUri.replace(/^data:application\/json;base64,/, '')
  const json    = JSON.parse(atob(base64)) as { image: string }
  const svgB64  = json.image.replace(/^data:image\/svg\+xml;base64,/, '')
  return atob(svgB64)
}

function decodeTokenURIAttrs(abiEncodedString: string): Record<string, string> {
  const hex    = abiEncodedString.slice(2)
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const len    = parseInt(hex.slice(offset, offset + 64), 16)
  const strHex = hex.slice(offset + 64, offset + 64 + len * 2)
  const dataUri = hexToUtf8(strHex)
  const base64  = dataUri.replace(/^data:application\/json;base64,/, '')
  const json    = JSON.parse(atob(base64)) as { attributes: { trait_type: string; value: string }[] }
  const result: Record<string, string> = {}
  for (const attr of json.attributes ?? []) result[attr.trait_type] = String(attr.value)
  return result
}

function decodeGetCheck(hex: string): Record<string, unknown> {
  return { _raw: hex }
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return new TextDecoder().decode(bytes)
}

// ─── sync_log helpers ─────────────────────────────────────────────────────────

async function startLog(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'sync-tokenstr', status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 0
}

async function finishLog(
  supabase: ReturnType<typeof createClient>,
  id: number,
  status: 'done' | 'error',
  tokensProcessed: number,
  errorMessage?: string
) {
  await supabase
    .from('sync_log')
    .update({
      status,
      tokens_processed: tokensProcessed,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
}
