import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'

export function useCreditBalance(address: string | undefined) {
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (!supabase || !address) { setBalanceWei(null); return }
    setLoading(true)
    supabase
      .rpc('get_wallet_balance', { p_wallet_address: address.toLowerCase() })
      .then(({ data, error }) => {
        if (!error && data !== null) setBalanceWei(BigInt(data))
        setLoading(false)
      })
  }, [address])

  useEffect(() => { refresh() }, [refresh])

  return { balanceWei, loading, refresh }
}
