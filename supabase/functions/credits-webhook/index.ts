// supabase/functions/credits-webhook/index.ts
//
// Receives Alchemy "Address Activity" webhook payloads for the dedicated
// credits-receiving address. Any incoming ETH transfer credits the
// sender's wallet_credits balance via the atomic credit_wallet RPC.
//
// Deploy: supabase functions deploy credits-webhook
//
// Required secrets (set via: supabase secrets set KEY=value):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   CREDITS_WEBHOOK_SIGNING_KEY   (from Alchemy webhook settings)
//   CREDITS_RECEIVING_ADDRESS     (the wallet users send ETH to, lowercase)
//
// Alchemy setup: create an "Address Activity" webhook monitoring
//   CREDITS_RECEIVING_ADDRESS on Ethereum Mainnet, category "external",
//   pointed at <supabase-url>/functions/v1/credits-webhook

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  const signingKey = Deno.env.get('CREDITS_WEBHOOK_SIGNING_KEY')
  if (!signingKey) {
    console.error('CREDITS_WEBHOOK_SIGNING_KEY not set — rejecting request')
    return new Response('Webhook signing key not configured', { status: 500 })
  }

  const receivingAddress = Deno.env.get('CREDITS_RECEIVING_ADDRESS')?.toLowerCase()
  if (!receivingAddress) {
    console.error('CREDITS_RECEIVING_ADDRESS not set — rejecting request')
    return new Response('Receiving address not configured', { status: 500 })
  }

  const signature = req.headers.get('x-alchemy-signature')
  const body = await req.text()
  const valid = await verifyAlchemySignature(body, signature ?? '', signingKey)
  if (!valid) return new Response('Unauthorized', { status: 401 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const payload = JSON.parse(body) as AlchemyWebhookPayload
  const activities = payload.event?.activity ?? []
  let credited = 0

  for (const activity of activities) {
    if (activity.category !== 'external') continue
    if (activity.toAddress?.toLowerCase() !== receivingAddress) continue

    const weiHex = activity.rawContract?.value
    if (!weiHex) continue
    const weiAmount = BigInt(weiHex)
    if (weiAmount <= 0n) continue

    if (!activity.hash) continue

    const fromAddress = activity.fromAddress.toLowerCase()
    const { error } = await supabase.rpc('credit_wallet_from_transfer', {
      p_wallet_address: fromAddress,
      p_amount_wei: weiAmount.toString(),
      p_tx_hash: activity.hash,
    })
    if (error) {
      console.error(`credit_wallet failed for ${fromAddress}:`, error)
      continue
    }
    credited++
  }

  return new Response(JSON.stringify({ ok: true, credited }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

// ─── Alchemy signature verification (same as tokenstr-webhook) ─────────────

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
    return timingSafeEqual(computed, signature)
  } catch {
    return false
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

// ─── Types ───────────────────────────────────────────────────────────────

interface AlchemyWebhookPayload {
  event?: { activity?: AlchemyActivity[] }
}
interface AlchemyActivity {
  category: string
  fromAddress: string
  toAddress?: string
  hash: string
  rawContract?: { value?: string; decimals?: number }
}
