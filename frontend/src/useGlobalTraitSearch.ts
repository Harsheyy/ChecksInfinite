// frontend/src/useGlobalTraitSearch.ts
import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import {
  attachChecks,
  rowToPermutationResult,
  type PermRowBasic,
} from './usePermutationsDB'
import type { PermutationResult } from './useAllPermutations'
import type { SearchFilters } from './searchFilters'

export const GLOBAL_TRAIT_LIMIT = 500

export interface GlobalTraitSearchState {
  permutations: PermutationResult[]
  totalMatches: number      // 0 until the count query resolves
  capped: boolean           // true iff totalMatches > GLOBAL_TRAIT_LIMIT
  loading: boolean
  error: string
}

function applyTraitFilters(query: any, filters: SearchFilters): any {
  let q = query
  if (filters.checks.length > 0) {
    // abcd_checks is numeric in the DB; cast string options to int
    q = q.in('abcd_checks', filters.checks.map(s => parseInt(s, 10)))
  }
  if (filters.colorBand.length > 0) q = q.in('abcd_color_band', filters.colorBand)
  if (filters.gradient.length > 0)  q = q.in('abcd_gradient', filters.gradient)
  if (filters.speed.length > 0)     q = q.in('abcd_speed', filters.speed)
  if (filters.shift.length > 0)     q = q.in('abcd_shift', filters.shift)
  return q
}

export function useGlobalTraitSearch() {
  const [state, setState] = useState<GlobalTraitSearchState>({
    permutations: [], totalMatches: 0, capped: false, loading: false, error: '',
  })

  const run = useCallback(async (filters: SearchFilters) => {
    if (!supabase) return
    setState(prev => ({ ...prev, loading: true, error: '' }))

    try {
      // Exact count for the cap notice
      const countQ = applyTraitFilters(
        supabase.from('permutations').select('*', { count: 'exact', head: true }),
        filters
      )
      const { count, error: countErr } = await countQ
      if (countErr) throw countErr
      const total = count ?? 0

      // Capped page
      const dataQ = applyTraitFilters(
        supabase.from('permutations').select(
          'keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost'
        ),
        filters
      ).order('rand_key').limit(GLOBAL_TRAIT_LIMIT)

      const { data, error } = await dataQ
      if (error) throw error

      const basicRows = (data ?? []) as unknown as PermRowBasic[]
      const rows      = await attachChecks(basicRows)

      setState({
        permutations: rows.map(rowToPermutationResult),
        totalMatches: total,
        capped: total > GLOBAL_TRAIT_LIMIT,
        loading: false,
        error: '',
      })
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e)
      setState({ permutations: [], totalMatches: 0, capped: false, loading: false, error: msg })
    }
  }, [])

  const reset = useCallback(() => {
    setState({ permutations: [], totalMatches: 0, capped: false, loading: false, error: '' })
  }, [])

  return { ...state, run, reset }
}
