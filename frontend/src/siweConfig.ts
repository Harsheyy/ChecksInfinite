// frontend/src/siweConfig.ts
//
// @reown/appkit-siwe wiring. Nonce issuance and signature verification both
// happen server-side (siwe-nonce / siwe-verify edge functions) — this file
// only shuttles data between AppKit's SIWE flow and those functions. The
// resulting session token is what charge_credits later checks against
// wallet_sessions, so ownership is proven once here, not re-derived later.
import { createSIWEConfig, formatMessage } from '@reown/appkit-siwe'
import type { SIWECreateMessageArgs, SIWEVerifyMessageArgs } from '@reown/appkit-siwe'
import { mainnet } from '@reown/appkit/networks'
import { supabase } from './supabaseClient'

let currentSessionToken: string | null = null
let currentWalletAddress: string | null = null

export function getCurrentSession(): { sessionToken: string; walletAddress: string } | null {
  return currentSessionToken && currentWalletAddress
    ? { sessionToken: currentSessionToken, walletAddress: currentWalletAddress }
    : null
}

export const siweConfig = createSIWEConfig({
  getMessageParams: async () => ({
    domain: window.location.host,
    uri: window.location.origin,
    chains: [mainnet.id],
    statement: 'Sign in to Checks Infinite to fund and spend your search/recipe-view credit balance.',
  }),
  createMessage: ({ address, ...args }: SIWECreateMessageArgs) => formatMessage(args, address),
  getNonce: async () => {
    if (!supabase) throw new Error('Supabase not configured')
    const { data, error } = await supabase.functions.invoke<string>('siwe-nonce', { method: 'POST' })
    if (error || !data) throw new Error('Failed to fetch SIWE nonce')
    return data
  },
  verifyMessage: async ({ message, signature }: SIWEVerifyMessageArgs) => {
    if (!supabase) return false
    const { data, error } = await supabase.functions.invoke<
      { sessionToken: string; walletAddress: string } | { error: string }
    >('siwe-verify', { body: { message, signature } })
    if (error || !data || 'error' in data) return false
    currentSessionToken = data.sessionToken
    currentWalletAddress = data.walletAddress
    return true
  },
  getSession: async () => {
    if (!currentSessionToken || !currentWalletAddress) return null
    return { address: currentWalletAddress, chainId: mainnet.id }
  },
  signOut: async () => {
    currentSessionToken = null
    currentWalletAddress = null
    return true
  },
})
