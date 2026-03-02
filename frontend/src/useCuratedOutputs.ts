// frontend/src/useCuratedOutputs.ts
import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { fromJSON, type CheckStructJSON } from './usePermutationsDB'
import { simulateCompositeJS, generateSVGJS, computeL2, buildL2RenderMap } from './checksArtJS'
import { mapCheckAttributes, type CheckStruct } from './utils'
import type { PermutationResult } from './useAllPermutations'
import type { Filters } from './components/FilterBar'

interface CuratedRow {
  id: number
  keeper_1_id: number
  burner_1_id: number
  keeper_2_id: number
  burner_2_id: number
  abcd_checks: number
  abcd_color_band: string
  abcd_gradient: string
  abcd_speed: string
  abcd_shift: string | null
  k1_struct: CheckStructJSON | null
  b1_struct: CheckStructJSON | null
  k2_struct: CheckStructJSON | null
  b2_struct: CheckStructJSON | null
  like_count: number
  user_liked: boolean
  first_liked_at: string
}

export interface CuratedPermutationResult extends PermutationResult {
  outputId: number
  likeCount: number
  userLiked: boolean
}

function buildCuratedResult(row: CuratedRow): CuratedPermutationResult | null {
  const k1s = row.k1_struct
  const b1s = row.b1_struct
  const k2s = row.k2_struct
  const b2s = row.b2_struct
  if (!k1s || !b1s || !k2s || !b2s) return null

  const id0 = String(row.keeper_1_id)
  const id1 = String(row.burner_1_id)
  const id2 = String(row.keeper_2_id)
  const id3 = String(row.burner_2_id)

  try {
    const k1 = fromJSON(k1s)
    const b1 = fromJSON(b1s)
    const k2 = fromJSON(k2s)
    const b2 = fromJSON(b2s)

    const l1aStruct  = simulateCompositeJS(k1, b1, row.burner_1_id)
    const l1bStruct  = simulateCompositeJS(k2, b2, row.burner_2_id)
    const abcdStruct = computeL2(l1aStruct, l1bStruct)
    const abcdMap    = buildL2RenderMap(l1aStruct, l1bStruct, b1, b2)

    let _k1Svg:   string | undefined
    let _b1Svg:   string | undefined
    let _k2Svg:   string | undefined
    let _b2Svg:   string | undefined
    let _l1aSvg:  string | undefined
    let _l1bSvg:  string | undefined
    let _abcdSvg: string | undefined

    const base: PermutationResult = {
      def: {
        indices:  [0, 1, 2, 3],
        label:    `#${id0}▸#${id1}, #${id2}▸#${id3}`,
        tokenIds: [id0, id1, id2, id3],
      },
      nodeA: {
        name: `Token #${id0}`,
        attributes: mapCheckAttributes(k1),
        loading: false, error: '',
        get svg() {
          if (_k1Svg !== undefined) return _k1Svg
          try { return (_k1Svg = generateSVGJS(k1, new Map())) } catch { return (_k1Svg = '') }
        },
      },
      nodeB: {
        name: `Token #${id1}`,
        attributes: mapCheckAttributes(b1),
        loading: false, error: '',
        get svg() {
          if (_b1Svg !== undefined) return _b1Svg
          try { return (_b1Svg = generateSVGJS(b1, new Map())) } catch { return (_b1Svg = '') }
        },
      },
      nodeC: {
        name: `Token #${id2}`,
        attributes: mapCheckAttributes(k2),
        loading: false, error: '',
        get svg() {
          if (_k2Svg !== undefined) return _k2Svg
          try { return (_k2Svg = generateSVGJS(k2, new Map())) } catch { return (_k2Svg = '') }
        },
      },
      nodeD: {
        name: `Token #${id3}`,
        attributes: mapCheckAttributes(b2),
        loading: false, error: '',
        get svg() {
          if (_b2Svg !== undefined) return _b2Svg
          try { return (_b2Svg = generateSVGJS(b2, new Map())) } catch { return (_b2Svg = '') }
        },
      },
      nodeL1a: {
        name: `#${id0}+#${id1}`,
        attributes: mapCheckAttributes(l1aStruct),
        loading: false, error: '',
        get svg() {
          if (_l1aSvg !== undefined) return _l1aSvg
          return (_l1aSvg = generateSVGJS(l1aStruct, new Map<number, CheckStruct>([[row.burner_1_id, b1]])))
        },
      },
      nodeL1b: {
        name: `#${id2}+#${id3}`,
        attributes: mapCheckAttributes(l1bStruct),
        loading: false, error: '',
        get svg() {
          if (_l1bSvg !== undefined) return _l1bSvg
          return (_l1bSvg = generateSVGJS(l1bStruct, new Map<number, CheckStruct>([[row.burner_2_id, b2]])))
        },
      },
      nodeAbcd: {
        name: 'Final Composite',
        attributes: mapCheckAttributes(abcdStruct),
        loading: false, error: '',
        get svg() {
          if (_abcdSvg !== undefined) return _abcdSvg
          return (_abcdSvg = generateSVGJS(abcdStruct, abcdMap))
        },
      },
    }

    return { ...base, outputId: row.id, likeCount: row.like_count, userLiked: row.user_liked }
  } catch {
    return null
  }
}

export interface CuratedState {
  outputs: CuratedPermutationResult[]
  loading: boolean
  error: string
}

export function useCuratedOutputs() {
  const [state, setState] = useState<CuratedState>({
    outputs: [],
    loading: false,
    error: '',
  })

  const load = useCallback(async (
    filters: Filters,
    walletOnly: boolean,
    wallet: string | undefined,
  ) => {
    if (!supabase) return
    setState({ outputs: [], loading: true, error: '' })

    try {
      const params: Record<string, unknown> = {
        p_wallet:      wallet ?? null,
        p_wallet_only: walletOnly,
        p_limit:       200,
        p_offset:      0,
      }
      if (filters.checks)    params.p_checks     = parseInt(filters.checks, 10)
      if (filters.colorBand) params.p_color_band = filters.colorBand
      if (filters.gradient)  params.p_gradient   = filters.gradient
      if (filters.speed)     params.p_speed      = filters.speed
      if (filters.shift)     params.p_shift      = filters.shift

      const { data, error } = await supabase.rpc('get_curated_outputs', params)
      if (error) throw error

      const rows = (data ?? []) as CuratedRow[]

      const outputs = rows
        .map(r => buildCuratedResult(r))
        .filter((r): r is CuratedPermutationResult => r !== null)

      setState({ outputs, loading: false, error: '' })
    } catch (e) {
      setState({ outputs: [], loading: false, error: String(e) })
    }
  }, [])

  return { state, load }
}
