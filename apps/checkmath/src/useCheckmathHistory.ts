import { useEffect, useState } from 'react'
import { supabase, hasSupabase } from '@checks-wiki/shared'

export interface HistoryDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string
  /** Lowest price for a single Check seen that day. Null if none was listed. */
  buyLow: number | null
  /** Lowest cost to compose a single that day. Null if supply never reached 64 units. */
  composeLow: number | null
  /**
   * Lowest compose-to-buy ratio seen that day, computed per snapshot before
   * aggregating (see migration 049). Below 1 means composing beat buying
   * outright at some point that day.
   */
  composePremiumLow: number | null
  /** How many hourly snapshots fed this day — a partial day is still plotted. */
  snapshots: number
}

interface HistoryRow {
  day: string
  buy_low: number | null
  compose_low: number | null
  compose_premium_low: number | null
  snapshots: number | null
}

const WINDOW_DAYS = 90

export function useCheckmathHistory() {
  const [days, setDays] = useState<HistoryDay[]>([])
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

      const { data, error: rpcError } = await supabase.rpc('get_checkmath_daily_history', {
        p_days: WINDOW_DAYS,
      })

      if (cancelled) return

      if (rpcError) {
        setError(rpcError.message)
      } else {
        setDays(
          ((data ?? []) as HistoryRow[]).map(row => ({
            day: row.day,
            buyLow: row.buy_low,
            composeLow: row.compose_low,
            composePremiumLow: row.compose_premium_low,
            snapshots: row.snapshots ?? 0,
          })),
        )
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { days, loading, error }
}
