// frontend/src/useWalletTracking.ts
import { useEffect, useRef } from 'react'
import { useEnsName } from 'wagmi'
import { supabase } from './supabaseClient'

export function useWalletTracking(address: string | undefined, isConnected: boolean) {
  const logged = useRef<string | null>(null)

  const { data: ensName, isLoading: ensLoading } = useEnsName({
    address: (isConnected && address) ? address as `0x${string}` : undefined,
  })

  useEffect(() => {
    if (!supabase || !isConnected || !address || ensLoading) return
    const normalized = address.toLowerCase()
    if (logged.current === normalized) return  // already logged this address in this session
    logged.current = normalized
    supabase.rpc('log_wallet_connect', {
      p_address: normalized,
      p_ens_name: ensName ?? null,
    }).then(() => {}, err => console.warn('[analytics] log_wallet_connect failed:', err))
  }, [address, isConnected, ensName, ensLoading])
}
