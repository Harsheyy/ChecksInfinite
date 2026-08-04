import { useEffect, useState } from 'react'
import { supabase, hasSupabase } from '@checks-wiki/shared'
import type { CombinationItem } from './useCheckmathSnapshot'

export interface TokenImages {
  checksSvgByTokenId: Map<number, string>
  editionsImageByTokenId: Map<number, string>
}

const EMPTY_IMAGES: TokenImages = { checksSvgByTokenId: new Map(), editionsImageByTokenId: new Map() }

// Deliberately a follow-up query, not embedded in checkmath_snapshots itself —
// keeps hourly snapshot rows small (just prices/token IDs), which matters
// once these rows start accumulating for a future price-history feature.
export function useTokenImages(cheapestSingleTokenId: number | null, items: CombinationItem[]): TokenImages {
  const [images, setImages] = useState<TokenImages>(EMPTY_IMAGES)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!hasSupabase() || !supabase) return

      const checksIds = new Set<number>()
      if (cheapestSingleTokenId !== null) checksIds.add(cheapestSingleTokenId)
      const editionsIds = new Set<number>()
      for (const item of items) {
        if (item.collection === 'editions') editionsIds.add(item.tokenId)
        else checksIds.add(item.tokenId)
      }

      const [checksResult, editionsResult] = await Promise.all([
        checksIds.size > 0
          ? supabase.from('all_checks').select('token_id, svg').in('token_id', [...checksIds])
          : Promise.resolve({ data: [] as { token_id: number; svg: string | null }[] }),
        editionsIds.size > 0
          ? supabase.from('editions_checks').select('token_id, image_url').in('token_id', [...editionsIds])
          : Promise.resolve({ data: [] as { token_id: number; image_url: string | null }[] }),
      ])

      if (cancelled) return

      const checksSvgByTokenId = new Map<number, string>()
      for (const row of checksResult.data ?? []) {
        if (row.svg) checksSvgByTokenId.set(row.token_id, row.svg)
      }
      const editionsImageByTokenId = new Map<number, string>()
      for (const row of editionsResult.data ?? []) {
        if (row.image_url) editionsImageByTokenId.set(row.token_id, row.image_url)
      }

      setImages({ checksSvgByTokenId, editionsImageByTokenId })
    }

    load()
    return () => { cancelled = true }
  }, [cheapestSingleTokenId, items])

  return images
}
