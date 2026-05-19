import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import {
  type PermRowBasic,
  type PermRow,
  attachChecks,
  rowToPermutationResult,
  type DBPermutationsState,
} from './usePermutationsDB'

// Always show top 900 all-listed permutations sorted rarest-first (no random offset —
// deterministic so the user sees the best buyable combos every time).
const PAGE_SIZE = 900

export function useAllChecksPermutations() {
  const [state, setState] = useState<DBPermutationsState>({
    permutations: [],
    loading: false,
    error: '',
    total: 0,
  })

  const load = useCallback(async () => {
    if (!supabase) return

    setState(prev => ({ ...prev, loading: true, error: '', permutations: [] }))
    try {
      const { data, error } = await supabase
        .from('all_permutations')
        .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost')
        .eq('is_all_listed', true)
        .order('abcd_checks', { ascending: true, nullsFirst: false })
        .limit(PAGE_SIZE)

      if (error) throw error

      const basicRows = (data ?? []) as unknown as PermRowBasic[]
      const rows: PermRow[] = await attachChecks(basicRows)

      setState({
        permutations: rows.map(r => ({ ...rowToPermutationResult(r), fromTokenWorks: false })),
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

  // Reload = refresh in case prices changed since last sync
  const shuffle = useCallback(() => load(), [load])

  return { state, load, shuffle }
}

export type { DBPermutationsState }
