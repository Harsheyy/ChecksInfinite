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
 * Schedule: see supabase/migrations/025_cron_auth.sql (pg_cron via pg_net, hourly)
 * Manual:   POST /functions/v1/sync-tokenstr with header x-cron-secret: <CRON_SECRET>
 *
 * Required secrets (same as tokenstr-webhook, plus CRON_SECRET):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALCHEMY_API_KEY, CRON_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const TOKENSTR_WALLET = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'
const TOKEN_STRATEGY  = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'

const PRICE_BATCH     = 20   // parallel nftForSale calls per round (lower = fewer concurrent fetches)
const NEW_TOKEN_LIMIT = 5    // max new tokens to full-upsert per run (SVG fetch is expensive)

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

    // ── 2. DB state (tokenstr tokens only) ──────────────────────────────────
    const { data: dbRows, error: dbErr } = await supabase
      .from('all_checks')
      .select('token_id, eth_price')
      .eq('is_tokenstr', true)
    if (dbErr) throw dbErr

    const dbIds       = (dbRows ?? []).map((r: { token_id: number }) => r.token_id)
    const dbSet        = new Set(dbIds)
    const dbPriceById  = new Map((dbRows ?? []).map((r: { token_id: number; eth_price: number | null }) => [r.token_id, r.eth_price]))
    console.log(`DB: ${dbIds.length} tokens tracked`)

    // ── 3. Compute diffs ─────────────────────────────────────────────────────
    const toDelete  = dbIds.filter(id => !onChainSet.has(id))
    const toAdd     = onChainIds.filter(id => !dbSet.has(id))
    // TokenStrategy prices are set once and don't change after listing — a
    // sold token leaves the wallet entirely (caught by toDelete above), it
    // doesn't get relisted at a new price. So we only need nftForSale for
    // tokens that are still unpriced, instead of re-checking all 700+ every
    // hour — this is what was blowing through Alchemy's compute-unit budget.
    const toRefresh = onChainIds.filter(id => dbSet.has(id) && dbPriceById.get(id) == null)
    console.log(`Diff — delete: ${toDelete.length}, add: ${toAdd.length}, price-refresh: ${toRefresh.length}`)

    // ── 4. Remove tokens no longer in wallet ─────────────────────────────────
    for (const tokenId of toDelete) {
      console.log(`Deleting token ${tokenId} (no longer in wallet)`)
      // all_permutations has FK constraints on all_checks — clean up first
      await supabase.from('all_permutations').delete().or(
        `keeper_1_id.eq.${tokenId},burner_1_id.eq.${tokenId},keeper_2_id.eq.${tokenId},burner_2_id.eq.${tokenId}`
      )
      await supabase.from('permutations').delete().or(
        `keeper_1_id.eq.${tokenId},burner_1_id.eq.${tokenId},keeper_2_id.eq.${tokenId},burner_2_id.eq.${tokenId}`
      )
      await supabase.from('all_checks').delete().eq('token_id', tokenId)
    }

    // ── 5. Refresh eth_price for still-unpriced on-chain tokens ──────────────
    // Fetch prices in parallel batches, then write each batch in a single bulk
    // RPC call to avoid N separate PostgREST round-trips. A short pause
    // between batches keeps us under Alchemy's compute-unit-per-second budget
    // instead of firing every batch back-to-back and tripping 429s.
    let priceUpdates = 0
    let priceFailures = 0
    for (let i = 0; i < toRefresh.length; i += PRICE_BATCH) {
      if (i > 0) await sleep(250)

      const batch   = toRefresh.slice(i, i + PRICE_BATCH)
      const results = await Promise.all(batch.map(id => fetchEthPrice(id, rpcUrl)))

      // A failed fetch (rate-limited / network error, after retries) is NOT
      // the same as a confirmed "unlisted" — writing null here would wipe a
      // real listing from the DB just because Alchemy hiccupped. Skip those
      // tokens entirely and let the next hourly run retry them.
      const updates = batch
        .map((tokenId, j) => ({ tokenId, price: results[j] }))
        .filter(({ price }) => price !== 'failed')
        .map(({ tokenId, price }) => ({
          token_id:  tokenId,
          eth_price: price === 'unlisted' ? null : price,
          is_listed: price !== 'unlisted' && price !== null,
        }))

      priceFailures += results.filter(p => p === 'failed').length

      if (updates.length > 0) {
        const { error } = await supabase.rpc('bulk_update_check_prices', { p_updates: updates })
        if (error) console.warn(`Bulk price update error (batch ${i}):`, error.message)
      }

      priceUpdates += updates.filter(u => u.is_listed).length
    }
    console.log(`Updated ${priceUpdates} prices${priceFailures > 0 ? ` (${priceFailures} tokens skipped after failed eth_call)` : ''}`)

    // ── 6. Full upsert for new tokens (missed incoming transfers) ────────────
    const newToProcess = toAdd.slice(0, NEW_TOKEN_LIMIT)
    if (newToProcess.length > 0) {
      console.log(`Upserting ${newToProcess.length} new tokens (${toAdd.length - newToProcess.length} deferred to next run)`)
      await Promise.allSettled(
        newToProcess.map(id => refetchAndUpsert(id, alchemyKey, rpcUrl, supabase))
      )
    }

    const summary = {
      onChain:      onChainIds.length,
      deleted:      toDelete.length,
      added:        newToProcess.length,
      deferred:     toAdd.length - newToProcess.length,
      priceUpdates,
    }

    await finishLog(supabase, logId, 'done', onChainIds.length)

    // ── 7. Recalculate permutation costs (background, structural changes only) ─
    // Only needed when tokens are added or removed — price-only changes are
    // handled per-token by update_permutation_costs inside refetchAndUpsert.
    // Fire after the response so the HTTP caller never waits on this.
    if (toDelete.length > 0 || newToProcess.length > 0) {
      supabase.rpc('backfill_permutation_costs')
        .then(() => console.log('Permutation costs recalculated'))
        .catch(e => console.error('Backfill error:', e))
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Sync error:', err)
    await finishLog(supabase, logId, 'error', 0, errMsg(err))
    return new Response(JSON.stringify({ error: errMsg(err) }), {
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

  if (uriResult === 'failed' || uriResult === null || checkResult === 'failed' || checkResult === null || ownerResult === 'failed' || ownerResult === null) {
    console.warn(`Token ${tokenId}: one or more eth_calls failed/reverted — skipping`)
    return
  }

  const owner       = '0x' + ownerResult.slice(26)
  const isBurned    = owner.toLowerCase() === '0x0000000000000000000000000000000000000000'
  const svg         = decodeTokenURISVG(uriResult)
  const checkStruct = decodeGetCheck(checkResult)
  const attrs       = decodeTokenURIAttrs(uriResult)
  const priceValue  = typeof ethPrice === 'number' ? ethPrice : null

  await supabase.from('all_checks').upsert({
    token_id:       tokenId,
    owner,
    is_burned:      isBurned,
    is_tokenstr:    true,
    price_source:   priceValue !== null ? 'contract' : null,
    is_listed:      priceValue !== null,
    checks_count:   Number(attrs['Checks'] ?? 0),
    color_band:     attrs['Color Band'] ?? null,
    gradient:       attrs['Gradient']   ?? null,
    speed:          attrs['Speed']      ?? null,
    shift:          attrs['Shift']      ?? null,
    svg,
    check_struct:   checkStruct,
    eth_price:      priceValue,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'token_id' })

  await supabase.rpc('update_permutation_costs', { p_token_id: tokenId })
  console.log(`Upserted new token ${tokenId} (price: ${priceValue ?? 'unlisted'})`)
}

// ─── eth_call helpers ─────────────────────────────────────────────────────────

// 'failed'   — eth_call errored out (rate-limited / network) even after retries;
//              caller should leave the existing DB row alone.
// 'unlisted' — call succeeded and nftForSale returned 0 (confirmed not for sale).
// number     — call succeeded, this is the listed price in ETH.
async function fetchEthPrice(tokenId: number, rpcUrl: string): Promise<number | 'unlisted' | 'failed'> {
  const result = await ethCall(rpcUrl, TOKEN_STRATEGY, nftForSaleCalldata(tokenId))
  if (result === 'failed') return 'failed'
  if (result === null) return 'unlisted'
  const price = decodeUint256Wei(result)
  return price === 0 ? 'unlisted' : price
}

const ETH_CALL_RETRIES    = 4
const ETH_CALL_RETRY_BASE_MS = 400

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Returns the eth_call result, `null` for a confirmed revert/empty result
// (not retryable — the answer won't change), or 'failed' once retries on
// transient errors (429 / network) are exhausted.
async function ethCall(rpcUrl: string, to: string, data: string): Promise<string | null | 'failed'> {
  for (let attempt = 0; attempt <= ETH_CALL_RETRIES; attempt++) {
    let res: Response
    try {
      res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
      })
    } catch (e) {
      if (attempt === ETH_CALL_RETRIES) { console.warn(`eth_call network error (exhausted retries): ${e}`); return 'failed' }
      await sleep(ETH_CALL_RETRY_BASE_MS * 2 ** attempt)
      continue
    }

    if (res.status === 429 || res.status === 503) {
      if (attempt === ETH_CALL_RETRIES) { console.warn(`eth_call HTTP ${res.status} (exhausted retries)`); return 'failed' }
      await sleep(ETH_CALL_RETRY_BASE_MS * 2 ** attempt)
      continue
    }
    if (!res.ok) { console.warn(`eth_call HTTP ${res.status}`); return 'failed' }

    const text = await res.text()
    let json: { result?: string; error?: unknown }
    try { json = JSON.parse(text) } catch { console.warn(`eth_call bad JSON: ${text.slice(0, 200)}`); return 'failed' }
    if (json.error) return null // real contract-level revert — not transient, don't retry
    return json.result ?? null
  }
  return 'failed' // unreachable, satisfies TS
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
  return '0x90ba7a32' + tokenId.toString(16).padStart(64, '0')
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

// Postgrest errors are plain objects, not Errors — String() would log "[object Object]"
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

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
