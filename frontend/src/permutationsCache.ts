// frontend/src/permutationsCache.ts
import type { PermRow } from './usePermutationsDB'

const CACHE_KEY = 'checks-infinite-perms-v1'

export function readCache(): PermRow[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PermRow[]
  } catch {
    return null
  }
}

export function writeCache(rows: PermRow[]): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch {
    // QuotaExceededError or private-browsing restriction — silently ignore
  }
}
