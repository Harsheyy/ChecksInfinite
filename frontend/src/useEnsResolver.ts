// frontend/src/useEnsResolver.ts
import { useState, useCallback } from 'react'
import { createPublicClient, http, normalize } from 'viem'
import { mainnet } from 'viem/chains'
import { isValidAddress } from './utils'

const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined),
})

// 5-entry LRU keyed by lowercased input
const _cache = new Map<string, string>()
function lruGet(key: string): string | undefined {
  const v = _cache.get(key)
  if (v === undefined) return undefined
  _cache.delete(key)
  _cache.set(key, v) // re-insert as most recent
  return v
}
function lruSet(key: string, value: string): void {
  if (_cache.has(key)) _cache.delete(key)
  _cache.set(key, value)
  if (_cache.size > 5) {
    const oldest = _cache.keys().next().value
    if (oldest !== undefined) _cache.delete(oldest)
  }
}

export interface EnsResolveResult {
  address: string
  source: 'address' | 'ens' | 'cache'
}

export function isEnsName(input: string): boolean {
  return /\.eth$/i.test(input.trim())
}

/** Resolves ENS name or returns the input if already an address. Throws on failure. */
export async function resolveAddressOrEns(input: string): Promise<EnsResolveResult> {
  const trimmed = input.trim()
  if (isValidAddress(trimmed)) {
    return { address: trimmed.toLowerCase(), source: 'address' }
  }
  if (!isEnsName(trimmed)) {
    throw new Error(`Not a valid address or ENS name: ${trimmed}`)
  }
  const key = trimmed.toLowerCase()
  const cached = lruGet(key)
  if (cached) return { address: cached, source: 'cache' }

  const resolved = await ensClient.getEnsAddress({ name: normalize(trimmed) })
  if (!resolved) throw new Error(`Couldn't resolve '${trimmed}'.`)
  lruSet(key, resolved.toLowerCase())
  return { address: resolved.toLowerCase(), source: 'ens' }
}

export interface EnsResolverState {
  loading: boolean
  error: string
}

export function useEnsResolver() {
  const [state, setState] = useState<EnsResolverState>({ loading: false, error: '' })

  const resolve = useCallback(async (input: string): Promise<string | null> => {
    setState({ loading: true, error: '' })
    try {
      const r = await resolveAddressOrEns(input)
      setState({ loading: false, error: '' })
      return r.address
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setState({ loading: false, error: msg })
      return null
    }
  }, [])

  return { resolve, ...state }
}
