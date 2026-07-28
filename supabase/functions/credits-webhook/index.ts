// supabase/functions/credits-webhook/index.ts
//
// Receives Alchemy "Address Activity" webhook payloads for the dedicated
// credits-receiving address. Any incoming ETH transfer is converted to a
// USD value via a live Chainlink ETH/USD price feed (read with a plain
// eth_call, same RPC pattern as tokenstr-webhook), matched against a known
// package amount ($10/$25/$50), and credited as that package's fixed
// credit count (10/25/50) via the atomic credit_wallet_from_transfer RPC.
// The oracle read happens once here, at deposit time — charge_credits
// never needs it.
//
// Deploy: supabase functions deploy credits-webhook
//
// Required secrets (set via: supabase secrets set KEY=value):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   CREDITS_WEBHOOK_SIGNING_KEY   (from Alchemy webhook settings)
//   CREDITS_RECEIVING_ADDRESS     (the wallet users send ETH to, lowercase)
//   ALCHEMY_API_KEY               (for the eth_call price-feed read)
//
// Alchemy setup: create an "Address Activity" webhook monitoring
//   CREDITS_RECEIVING_ADDRESS (mainnet or Sepolia), category "external",
//   pointed at <supabase-url>/functions/v1/credits-webhook — this function
//   picks the right price feed/RPC per network from the payload's own
//   event.network field, so the same deployment handles both.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Chainlink ETH/USD price feed proxy addresses (AggregatorV3Interface),
// confirmed against Chainlink's docs/Etherscan — verify again if Alchemy's
// network naming ever changes.
const MAINNET_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const SEPOLIA_ETH_USD_FEED = '0x694AA1769357215DE4FAC081bf1f309aDC325306'

// latestRoundData() selector — returns
// (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
// `answer` is USD price with 8 decimals.
const LATEST_ROUND_DATA_CALLDATA = '0xfeaf968c'
const PRICE_FEED_DECIMALS = 8n

// A package amount is matched within this tolerance to account for price
// drift between when a user was quoted an ETH amount (in FundingPrompt)
// and when their transaction actually confirms.
const PACKAGE_MATCH_TOLERANCE = 0.05 // 5%

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

  const alchemyKey = Deno.env.get('ALCHEMY_API_KEY')
  if (!alchemyKey) {
    console.error('ALCHEMY_API_KEY not set — rejecting request')
    return new Response('Alchemy API key not configured', { status: 500 })
  }

  const payload = JSON.parse(body) as AlchemyWebhookPayload

  // TEMPORARY debug logging while diagnosing why real Alchemy deliveries
  // aren't crediting — remove once the real payload shape is confirmed.
  await supabase.from('webhook_debug_log').insert({ payload })

  const isSepolia = (payload.event?.network ?? '').toUpperCase().includes('SEPOLIA')
  const rpcUrl = isSepolia
    ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`
    : `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
  const feedAddress = isSepolia ? SEPOLIA_ETH_USD_FEED : MAINNET_ETH_USD_FEED

  const { data: packages, error: packagesError } = await supabase
    .from('pricing_packages')
    .select('usd_amount, credits')
  if (packagesError || !packages) {
    console.error('Failed to load pricing_packages:', packagesError)
    return new Response('Failed to load pricing packages', { status: 500 })
  }

  const activities = payload.event?.activity ?? []
  let credited = 0
  let skipped = 0

  for (const activity of activities) {
    if (activity.category !== 'external') continue
    if (activity.toAddress?.toLowerCase() !== receivingAddress) continue

    const weiHex = activity.rawContract?.value
    if (!weiHex) continue
    const weiAmount = BigInt(weiHex)
    if (weiAmount <= 0n) continue

    if (!activity.hash) continue

    const ethUsdPrice = await fetchEthUsdPrice(rpcUrl, feedAddress)
    if (ethUsdPrice === null) {
      console.error(`Could not fetch ETH/USD price — skipping activity ${activity.hash}`)
      skipped++
      continue
    }

    const ethAmount = Number(weiAmount) / 1e18
    const usdValue = ethAmount * ethUsdPrice

    const matchedPackage = packages.find(
      p => Math.abs(usdValue - Number(p.usd_amount)) / Number(p.usd_amount) <= PACKAGE_MATCH_TOLERANCE
    )
    if (!matchedPackage) {
      console.warn(
        `Transfer ${activity.hash} (~$${usdValue.toFixed(2)} at $${ethUsdPrice.toFixed(2)}/ETH) ` +
        `doesn't match any known package (±${PACKAGE_MATCH_TOLERANCE * 100}%) — not crediting.`
      )
      skipped++
      continue
    }

    const fromAddress = activity.fromAddress.toLowerCase()
    const { error } = await supabase.rpc('credit_wallet_from_transfer', {
      p_wallet_address: fromAddress,
      p_credits: matchedPackage.credits,
      p_tx_hash: activity.hash,
    })
    if (error) {
      console.error(`credit_wallet_from_transfer failed for ${fromAddress}:`, error)
      continue
    }
    credited++
  }

  return new Response(JSON.stringify({ ok: true, credited, skipped }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

// ─── Chainlink ETH/USD price feed read ─────────────────────────────────────

async function fetchEthUsdPrice(rpcUrl: string, feedAddress: string): Promise<number | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: feedAddress, data: LATEST_ROUND_DATA_CALLDATA }, 'latest'],
      }),
    })
    const json = await res.json() as { result?: string; error?: unknown }
    if (json.error || !json.result) return null

    // latestRoundData() returns 5 ABI-encoded 32-byte words; `answer` (an
    // int256, always positive for a USD price) is the second word.
    const hex = json.result.slice(2)
    const answerHex = hex.slice(64, 128)
    const answer = BigInt('0x' + answerHex)
    return Number(answer) / Number(10n ** PRICE_FEED_DECIMALS)
  } catch (err) {
    console.error('fetchEthUsdPrice error:', err)
    return null
  }
}

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
  event?: { network?: string; activity?: AlchemyActivity[] }
}
interface AlchemyActivity {
  category: string
  fromAddress: string
  toAddress?: string
  hash: string
  rawContract?: { value?: string; decimals?: number }
}
