import type { CombinationItem, Collection } from './useCheckmathSnapshot'

const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1'
const EDITIONS_CONTRACT = '0x34eebee6942d8def3c125458d1a86e0a897fd6f9'

export function tierKey(checksCount: number, collection: Collection): string {
  return `${checksCount}-${collection}`
}

/** Singular label for one token at this tier. */
export function tierLabel(checksCount: number, collection: Collection): string {
  return collection === 'editions' ? 'Edition' : `${checksCount}-check`
}

/** Pluralized label with a count, e.g. "80-checks × 20". */
export function tierCountLabel(checksCount: number, collection: Collection, n: number): string {
  return `${tierLabel(checksCount, collection)}${n > 1 ? 's' : ''} × ${n}`
}

export function openSeaUrl(item: { tokenId: number; collection: Collection }): string {
  const contract = item.collection === 'editions' ? EDITIONS_CONTRACT : CHECKS_CONTRACT
  return `https://opensea.io/assets/ethereum/${contract}/${item.tokenId}`
}

export interface Tier {
  key: string
  checksCount: number
  collection: Collection
  items: CombinationItem[]
  subtotal: number
}

/**
 * Group combination items into tiers, highest checksCount first, with each
 * tier's tokens sorted cheapest-first and its subtotal precomputed — the
 * subtotal is what makes the list answer "where does the cost actually sit?"
 * rather than just "what would I buy?".
 */
export function groupIntoTiers(items: CombinationItem[]): Tier[] {
  const byKey = new Map<string, CombinationItem[]>()
  for (const item of items) {
    const key = tierKey(item.checksCount, item.collection)
    const list = byKey.get(key) ?? []
    list.push(item)
    byKey.set(key, list)
  }

  return [...byKey.entries()]
    .map(([key, tierItems]) => ({
      key,
      checksCount: tierItems[0].checksCount,
      collection: tierItems[0].collection,
      items: [...tierItems].sort((a, b) => a.ethPrice - b.ethPrice),
      subtotal: tierItems.reduce((sum, t) => sum + t.ethPrice, 0),
    }))
    .sort((a, b) => {
      if (b.checksCount !== a.checksCount) return b.checksCount - a.checksCount
      return a.collection.localeCompare(b.collection)
    })
}
