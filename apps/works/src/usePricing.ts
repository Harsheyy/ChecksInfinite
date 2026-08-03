import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

export type ActionType = 'search_query' | 'recipe_view' | 'pattern_query'

// Reads directly from pricing_config (public SELECT via RLS policy) rather
// than hardcoding prices in the frontend — prices are a table specifically
// so they can be retuned via SQL without a redeploy, which only works if
// the UI actually reads them live. Prices are in credits (search_query =
// 0.5, recipe_view = 0.25, pattern_query = 0.5) — small enough magnitudes
// that plain numbers are fine, no BigInt/precision concerns the way wei
// amounts had.
export function usePricing() {
  const [prices, setPrices] = useState<Record<ActionType, number>>({
    search_query: 0,
    recipe_view: 0,
    pattern_query: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase
      .from('pricing_config')
      .select('action_type, price_credits')
      .then(({ data }) => {
        if (data) {
          const next = { search_query: 0, recipe_view: 0, pattern_query: 0 }
          for (const row of data as { action_type: ActionType; price_credits: number }[]) {
            next[row.action_type] = row.price_credits
          }
          setPrices(next)
        }
        setLoading(false)
      })
  }, [])

  return { prices, loading }
}
