// apps/works/src/useSiweSession.ts
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { getCurrentSession, siweConfig, subscribeToSiweSession } from './siweConfig'

export function useSiweSession() {
  const { isConnected, address } = useAccount()
  const [, forceRerender] = useState(0)
  const refresh = useCallback(() => forceRerender(n => n + 1), [])

  // Re-render whenever siweConfig's verifyMessage/signOut mutate the
  // module-level session state (e.g. AppKit's automatic on-connect SIWE
  // flow completing in the background), so sessionToken/walletAddress below
  // don't go stale until some unrelated re-render happens to occur.
  useEffect(() => subscribeToSiweSession(refresh), [refresh])

  // ensureSignedIn returns the current valid session token if one exists
  // FOR THE CURRENTLY CONNECTED WALLET; otherwise it actively triggers
  // AppKit's SIWE signature prompt via siweConfig.signIn()
  // (AppKitSIWEClient.signIn -> SIWXUtil.requestSignMessage, which opens
  // the wallet-signature modal, requests the signature, and — on success —
  // runs our verifyMessage above, populating the module session state) and
  // returns the resulting token, or null if the user rejects or the flow
  // fails.
  //
  // The address check matters because the session can now survive a page
  // refresh (persisted to localStorage in siweConfig.ts) — without it, a
  // session signed by a previously-connected wallet could be handed back
  // as if it belonged to a DIFFERENT wallet connected later in the same
  // browser. charge_credits would still reject that combination server-side
  // (the session's recorded wallet_address wouldn't match), but the user
  // would just see a confusing failure instead of a fresh sign-in prompt.
  const ensureSignedIn = useCallback(async (): Promise<string | null> => {
    if (!isConnected || !address) return null
    const existing = getCurrentSession()
    if (existing && existing.walletAddress.toLowerCase() === address.toLowerCase()) {
      return existing.sessionToken
    }

    try {
      await siweConfig.signIn()
    } catch {
      return null
    }
    const fresh = getCurrentSession()
    return fresh && fresh.walletAddress.toLowerCase() === address.toLowerCase() ? fresh.sessionToken : null
  }, [isConnected, address])

  const session = getCurrentSession()
  return {
    sessionToken: session?.sessionToken ?? null,
    walletAddress: session?.walletAddress ?? null,
    ensureSignedIn,
    refresh,
  }
}
