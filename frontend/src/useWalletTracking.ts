// frontend/src/useWalletTracking.ts
import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

export function useWalletTracking(address: string | undefined, isConnected: boolean) {
  const logged = useRef<string | null>(null)

  useEffect(() => {
    console.log('[analytics] useWalletTracking effect', { supabase: !!supabase, isConnected, address })
    if (!supabase || !isConnected || !address) return
    const normalized = address.toLowerCase()
    if (logged.current === normalized) return  // already logged this address in this session
    logged.current = normalized
    console.log('[analytics] calling log_wallet_connect for', normalized)
    supabase.rpc('log_wallet_connect', { p_address: normalized }).then(
      (res) => console.log('[analytics] log_wallet_connect success', res),
      err => console.warn('[analytics] log_wallet_connect failed:', err)
    )
  }, [address, isConnected])
}
