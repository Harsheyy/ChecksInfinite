/**
 * tokenstr-webhook — Supabase Edge Function
 *
 * Receives Alchemy "Address Activity" webhook payloads for the TokenStrategy wallet.
 * Tracks ERC-721 Checks tokens entering or leaving the wallet:
 *   - Token received → fetch from chain and upsert into tokenstr_checks
 *   - Token sent     → delete from tokenstr_checks and clean up permutations
 *
 * Deploy: supabase functions deploy tokenstr-webhook
 *
 * Required secrets (set via: supabase secrets set KEY=value):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ALCHEMY_API_KEY
 *   TOKENSTR_WEBHOOK_SIGNING_KEY  (from Alchemy webhook settings)
 *
 * Alchemy setup: create an "Address Activity" webhook monitoring
 *   0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc on Ethereum Mainnet,
 *   pointed at <supabase-url>/functions/v1/tokenstr-webhook
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHECKS_CONTRACT        = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const TOKENSTR_WALLET        = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'
const TOKEN_STRATEGY_ADDRESS = '0x2090dc81f42f6ddd8deace0d3c3339017417b0dc'

// ERC-721 Transfer topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

Deno.serve(async (req: Request) => {
  const signingKey = Deno.env.get('TOKENSTR_WEBHOOK_SIGNING_KEY')
  if (signingKey) {
    const signature = req.headers.get('x-alchemy-signature')
    const body      = await req.text()
    const valid     = await verifyAlchemySignature(body, signature ?? '', signingKey)
    if (!valid) {
      return new Response('Unauthorized', { status: 401 })
    }
    return handlePayload(JSON.parse(body))
  }

  const payload = await req.json()
  return handlePayload(payload)
})

async function handlePayload(payload: AlchemyWebhookPayload): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const alchemyKey = Deno.env.get('ALCHEMY_API_KEY')!

  const logId = await startLog(supabase)
  let processed = 0

  try {
    const activities: AlchemyActivity[] = payload.event?.activity ?? []

    for (const activity of activities) {
      if (!activity.log) continue
      const log = activity.log

      // Only care about the Checks VV contract
      if (log.address.toLowerCase() !== CHECKS_CONTRACT) continue
      if (!log.topics[0] || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue

      const from    = '0x' + log.topics[1].slice(26).toLowerCase()
      const to      = '0x' + log.topics[2].slice(26).toLowerCase()
      const tokenId = Number(BigInt(log.topics[3]))

      if (to === TOKENSTR_WALLET) {
        // Token arrived in our wallet — fetch from chain and upsert
        console.log(`Token ${tokenId} received by TokenStrategy wallet — upserting.`)
        await refetchAndUpsert(tokenId, alchemyKey, supabase)
        processed++
      } else if (from === TOKENSTR_WALLET) {
        // Token left our wallet — delete and clean up permutations
        console.log(`Token ${tokenId} left TokenStrategy wallet — deleting.`)
        await supabase
          .from('tokenstr_checks')
          .delete()
          .eq('token_id', tokenId)

        await supabase
          .from('permutations')
          .delete()
          .or(`keeper_1_id.eq.${tokenId},burner_1_id.eq.${tokenId},keeper_2_id.eq.${tokenId},burner_2_id.eq.${tokenId}`)

        processed++
      }
      // Transfers not involving our wallet are ignored
    }

    await finishLog(supabase, logId, 'done', processed)
    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Webhook error:', err)
    await finishLog(supabase, logId, 'error', 0, String(err))
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ─── Chain fetch ──────────────────────────────────────────────────────────────

async function fetchEthPrice(tokenId: number, alchemyKey: string): Promise<number | null> {
  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
  const result = await ethCall(rpcUrl, TOKEN_STRATEGY_ADDRESS, nftForSaleCalldata(tokenId))
  if (!result) return null
  return decodeUint256Wei(result)
}

async function refetchAndUpsert(
  tokenId: number,
  alchemyKey: string,
  supabase: ReturnType<typeof createClient>
) {
  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`

  const [uriResult, checkResult, ownerResult, ethPrice] = await Promise.all([
    ethCall(rpcUrl, CHECKS_CONTRACT, tokenURICalldata(tokenId)),
    ethCall(rpcUrl, CHECKS_CONTRACT, getCheckCalldata(tokenId)),
    ethCall(rpcUrl, CHECKS_CONTRACT, ownerOfCalldata(tokenId)),
    fetchEthPrice(tokenId, alchemyKey),
  ])

  if (!uriResult || !checkResult || !ownerResult) {
    console.warn(`Token ${tokenId}: one or more eth_calls returned null — skipping.`)
    return
  }

  const owner      = '0x' + ownerResult.slice(26)
  const isBurned   = owner.toLowerCase() === '0x0000000000000000000000000000000000000000'
  const svg        = decodeTokenURISVG(uriResult)
  const checkStruct = decodeGetCheck(checkResult)
  const attrs      = decodeTokenURIAttrs(uriResult)

  await supabase.from('tokenstr_checks').upsert({
    token_id:      tokenId,
    owner,
    is_burned:     isBurned,
    checks_count:  Number(attrs['Checks'] ?? 0),
    color_band:    attrs['Color Band'] ?? null,
    gradient:      attrs['Gradient'] ?? null,
    speed:         attrs['Speed'] ?? null,
    shift:         attrs['Shift'] ?? null,
    svg,
    check_struct:  checkStruct,
    eth_price:     ethPrice,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'token_id' })

  // Re-sync total_cost for all permutations involving this check
  await supabase.rpc('update_permutation_costs', { p_token_id: tokenId })
}

// ─── Raw eth_call helpers ─────────────────────────────────────────────────────

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string | null> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  })
  const json = await res.json() as { result?: string; error?: unknown }
  if (json.error) return null
  return json.result ?? null
}

// tokenURI(uint256) = 0xc87b56dd
function tokenURICalldata(tokenId: number): string {
  return '0xc87b56dd' + tokenId.toString(16).padStart(64, '0')
}

// getCheck(uint256) = 0x755edd17
function getCheckCalldata(tokenId: number): string {
  return '0x755edd17' + tokenId.toString(16).padStart(64, '0')
}

// ownerOf(uint256) = 0x6352211e
function ownerOfCalldata(tokenId: number): string {
  return '0x6352211e' + tokenId.toString(16).padStart(64, '0')
}

// nftForSale(uint256) selector = keccak256("nftForSale(uint256)")[0..4]
// Computed: 0xf8a2810f
function nftForSaleCalldata(tokenId: number): string {
  return '0xf8a2810f' + tokenId.toString(16).padStart(64, '0')
}

function decodeUint256Wei(hexResult: string): number {
  // hexResult is "0x" + 64 hex chars (32 bytes)
  const wei = BigInt(hexResult.slice(0, 66))
  // Convert wei to ETH float
  return Number(wei) / 1e18
}

function decodeTokenURISVG(abiEncodedString: string): string {
  const hex    = abiEncodedString.slice(2)
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const len    = parseInt(hex.slice(offset, offset + 64), 16)
  const strHex = hex.slice(offset + 64, offset + 64 + len * 2)
  const dataUri = hexToUtf8(strHex)

  const base64 = dataUri.replace(/^data:application\/json;base64,/, '')
  const json   = JSON.parse(atob(base64)) as { image: string }
  const svgB64 = json.image.replace(/^data:image\/svg\+xml;base64,/, '')
  return atob(svgB64)
}

function decodeTokenURIAttrs(abiEncodedString: string): Record<string, string> {
  const hex    = abiEncodedString.slice(2)
  const offset = parseInt(hex.slice(0, 64), 16) * 2
  const len    = parseInt(hex.slice(offset, offset + 64), 16)
  const strHex = hex.slice(offset + 64, offset + 64 + len * 2)
  const dataUri = hexToUtf8(strHex)

  const base64 = dataUri.replace(/^data:application\/json;base64,/, '')
  const json   = JSON.parse(atob(base64)) as { attributes: { trait_type: string; value: string }[] }
  const result: Record<string, string> = {}
  for (const attr of json.attributes ?? []) {
    result[attr.trait_type] = String(attr.value)
  }
  return result
}

function decodeGetCheck(hex: string): Record<string, unknown> {
  return { _raw: hex }
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return new TextDecoder().decode(bytes)
}

// ─── Alchemy signature verification ──────────────────────────────────────────

async function verifyAlchemySignature(
  body: string,
  signature: string,
  signingKey: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const computed = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    return computed === signature
  } catch {
    return false
  }
}

// ─── sync_log helpers ─────────────────────────────────────────────────────────

async function startLog(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data } = await supabase
    .from('sync_log')
    .insert({ job: 'tokenstr-webhook', status: 'running' })
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
    .update({ status, tokens_processed: tokensProcessed, error_message: errorMessage ?? null, finished_at: new Date().toISOString() })
    .eq('id', id)
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlchemyWebhookPayload {
  event?: {
    activity?: AlchemyActivity[]
  }
}

interface AlchemyActivity {
  log?: {
    address: string
    topics: string[]
    data: string
    transactionHash: string
    blockNumber: string
  }
}
