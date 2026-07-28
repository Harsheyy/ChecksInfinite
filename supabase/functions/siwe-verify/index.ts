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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { message, signature } = await req.json() as { message: string; signature: string }
    const siweMessage = new SiweMessage(message)

    const { data: nonceRow } = await supabase
      .from('siwe_nonces')
      .select('nonce, created_at')
      .eq('nonce', siweMessage.nonce)
      .maybeSingle()

    if (!nonceRow) {
      return new Response(JSON.stringify({ error: 'unknown_nonce' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (Date.now() - new Date(nonceRow.created_at).getTime() > NONCE_TTL_MS) {
      return new Response(JSON.stringify({ error: 'expired_nonce' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await siweMessage.verify({ signature, nonce: siweMessage.nonce })
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'invalid_signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // One-time use: remove the nonce so it can't be replayed
    await supabase.from('siwe_nonces').delete().eq('nonce', siweMessage.nonce)

    const sessionToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    const walletAddress = siweMessage.address.toLowerCase()

    await supabase.from('wallet_sessions').insert({
      session_token: sessionToken,
      wallet_address: walletAddress,
      expires_at: expiresAt,
    })

    return new Response(JSON.stringify({ sessionToken, walletAddress, expiresAt }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('siwe-verify error:', err)
    return new Response(JSON.stringify({ error: 'verification_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
