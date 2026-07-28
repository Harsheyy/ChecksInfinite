import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

type ActionType = 'search_query' | 'recipe_view'

// Reads directly from pricing_config (public SELECT via RLS policy in
// 034_credits.sql) rather than hardcoding prices in the frontend — prices
// are a table specifically so they can be retuned via SQL without a
// redeploy, which only works if the UI actually reads them live.
export function usePricing() {
  const [prices, setPrices] = useState<Record<ActionType, bigint>>({
    search_query: 0n,
    recipe_view: 0n,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase
      .from('pricing_config')
      .select('action_type, price_wei')
      .then(({ data }) => {
        if (data) {
          const next = { search_query: 0n, recipe_view: 0n }
          for (const row of data as { action_type: ActionType; price_wei: string }[]) {
            next[row.action_type] = BigInt(row.price_wei)
          }
          setPrices(next)
        }
        setLoading(false)
      })
  }, [])

  return { prices, loading }
}
