import { useEffect, useState } from 'react'
import { supabase, hasSupabase } from '@checks-wiki/shared'

export interface CombinationItem {
  tokenId: number
  checksCount: number
  ethPrice: number
}

export interface CheckmathSnapshot {
  computedAt: string
  cheapestSinglePrice: number | null
  cheapestSingleTokenId: number | null
  optimalCombinationCost: number | null
  optimalCombinationItems: CombinationItem[]
  checksSweepCost: number | null
  editionsSweepCost: number | null
}

interface SnapshotRow {
  computed_at: string
  cheapest_single_price: number | null
  cheapest_single_token_id: number | null
  optimal_combination_cost: number | null
  optimal_combination: { items: CombinationItem[] } | null
  checks_sweep_cost: number | null
  editions_sweep_cost: number | null
}

export function useCheckmathSnapshot() {
  const [snapshot, setSnapshot] = useState<CheckmathSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!hasSupabase() || !supabase) {
        if (!cancelled) {
          setError('Supabase not configured')
          setLoading(false)
        }
        return
      }

      const { data, error: fetchError } = await supabase
        .from('checkmath_snapshots')
        .select('computed_at, cheapest_single_price, cheapest_single_token_id, optimal_combination_cost, optimal_combination, checks_sweep_cost, editions_sweep_cost')
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle<SnapshotRow>()

      if (cancelled) return

      if (fetchError) {
        setError(fetchError.message)
      } else if (data) {
        setSnapshot({
          computedAt: data.computed_at,
          cheapestSinglePrice: data.cheapest_single_price,
          cheapestSingleTokenId: data.cheapest_single_token_id,
          optimalCombinationCost: data.optimal_combination_cost,
          optimalCombinationItems: data.optimal_combination?.items ?? [],
          checksSweepCost: data.checks_sweep_cost,
          editionsSweepCost: data.editions_sweep_cost,
        })
      } else {
        setError('No snapshot data yet')
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [])

  return { snapshot, loading, error }
}
