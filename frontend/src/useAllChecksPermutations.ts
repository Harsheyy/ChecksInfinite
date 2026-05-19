import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import type { PermutationResult } from './useAllPermutations'
import {
  type PermRowBasic,
  type PermRow,
  attachChecks,
  rowToPermutationResult,
  type DBPermutationsState,
} from './usePermutationsDB'

const RANDOM_TOTAL = 2500

// all_permutations rows have color_family too, but we don't need it for rendering
type AllPermRowBasic = PermRowBasic & { color_family: number | null }

export function useAllChecksPermutations() {
  const [state, setState] = useState<DBPermutationsState>({
    permutations: [],
    loading: false,
    error: '',
    total: 0,
  })

  const loadRandom = useCallback(async (force = false) => {
    if (!supabase) return

    setState(prev => ({ ...prev, loading: true, error: '', permutations: [] }))
    try {
      const { count } = await supabase
        .from('all_permutations')
        .select('*', { count: 'exact', head: true })

      const total  = count ?? 0
      const offset = total > RANDOM_TOTAL ? Math.floor(Math.random() * (total - RANDOM_TOTAL)) : 0

      const { data, error } = await supabase
        .from('all_permutations')
        .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost, color_family')
        .order('rand_key')
        .range(offset, offset + RANDOM_TOTAL - 1)

      if (error) throw error

      const basicRows = (data ?? []) as unknown as AllPermRowBasic[]
      // attachChecks only needs the PermRowBasic fields — color_family is extra
      const rows: PermRow[] = await attachChecks(basicRows as PermRowBasic[])

      setState({
        permutations: rows.map(rowToPermutationResult),
        loading: false,
        error: '',
        total: rows.length,
      })
    } catch (e) {
      const raw = (e as { message?: string })?.message ?? String(e)
      const msg = raw.includes('canceling statement due to statement timeout')
        ? 'The database is under heavy load and the request timed out. Please refresh and try again.'
        : raw
      setState(prev => ({ ...prev, loading: false, error: msg }))
    }
  }, [])

  const shuffle = useCallback(() => loadRandom(true), [loadRandom])

  return { state, loadRandom, shuffle }
}

export type { DBPermutationsState }
