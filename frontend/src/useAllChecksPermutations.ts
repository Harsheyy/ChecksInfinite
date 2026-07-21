import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import {
  type PermRowBasic,
  type PermRow,
  attachChecks,
  rowToPermutationResult,
  type DBPermutationsState,
} from './usePermutationsDB'
import { readOpenSeaCache, writeOpenSeaCache } from './permutationsCache'

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const PAGE_SIZE = 900

export function useAllChecksPermutations() {
  const [state, setState] = useState<DBPermutationsState>({
    permutations: [],
    loading: false,
    error: '',
    total: 0,
  })

  const load = useCallback(async (force = false) => {
    if (!supabase) return

    if (!force) {
      const cached = readOpenSeaCache()
      if (cached) {
        setState({
          permutations: cached.map(r => ({ ...rowToPermutationResult(r), fromTokenWorks: false })),
          loading: false,
          error: '',
          total: cached.length,
        })
        return
      }
    }

    setState(prev => ({ ...prev, loading: true, error: '', permutations: [] }))
    try {
      const { count } = await supabase
        .from('all_permutations')
        .select('*', { count: 'exact', head: true })

      const total  = count ?? 0
      const offset = total > PAGE_SIZE ? Math.floor(Math.random() * (total - PAGE_SIZE)) : 0

      const { data, error } = await supabase
        .from('all_permutations')
        .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost')
        .order('rand_key')
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) throw error

      const basicRows = (data ?? []) as unknown as PermRowBasic[]
      const rows: PermRow[] = fisherYates(await attachChecks(basicRows))

      writeOpenSeaCache(rows)

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

  const shuffle = useCallback(() => load(true), [load])

  return { state, load, shuffle }
}

export type { DBPermutationsState }
