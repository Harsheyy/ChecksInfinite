import { useState, useEffect } from 'react'
import { checksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import type { CheckStruct } from './utils'
import { useMyCheckPermutations } from './useMyCheckPermutations'

export const EXPLORE_MAX_IDS = 6

export function useExplorePermutations() {
  const [checks, setChecks] = useState<Record<string, CheckStruct>>({})
  const [loading, setLoading]   = useState(false)
  const [error,   setError]     = useState('')
  const [searched, setSearched] = useState(false)

  const { permutations, generate, shuffle } = useMyCheckPermutations(checks)

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

    const bigIds = ids.map(id => BigInt(id))

    const results = await Promise.allSettled(
      bigIds.map(id =>
        checksClient.readContract({
          address: CHECKS_CONTRACT,
          abi: CHECKS_ABI,
          functionName: 'getCheck',
          args: [id],
        })
      )
    )

    const newChecks: Record<string, CheckStruct> = {}
    const fetchErrors: string[] = []

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        newChecks[ids[i]] = result.value as CheckStruct
      } else {
        fetchErrors.push(`#${ids[i]}`)
      }
    })

    if (fetchErrors.length > 0) {
      setError(`Could not fetch: ${fetchErrors.join(', ')}. Check that these token IDs exist.`)
    }

    setChecks(newChecks)
    setLoading(false)
  }

  function clear() {
    setChecks({})
    setSearched(false)
    setError('')
  }

  return { search, clear, permutations, shuffle, loading, error, searched, checks }
}
