// supabase/functions/siwe-verify/index.ts
//
// Verifies a signed SIWE (EIP-4361) message and, on success, issues a
// session token recorded in wallet_sessions. This is the only place a
// wallet's ownership is actually proven — charge_credits later trusts
// session_token → wallet_address exactly as recorded here.
//
// Deploy: supabase functions deploy siwe-verify

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SiweMessage } from 'https://esm.sh/siwe@2'

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const NONCE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Domains this server accepts SIWE sign-ins for. The signed message's
// `domain` field must match one of these — otherwise a message signed for
// some other site (phishing, a different deploy, etc.) could be replayed
// here even though the signature itself is cryptographically valid.
const ALLOWED_DOMAINS = new Set([
  'checks.wiki',
  'www.checks.wiki',
  'explore.checks.wiki',
  'localhost:5173',
  'localhost:3000',
  '127.0.0.1:5173',
])

// This function is called directly from the browser via
// supabase.functions.invoke(), which sends Authorization/Content-Type
// headers and therefore triggers a CORS preflight OPTIONS request. Without
// these headers on every response (including errors), the browser blocks
// the whole SIWE flow before our own error handling ever runs.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { message, signature } = await req.json() as { message: string; signature: string }
    const siweMessage = new SiweMessage(message)

    if (!ALLOWED_DOMAINS.has(siweMessage.domain)) {
      return new Response(JSON.stringify({ error: 'invalid_domain' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: nonceRow } = await supabase
      .from('siwe_nonces')
      .select('nonce, created_at')
      .eq('nonce', siweMessage.nonce)
      .maybeSingle()

    if (!nonceRow) {
      return new Response(JSON.stringify({ error: 'unknown_nonce' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (Date.now() - new Date(nonceRow.created_at).getTime() > NONCE_TTL_MS) {
      return new Response(JSON.stringify({ error: 'expired_nonce' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await siweMessage.verify({
      signature,
      nonce: siweMessage.nonce,
      domain: siweMessage.domain,
    })
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'invalid_signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // One-time use: remove the nonce so it can't be replayed
    await supabase.from('siwe_nonces').delete().eq('nonce', siweMessage.nonce)

    const sessionToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    const walletAddress = siweMessage.address.toLowerCase()

    const { error: insertError } = await supabase.from('wallet_sessions').insert({
      session_token: sessionToken,
      wallet_address: walletAddress,
      expires_at: expiresAt,
    })

    if (insertError) {
      console.error('siwe-verify session insert error:', insertError)
      return new Response(JSON.stringify({ error: 'session_creation_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ sessionToken, walletAddress, expiresAt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('siwe-verify error:', err)
    return new Response(JSON.stringify({ error: 'verification_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
