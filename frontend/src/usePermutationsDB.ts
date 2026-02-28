import { useState, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import { simulateCompositeJS, generateSVGJS, computeL2, buildL2RenderMap } from './checksArtJS'
import { mapCheckAttributes, type CheckStruct } from './utils'
import type { PermutationResult } from './useAllPermutations'
import type { Filters } from './components/FilterBar'

const PAGE_SIZE = 200

// CheckStruct stored in Supabase has seed as string (bigint serialization)
interface CheckStructJSON {
  stored: {
    composites: number[]
    colorBands: number[]
    gradients: number[]
    divisorIndex: number
    epoch: number
    seed: number
    day: number
  }
  isRevealed: boolean
  seed: string
  checksCount: number
  hasManyChecks: boolean
  composite: number
  isRoot: boolean
  colorBand: number
  gradient: number
  direction: number
  speed: number
}

function fromJSON(j: CheckStructJSON): CheckStruct {
  return { ...j, seed: BigInt(j.seed), stored: { ...j.stored } }
}

interface ChecksRow {
  check_struct: CheckStructJSON
}

interface PermRow {
  keeper_1_id: number
  burner_1_id: number
  keeper_2_id: number
  burner_2_id: number
  // SVGs not stored — computed client-side
  abcd_checks: number | null
  abcd_color_band: string | null
  abcd_gradient: string | null
  abcd_speed: string | null
  abcd_shift: string | null
  keeper_1: ChecksRow
  burner_1: ChecksRow
  keeper_2: ChecksRow
  burner_2: ChecksRow
}

function computeAllNodes(row: PermRow): Pick<PermutationResult, 'nodeL1a' | 'nodeL1b' | 'nodeAbcd'> {
  try {
    const k1 = fromJSON(row.keeper_1.check_struct)
    const b1 = fromJSON(row.burner_1.check_struct)
    const k2 = fromJSON(row.keeper_2.check_struct)
    const b2 = fromJSON(row.burner_2.check_struct)

    const l1aStruct = simulateCompositeJS(k1, b1, row.burner_1_id)
    const l1bStruct = simulateCompositeJS(k2, b2, row.burner_2_id)

    const l1aSvg = generateSVGJS(l1aStruct, new Map<number, CheckStruct>([[row.burner_1_id, b1]]))
    const l1bSvg = generateSVGJS(l1bStruct, new Map<number, CheckStruct>([[row.burner_2_id, b2]]))

    const abcdStruct = computeL2(l1aStruct, l1bStruct)
    const abcdMap    = buildL2RenderMap(l1aStruct, l1bStruct, b1, b2)
    const abcdSvg    = generateSVGJS(abcdStruct, abcdMap)
    const abcdAttrs  = mapCheckAttributes(abcdStruct)

    return {
      nodeL1a:  { name: '', svg: l1aSvg, attributes: mapCheckAttributes(l1aStruct), loading: false, error: '' },
      nodeL1b:  { name: '', svg: l1bSvg, attributes: mapCheckAttributes(l1bStruct), loading: false, error: '' },
      nodeAbcd: { name: 'Final Composite', svg: abcdSvg, attributes: abcdAttrs, loading: false, error: '' },
    }
  } catch (e) {
    const err = String(e)
    return {
      nodeL1a:  { name: '', svg: '', attributes: [], loading: false, error: err },
      nodeL1b:  { name: '', svg: '', attributes: [], loading: false, error: err },
      nodeAbcd: { name: 'Final Composite', svg: '', attributes: [], loading: false, error: err },
    }
  }
}

function rowToPermutationResult(row: PermRow): PermutationResult {
  const id0 = String(row.keeper_1_id)
  const id1 = String(row.burner_1_id)
  const id2 = String(row.keeper_2_id)
  const id3 = String(row.burner_2_id)

  const { nodeL1a, nodeL1b, nodeAbcd } = computeAllNodes(row)

  return {
    def: {
      indices: [0, 1, 2, 3],
      label: `#${id0}▸#${id1}, #${id2}▸#${id3}`,
      tokenIds: [id0, id1, id2, id3],
    },
    // Individual check SVGs are fetched lazily by TreeModal on demand
    nodeA:    { name: `Token #${id0}`, svg: '', attributes: [], loading: false, error: '' },
    nodeB:    { name: `Token #${id1}`, svg: '', attributes: [], loading: false, error: '' },
    nodeC:    { name: `Token #${id2}`, svg: '', attributes: [], loading: false, error: '' },
    nodeD:    { name: `Token #${id3}`, svg: '', attributes: [], loading: false, error: '' },
    nodeL1a:  { ...nodeL1a, name: `#${id0}+#${id1}` },
    nodeL1b:  { ...nodeL1b, name: `#${id2}+#${id3}` },
    nodeAbcd,
  }
}

export interface DBPermutationsState {
  permutations: PermutationResult[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string
  total: number
}

export function usePermutationsDB() {
  const [state, setState] = useState<DBPermutationsState>({
    permutations: [],
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: '',
    total: 0,
  })

  // Track current filters + offset for pagination
  const filtersRef = useRef<Filters | null>(null)
  const offsetRef  = useRef(0)

  const buildQuery = useCallback((filters: Filters, from: number) => {
    if (!supabase) throw new Error('Supabase not configured')

    let q = supabase
      .from('permutations')
      .select(`
        keeper_1_id, burner_1_id, keeper_2_id, burner_2_id,
        abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift,
        keeper_1:checks!keeper_1_id(check_struct),
        burner_1:checks!burner_1_id(check_struct),
        keeper_2:checks!keeper_2_id(check_struct),
        burner_2:checks!burner_2_id(check_struct)
      `, { count: 'exact' })
      .range(from, from + PAGE_SIZE - 1)

    if (filters.checks)    q = q.eq('abcd_checks',     Number(filters.checks))
    if (filters.colorBand) q = q.eq('abcd_color_band', filters.colorBand)
    if (filters.gradient)  q = q.eq('abcd_gradient',   filters.gradient)
    if (filters.speed)     q = q.eq('abcd_speed',      filters.speed)
    if (filters.shift)     q = q.eq('abcd_shift',      filters.shift)

    return q
  }, [])

  // Initial load or filter change — replaces all results
  const load = useCallback(async (filters: Filters) => {
    if (!supabase) return

    filtersRef.current = filters
    offsetRef.current  = 0

    setState(prev => ({ ...prev, loading: true, error: '', permutations: [] }))

    try {
      const { data, error, count } = await buildQuery(filters, 0)
      if (error) throw error

      const rows = (data ?? []) as unknown as PermRow[]
      const permutations = rows.map(rowToPermutationResult)
      const total = count ?? 0

      offsetRef.current = rows.length
      setState({
        permutations,
        loading: false,
        loadingMore: false,
        hasMore: rows.length < total,
        error: '',
        total,
      })
    } catch (e) {
      setState(prev => ({ ...prev, loading: false, error: String(e) }))
    }
  }, [buildQuery])

  // Load next page — appends to existing results
  const loadMore = useCallback(async () => {
    if (!supabase || !filtersRef.current) return

    setState(prev => ({ ...prev, loadingMore: true }))

    try {
      const { data, error, count } = await buildQuery(filtersRef.current, offsetRef.current)
      if (error) throw error

      const rows = (data ?? []) as unknown as PermRow[]
      const newPerms = rows.map(rowToPermutationResult)
      const total = count ?? 0

      offsetRef.current += rows.length
      setState(prev => ({
        ...prev,
        permutations: [...prev.permutations, ...newPerms],
        loadingMore: false,
        hasMore: offsetRef.current < total,
        total,
      }))
    } catch (e) {
      setState(prev => ({ ...prev, loadingMore: false, error: String(e) }))
    }
  }, [buildQuery])

  return { state, load, loadMore }
}
