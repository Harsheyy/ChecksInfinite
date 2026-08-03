import { useState, useEffect } from 'react'
import { checksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import type { CheckStruct } from './utils'
import { useMyCheckPermutations } from './useMyCheckPermutations'
import { supabase } from './supabaseClient'
import { fetchCheckStructMap, fromJSON } from './usePermutationsDB'

export const EXPLORE_MAX_IDS = 10

export function useExplorePermutations(address?: string) {
  const [checks, setChecks] = useState<Record<string, CheckStruct>>({})
  const [loading, setLoading]   = useState(false)
  const [error,   setError]     = useState('')
  const [searched, setSearched] = useState(false)

  const { permutations, generate, shuffle, reset } = useMyCheckPermutations(checks)

  // Auto-generate when checks update after a search
  useEffect(() => {
    if (searched && Object.keys(checks).length >= 4) generate()
  }, [checks]) // eslint-disable-line react-hooks/exhaustive-deps

  async function search(ids: string[]) {
    if (ids.length < 4) { setError('Enter at least 4 token IDs.'); return }
    if (ids.length > EXPLORE_MAX_IDS) { setError(`Maximum ${EXPLORE_MAX_IDS} IDs.`); return }

    setLoading(true)
    setError('')
    setSearched(true)
    setChecks({})

    const idsAsNums = ids.map(id => parseInt(id, 10))
    const dbMap = await fetchCheckStructMap(idsAsNums)

    const newChecks: Record<string, CheckStruct> = {}
    for (const id of ids) {
      const numId = parseInt(id, 10)
      const json = dbMap.get(numId)
      if (json) {
        newChecks[id] = fromJSON(json)
      }
    }

    // Fallback on-chain for IDs missing from all_checks
    const missing = ids.filter(id => !newChecks[id])
    const fetchErrors: string[] = []

    if (missing.length > 0) {
      const results = await Promise.allSettled(
        missing.map(id =>
          checksClient.readContract({
            address: CHECKS_CONTRACT,
            abi: CHECKS_ABI,
            functionName: 'getCheck',
            args: [BigInt(id)],
          })
        )
      )
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          newChecks[missing[i]] = result.value as CheckStruct
        } else {
          fetchErrors.push(`#${missing[i]}`)
        }
      })
    }

    // Token IDs path policy: hard error if any user-typed ID can't be resolved
    if (fetchErrors.length > 0) {
      setError(`Could not fetch: ${fetchErrors.join(', ')}. Check that these token IDs exist.`)
    }

    setChecks(newChecks)
    setLoading(false)

    if (supabase && address) {
      supabase.rpc('log_explore_query', { p_address: address.toLowerCase() })
        .then(() => {}, err => console.warn('[analytics] log_explore_query failed:', err))
    }
  }

  function clear() {
    setChecks({})
    setSearched(false)
    setError('')
    reset()
  }

  return { search, clear, permutations, shuffle, loading, error, searched, checks }
}
