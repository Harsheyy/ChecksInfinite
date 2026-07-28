// frontend/src/useSiweSession.ts
import { useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import { getCurrentSession } from './siweConfig'

export function useSiweSession() {
  const { isConnected } = useAccount()
  const [, forceRerender] = useState(0)

  // ensureSignedIn opens AppKit's SIWE prompt (via its own modal flow,
  // triggered automatically by AppKit once siweConfig is wired in and a
  // wallet connects) if no session exists yet, and returns the resulting
  // token. AppKit handles the actual signature UI; this just surfaces the
  // outcome to callers like chargeCredits.
  const ensureSignedIn = useCallback(async (): Promise<string | null> => {
    if (!isConnected) return null
    const existing = getCurrentSession()
    if (existing) return existing.sessionToken
    // AppKit prompts for signature automatically on connect when siweConfig
    // is present; if we get here with no session, the user hasn't completed
    // it yet (declined, or connect flow still in progress) — reflect that.
    return null
  }, [isConnected])

  const session = getCurrentSession()
  return {
    sessionToken: session?.sessionToken ?? null,
    walletAddress: session?.walletAddress ?? null,
    ensureSignedIn,
    refresh: () => forceRerender(n => n + 1),
  }
}
