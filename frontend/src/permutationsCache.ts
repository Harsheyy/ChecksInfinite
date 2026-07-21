// frontend/src/permutationsCache.ts
import type { PermRow } from './usePermutationsDB'

const KEYS = {
  tokenWorks: 'checks-infinite-perms-v3',
  opensea:    'checks-infinite-perms-opensea-v2',
} as const

const TTL_MS = 10 * 60 * 1000 // 10 minutes

interface CacheEntry {
  rows:      PermRow[]
  expiresAt: number
}

function read(key: string): PermRow[] | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() > entry.expiresAt) {
      sessionStorage.removeItem(key)
      return null
    }
    return entry.rows
  } catch {
    return null
  }
}

function write(key: string, rows: PermRow[]): void {
  try {
    const entry: CacheEntry = { rows, expiresAt: Date.now() + TTL_MS }
    sessionStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // QuotaExceededError or private-browsing restriction — silently ignore
  }
}

export const readCache       = () => read(KEYS.tokenWorks)
export const writeCache      = (rows: PermRow[]) => write(KEYS.tokenWorks, rows)
export const readOpenSeaCache  = () => read(KEYS.opensea)
export const writeOpenSeaCache = (rows: PermRow[]) => write(KEYS.opensea, rows)
