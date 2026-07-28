// frontend/src/useSiweSession.ts
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { getCurrentSession, siweConfig, subscribeToSiweSession } from './siweConfig'

export function useSiweSession() {
  const { isConnected } = useAccount()
  const [, forceRerender] = useState(0)
  const refresh = useCallback(() => forceRerender(n => n + 1), [])

  // Re-render whenever siweConfig's verifyMessage/signOut mutate the
  // module-level session state (e.g. AppKit's automatic on-connect SIWE
  // flow completing in the background), so sessionToken/walletAddress below
  // don't go stale until some unrelated re-render happens to occur.
  useEffect(() => subscribeToSiweSession(refresh), [refresh])

  // ensureSignedIn returns the current valid session token if one exists;
  // otherwise it actively triggers AppKit's SIWE signature prompt via
  // siweConfig.signIn() (AppKitSIWEClient.signIn -> SIWXUtil.requestSignMessage,
  // which opens the wallet-signature modal, requests the signature, and — on
  // success — runs our verifyMessage above, populating the module session
  // state) and returns the resulting token, or null if the user rejects or
  // the flow fails.
  const ensureSignedIn = useCallback(async (): Promise<string | null> => {
    if (!isConnected) return null
    const existing = getCurrentSession()
    if (existing) return existing.sessionToken

    try {
      await siweConfig.signIn()
    } catch {
      return null
    }
    return getCurrentSession()?.sessionToken ?? null
  }, [isConnected])

  const session = getCurrentSession()
  return {
    sessionToken: session?.sessionToken ?? null,
    walletAddress: session?.walletAddress ?? null,
    ensureSignedIn,
    refresh,
  }
}
