// apps/works/src/siweConfig.ts
//
// @reown/appkit-siwe wiring. Nonce issuance and signature verification both
// happen server-side (siwe-nonce / siwe-verify edge functions) — this file
// only shuttles data between AppKit's SIWE flow and those functions. The
// resulting session token is what charge_credits later checks against
// wallet_sessions, so ownership is proven once here, not re-derived later.
import { createSIWEConfig, formatMessage } from '@reown/appkit-siwe'
import type { SIWECreateMessageArgs, SIWEVerifyMessageArgs } from '@reown/appkit-siwe'
import { mainnet } from '@reown/appkit/networks'
import { networks } from './wagmiConfig'
import { supabase } from '@checks-wiki/shared'

// Persisted to localStorage (not just kept in memory) so a page refresh or
// tab reopen doesn't force a fresh signature — the session is still only
// ever trusted until its server-recorded expiry (24h, see siwe-verify),
// checked below before rehydrating.
const STORAGE_KEY = 'checks-wiki-siwe-session'

interface StoredSession {
  sessionToken: string
  walletAddress: string
  expiresAt: string
}

function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveStoredSession(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — session still
    // works for this page load via the in-memory copy, just won't survive
    // a refresh. Not worth surfacing to the user.
  }
}

function clearStoredSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // No-op — see saveStoredSession.
  }
}

const initial = loadStoredSession()
let currentSessionToken: string | null = initial?.sessionToken ?? null
let currentWalletAddress: string | null = initial?.walletAddress ?? null

export function getCurrentSession(): { sessionToken: string; walletAddress: string } | null {
  return currentSessionToken && currentWalletAddress
    ? { sessionToken: currentSessionToken, walletAddress: currentWalletAddress }
    : null
}

// Minimal pub/sub so React consumers (useSiweSession) can re-render when the
// module-level session state changes — e.g. after AppKit's automatic
// on-connect SIWE flow completes verifyMessage, or after signOut clears it.
// Deliberately not a state-management library: just enough to avoid stale
// "signed in" UI until an unrelated re-render happens to occur.
type SessionListener = () => void
const sessionListeners = new Set<SessionListener>()

export function subscribeToSiweSession(listener: SessionListener): () => void {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

function notifySiweSessionListeners(): void {
  for (const listener of sessionListeners) listener()
}

export const siweConfig = createSIWEConfig({
  // Not required: wagmi's default reconnectOnMount silently reconnects a
  // previously-authorized wallet on every page load, and `required: true`
  // (the appkit-siwe default) would force the sign-message prompt right
  // then — before the user ever clicks Connect Wallet. With this false,
  // a silent reconnect stays silent; the sign prompt only appears as part
  // of the explicit connect flow triggered from the nav/search buttons.
  required: false,
  getMessageParams: async () => ({
    domain: window.location.host,
    uri: window.location.origin,
    chains: networks.map(n => n.id) as number[],
    statement: 'Verify wallet ownership to use your Checks Wiki credits.',
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
      { sessionToken: string; walletAddress: string; expiresAt: string } | { error: string }
    >('siwe-verify', { body: { message, signature } })
    if (error || !data || 'error' in data) return false
    currentSessionToken = data.sessionToken
    currentWalletAddress = data.walletAddress
    saveStoredSession(data)
    notifySiweSessionListeners()
    return true
  },
  getSession: async () => {
    if (!currentSessionToken || !currentWalletAddress) return null
    return { address: currentWalletAddress, chainId: mainnet.id }
  },
  signOut: async () => {
    currentSessionToken = null
    currentWalletAddress = null
    clearStoredSession()
    notifySiweSessionListeners()
    return true
  },
})
