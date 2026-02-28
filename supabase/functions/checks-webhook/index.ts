/**
 * checks-webhook — Supabase Edge Function
 *
 * Receives Alchemy "Address Activity" webhook payloads for the Checks contract.
 * Parses Transfer events, updates the `checks` table, and logs to `sync_log`.
 *
 * Deploy: supabase functions deploy checks-webhook
 *
 * Required secrets (set via: supabase secrets set KEY=value):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ALCHEMY_API_KEY
 *   WEBHOOK_SIGNING_KEY  (from Alchemy webhook settings — used to verify payloads)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const ZERO_ADDRESS    = '0x0000000000000000000000000000000000000000'

// ERC-721 Transfer topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

Deno.serve(async (req: Request) => {
  // ── Verify Alchemy signature ──────────────────────────────────────────────
  const signingKey = Deno.env.get('WEBHOOK_SIGNING_KEY')
  if (signingKey) {
    const signature = req.headers.get('x-alchemy-signature')
    const body      = await req.text()
    const valid     = await verifyAlchemySignature(body, signature ?? '', signingKey)
    if (!valid) {
      return new Response('Unauthorized', { status: 401 })
    }
    // Re-parse since we consumed the body
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
  const affectedTokenIds = new Set<number>()

  try {
    // Collect Transfer events from all activities
    const activities: AlchemyActivity[] = payload.event?.activity ?? []

    for (const activity of activities) {
      if (!activity.log) continue
      const log = activity.log

      // Filter: must be from our contract and be a Transfer event
      if (log.address.toLowerCase() !== CHECKS_CONTRACT) continue
      if (!log.topics[0] || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue

      const from    = '0x' + log.topics[1].slice(26)
      const to      = '0x' + log.topics[2].slice(26)
      const tokenId = Number(BigInt(log.topics[3]))

      if (to.toLowerCase() === ZERO_ADDRESS) {
        // Burn: mark token as burned
        await supabase
          .from('checks')
          .update({ is_burned: true, owner: ZERO_ADDRESS, last_synced_at: new Date().toISOString() })
          .eq('token_id', tokenId)

        // Clean up permutations where this token was a burner (now invalid)
        await supabase
          .from('permutations')
          .delete()
          .or(`burner_1_id.eq.${tokenId},burner_2_id.eq.${tokenId}`)

        console.log(`Token ${tokenId} burned — marked and permutations cleaned.`)
      } else {
        // Transfer: update owner and re-fetch from chain
        affectedTokenIds.add(tokenId)

        // If this was a keeper in a composite, the keeper's check_struct changed — re-fetch it too
        if (from.toLowerCase() !== ZERO_ADDRESS) {
          affectedTokenIds.add(tokenId)
        }
      }
    }

    // Re-fetch all affected tokens from chain
    if (affectedTokenIds.size > 0) {
      console.log(`Re-fetching ${affectedTokenIds.size} affected tokens...`)
      await refetchTokens([...affectedTokenIds], alchemyKey, supabase)
    }

    await finishLog(supabase, logId, 'done', affectedTokenIds.size)
    return new Response(JSON.stringify({ ok: true, processed: affectedTokenIds.size }), {
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

// ─── Chain fetch ─────────────────────────────────────────────────────────────

async function refetchTokens(
  tokenIds: number[],
  alchemyKey: string,
  supabase: ReturnType<typeof createClient>
) {
  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`

  for (const tokenId of tokenIds) {
    try {
      // Batch tokenURI + getCheck + ownerOf in one eth_call multicall
      const [uriResult, checkResult, ownerResult] = await Promise.all([
        ethCall(rpcUrl, CHECKS_CONTRACT, tokenURICalldata(tokenId)),
        ethCall(rpcUrl, CHECKS_CONTRACT, getCheckCalldata(tokenId)),
        ethCall(rpcUrl, CHECKS_CONTRACT, ownerOfCalldata(tokenId)),
      ])

      if (!uriResult || !checkResult || !ownerResult) continue

      const owner = '0x' + ownerResult.slice(26)
      const isBurned = owner.toLowerCase() === ZERO_ADDRESS

      const svg = decodeTokenURISVG(uriResult)
      const checkStruct = decodeGetCheck(checkResult)

      const attrs = decodeTokenURIAttrs(uriResult)

      await supabase.from('checks').upsert({
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
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'token_id' })
    } catch (err) {
      console.error(`Failed to refetch token ${tokenId}:`, err)
    }
  }
}

// ─── Raw eth_call helpers ─────────────────────────────────────────────────────
// The edge function doesn't bundle viem, so we use raw JSON-RPC.

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

function decodeTokenURISVG(abiEncodedString: string): string {
  // ABI-encoded string: offset (32 bytes) + length (32 bytes) + data
  const hex = abiEncodedString.slice(2)
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
  const hex = abiEncodedString.slice(2)
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
  // Return the raw hex for storage — the permutation script will decode it
  // using viem on the backend. The edge function just needs to store what it gets.
  // For now store a minimal shape with the raw result so the backfill script
  // can re-parse it properly on the next run.
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
    .insert({ job: 'webhook', status: 'running' })
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
