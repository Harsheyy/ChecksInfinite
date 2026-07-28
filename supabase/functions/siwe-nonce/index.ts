// supabase/functions/siwe-nonce/index.ts
//
// Issues a one-time nonce for SIWE sign-in. The nonce is recorded so
// siwe-verify can confirm it was actually issued by us (not fabricated by
// a client) and enforce it's used within 5 minutes and only once.
//
// Deploy: supabase functions deploy siwe-nonce

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const nonce = randomNonce()
  const { error } = await supabase.from('siwe_nonces').insert({ nonce })
  if (error) {
    console.error('siwe-nonce insert error:', error)
    return new Response('Failed to generate nonce', { status: 500, headers: corsHeaders })
  }

  return new Response(nonce, { headers: { ...corsHeaders, 'Content-Type': 'text/plain' } })
})
