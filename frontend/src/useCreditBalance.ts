import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'

// Module-level shared cache + pub/sub, mirroring the pattern in siweConfig.ts
// (sessionListeners / subscribeToSiweSession / notifySiweSessionListeners).
// Without this, Navbar/SearchPage/PatternsBrowse each held their own
// independent balance state, so a charge made in one place never updated
// the Navbar's chip until an unrelated re-render happened to re-fetch it —
// letting the spec's "always visible before a charge can happen" balance
// go stale/too-high indefinitely.
const balanceCache = new Map<string, bigint>()
type BalanceListener = () => void
const balanceListeners = new Set<BalanceListener>()

function subscribeToBalance(listener: BalanceListener): () => void {
  balanceListeners.add(listener)
  return () => balanceListeners.delete(listener)
}

function notifyBalanceListeners(): void {
  for (const listener of balanceListeners) listener()
}

export function useCreditBalance(address: string | undefined) {
  const key = address?.toLowerCase()
  // Seed from the shared cache if another instance already fetched this
  // wallet's balance — avoids a redundant fetch on mount.
  const [balanceWei, setBalanceWei] = useState<bigint | null>(() => (key ? balanceCache.get(key) ?? null : null))
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (!supabase || !address) { setBalanceWei(null); return }
    const lower = address.toLowerCase()
    setLoading(true)
    supabase
      .rpc('get_wallet_balance', { p_wallet_address: lower })
      .then(({ data, error }) => {
        if (!error && data !== null) {
          const value = BigInt(data)
          balanceCache.set(lower, value)
          setBalanceWei(value)
          notifyBalanceListeners()
        }
        setLoading(false)
      })
  }, [address])

  useEffect(() => { refresh() }, [refresh])

  // Re-render (without re-fetching) whenever ANY useCreditBalance instance
  // refreshes — including one for the same wallet address fetched elsewhere.
  useEffect(() => {
    if (!key) return
    return subscribeToBalance(() => {
      const cached = balanceCache.get(key)
      if (cached !== undefined) setBalanceWei(cached)
    })
  }, [key])

  return { balanceWei, loading, refresh }
}
