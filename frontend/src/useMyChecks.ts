// frontend/src/useMyChecks.ts
import { useState, useEffect } from 'react'
import { checksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import type { CheckStruct } from './utils'

export const CACHE_TTL = 48 * 60 * 60 * 1000  // 48 hours in ms

export interface SerializedCheckStruct {
  stored: {
    composites: number[]
    colorBands: number[]
    gradients: number[]
    divisorIndex: number
    epoch: number
    seed: number
    day: number
  }
  isRevealed: boolean
  seed: string          // bigint serialized as decimal string
  checksCount: number
  hasManyChecks: boolean
  composite: number
  isRoot: boolean
  colorBand: number
  gradient: number
  direction: number
  speed: number
}

interface CacheEntry {
  tokenIds: string[]
  checks: Record<string, SerializedCheckStruct>
  cachedAt: number
}

function cacheKey(address: string): string {
  return `ci:myChecks:${address.toLowerCase()}`
}

export function readMyChecksCache(address: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(address))
    if (!raw) return null
    const data = JSON.parse(raw) as CacheEntry
    if (Date.now() - data.cachedAt > CACHE_TTL) return null
    return data
  } catch {
    return null
  }
}

export function writeMyChecksCache(address: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(cacheKey(address), JSON.stringify(entry))
  } catch {
    // localStorage full or unavailable — continue without caching
  }
}

function deserialize(s: SerializedCheckStruct): CheckStruct {
  return {
    ...s,
    seed: BigInt(s.seed),
    stored: {
      ...s.stored,
      composites: s.stored.composites as readonly number[],
      colorBands: s.stored.colorBands as readonly number[],
      gradients: s.stored.gradients as readonly number[],
    },
  }
}

async function fetchOwnedTokenIds(address: string, alchemyKey: string): Promise<string[]> {
  const base = `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner`
  const params = `owner=${address}&contractAddresses[]=${CHECKS_CONTRACT}&withMetadata=false&pageSize=100`
  const ids: string[] = []
  let pageKey: string | undefined

  do {
    const url = pageKey ? `${base}?${params}&pageKey=${pageKey}` : `${base}?${params}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`)
    const data = await res.json() as { ownedNfts: { tokenId: string }[]; pageKey?: string }
    for (const nft of data.ownedNfts) {
      ids.push(nft.tokenId)   // v3 returns decimal string directly
    }
    pageKey = data.pageKey
  } while (pageKey)

  return ids
}

export interface MyChecksState {
  tokenIds: string[]
  checks: Record<string, CheckStruct>
  loading: boolean
  error: string
}

export function useMyChecks(address: string | undefined, enabled: boolean): MyChecksState {
  const [state, setState] = useState<MyChecksState>({
    tokenIds: [], checks: {}, loading: false, error: '',
  })

  useEffect(() => {
    if (!enabled || !address) {
      setState({ tokenIds: [], checks: {}, loading: false, error: '' })
      return
    }

    // Try cache first
    const cached = readMyChecksCache(address)
    if (cached) {
      setState({
        tokenIds: cached.tokenIds,
        checks: Object.fromEntries(
          Object.entries(cached.checks).map(([id, s]) => [id, deserialize(s)])
        ),
        loading: false,
        error: '',
      })
      return
    }

    const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined
    if (!alchemyKey) {
      setState({ tokenIds: [], checks: {}, loading: false, error: 'VITE_ALCHEMY_API_KEY not set' })
      return
    }

    setState(prev => ({ ...prev, loading: true, error: '' }))

    fetchOwnedTokenIds(address, alchemyKey)
      .then(async (tokenIds) => {
        if (tokenIds.length === 0) {
          setState({ tokenIds: [], checks: {}, loading: false, error: '' })
          return
        }

        const bigIds = tokenIds.map(id => BigInt(id))
        const results = await Promise.allSettled(
          bigIds.map(id =>
            checksClient.readContract({
              address: CHECKS_CONTRACT,
              abi: CHECKS_ABI,
              functionName: 'getCheck',
              args: [id],
            })
          )
        )

        const checks: Record<string, CheckStruct> = {}
        const serialized: Record<string, SerializedCheckStruct> = {}

        for (let i = 0; i < tokenIds.length; i++) {
          const r = results[i]
          if (r.status === 'fulfilled') {
            const cs = r.value as CheckStruct
            checks[tokenIds[i]] = cs
            serialized[tokenIds[i]] = {
              ...cs,
              seed: cs.seed.toString(),
              stored: {
                ...cs.stored,
                composites: [...cs.stored.composites],
                colorBands: [...cs.stored.colorBands],
                gradients: [...cs.stored.gradients],
              },
            }
          }
        }

        writeMyChecksCache(address, { tokenIds, checks: serialized, cachedAt: Date.now() })
        setState({ tokenIds, checks, loading: false, error: '' })
      })
      .catch(err => {
        setState(prev => ({ ...prev, loading: false, error: String(err) }))
      })
  }, [address, enabled])

  return state
}
