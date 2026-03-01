// frontend/src/useWalletTracking.ts
import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

export function useWalletTracking(address: string | undefined, isConnected: boolean) {
  const logged = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase || !isConnected || !address) return
    const normalized = address.toLowerCase()
    if (logged.current === normalized) return  // already logged this address in this session
    logged.current = normalized
    supabase.rpc('log_wallet_connect', { p_address: normalized }).then(() => {}).catch(err => console.warn('[analytics] log_wallet_connect failed:', err))
  }, [address, isConnected])
}
