import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { attachChecks, rowToPermutationResult, type PermRowBasic } from './usePermutationsDB'

const BG_COUNT = 20
const CHUNK    = 4   // SVGs computed per frame before yielding to the browser

export function useBackgroundPermutations(): string[] {
  const [svgs, setSvgs] = useState<string[]>([])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false

    const db = supabase  // non-null (checked above)
    const run = async () => {
      const offset = Math.floor(Math.random() * 90_000)
      const { data, error } = await db
        .from('permutations')
        .select('keeper_1_id, burner_1_id, keeper_2_id, burner_2_id, abcd_checks, abcd_color_band, abcd_gradient, abcd_speed, abcd_shift, total_cost')
        .order('rand_key')
        .range(offset, offset + BG_COUNT - 1)

      if (error || !data || cancelled) return

      const rows = await attachChecks(data as unknown as PermRowBasic[])
      if (cancelled) return

      const out: string[] = []
      for (let i = 0; i < rows.length; i++) {
        const svg = rowToPermutationResult(rows[i]).nodeAbcd.svg
        if (svg) out.push(svg)

        // Yield to the browser between chunks so UI interactions stay responsive
        if ((i + 1) % CHUNK === 0) {
          setSvgs([...out])                                   // show partial panels early
          await new Promise<void>(r => setTimeout(r, 0))
          if (cancelled) return
        }
      }

      if (!cancelled) setSvgs([...out])
    }

    run()
    return () => { cancelled = true }
  }, [])

  return svgs
}
