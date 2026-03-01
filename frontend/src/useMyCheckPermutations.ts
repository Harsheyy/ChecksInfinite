// frontend/src/useMyCheckPermutations.ts
import { useState, useCallback } from 'react'
import {
  simulateCompositeJS, generateSVGJS, computeL2, buildL2RenderMap,
} from './checksArtJS'
import { mapCheckAttributes } from './utils'
import type { CheckStruct } from './utils'
import type { PermutationResult } from './useAllPermutations'

const MAX_PERMS = 2500

export function groupByChecksCount(
  checks: Record<string, CheckStruct>
): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const [id, cs] of Object.entries(checks)) {
    const existing = groups.get(cs.checksCount) ?? []
    existing.push(id)
    groups.set(cs.checksCount, existing)
  }
  return groups
}

/** Fisher-Yates shuffle — returns a new shuffled array. */
function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * sampleTuples — returns up to `max` distinct 4-tuples from `ids`.
 * If P(n,4) <= max, returns ALL ordered 4-tuples (exhaustive).
 * Otherwise random-samples.
 */
export function sampleTuples(
  ids: string[],
  max: number
): [string, string, string, string][] {
  const n = ids.length
  const totalPossible = n * (n - 1) * (n - 2) * (n - 3)

  if (totalPossible <= max) {
    // Exhaustive: all ordered 4-tuples
    const result: [string, string, string, string][] = []
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) { if (b === a) continue
        for (let c = 0; c < n; c++) { if (c === a || c === b) continue
          for (let d = 0; d < n; d++) { if (d === a || d === b || d === c) continue
            result.push([ids[a], ids[b], ids[c], ids[d]])
          }}}
    return result
  }

  // Random sample: shuffle + slide window across shuffled array
  const result: [string, string, string, string][] = []
  const seen = new Set<string>()
  const maxAttempts = max * 5

  for (let attempt = 0; attempt < maxAttempts && result.length < max; attempt++) {
    const s = shuffleArr(ids)
    for (let i = 0; i + 3 < s.length && result.length < max; i++) {
      const t: [string, string, string, string] = [s[i], s[i+1], s[i+2], s[i+3]]
      const key = t.join(',')
      if (!seen.has(key)) {
        seen.add(key)
        result.push(t)
      }
    }
  }

  return result
}

function buildPermutation(
  id0: string, id1: string, id2: string, id3: string,
  checks: Record<string, CheckStruct>,
): PermutationResult {
  const k1 = checks[id0], b1 = checks[id1]
  const k2 = checks[id2], b2 = checks[id3]
  try {
    const l1aStruct = simulateCompositeJS(k1, b1, parseInt(id1))
    const l1bStruct = simulateCompositeJS(k2, b2, parseInt(id3))
    const abcdStruct = computeL2(l1aStruct, l1bStruct)
    const abcdMap = buildL2RenderMap(l1aStruct, l1bStruct, b1, b2)

    let _aSvg: string | undefined, _bSvg: string | undefined
    let _cSvg: string | undefined, _dSvg: string | undefined
    let _l1aSvg: string | undefined, _l1bSvg: string | undefined
    let _abcdSvg: string | undefined

    return {
      def: {
        indices: [0, 1, 2, 3],
        label: `#${id0}▸#${id1}, #${id2}▸#${id3}`,
        tokenIds: [id0, id1, id2, id3],
      },
      nodeA: {
        name: `Token #${id0}`, attributes: mapCheckAttributes(k1), loading: false, error: '',
        get svg() { return (_aSvg ??= generateSVGJS(k1, new Map())) },
      },
      nodeB: {
        name: `Token #${id1}`, attributes: mapCheckAttributes(b1), loading: false, error: '',
        get svg() { return (_bSvg ??= generateSVGJS(b1, new Map())) },
      },
      nodeC: {
        name: `Token #${id2}`, attributes: mapCheckAttributes(k2), loading: false, error: '',
        get svg() { return (_cSvg ??= generateSVGJS(k2, new Map())) },
      },
      nodeD: {
        name: `Token #${id3}`, attributes: mapCheckAttributes(b2), loading: false, error: '',
        get svg() { return (_dSvg ??= generateSVGJS(b2, new Map())) },
      },
      nodeL1a: {
        name: `#${id0}+#${id1}`, attributes: mapCheckAttributes(l1aStruct), loading: false, error: '',
        get svg() { return (_l1aSvg ??= generateSVGJS(l1aStruct, new Map([[parseInt(id1), b1]]))) },
      },
      nodeL1b: {
        name: `#${id2}+#${id3}`, attributes: mapCheckAttributes(l1bStruct), loading: false, error: '',
        get svg() { return (_l1bSvg ??= generateSVGJS(l1bStruct, new Map([[parseInt(id3), b2]]))) },
      },
      nodeAbcd: {
        name: 'Final Composite', attributes: mapCheckAttributes(abcdStruct), loading: false, error: '',
        get svg() { return (_abcdSvg ??= generateSVGJS(abcdStruct, abcdMap)) },
      },
    }
  } catch {
    const err = 'Incompatible tokens'
    const dead = (name: string): import('./utils').CardState =>
      ({ name, svg: '', attributes: [], loading: false, error: err })
    return {
      def: { indices: [0,1,2,3], label: `#${id0}▸#${id1}, #${id2}▸#${id3}`, tokenIds: [id0,id1,id2,id3] },
      nodeA: dead(`Token #${id0}`), nodeB: dead(`Token #${id1}`),
      nodeC: dead(`Token #${id2}`), nodeD: dead(`Token #${id3}`),
      nodeL1a: dead(`#${id0}+#${id1}`), nodeL1b: dead(`#${id2}+#${id3}`),
      nodeAbcd: dead('Final Composite'),
    }
  }
}

export function useMyCheckPermutations(checks: Record<string, CheckStruct>) {
  const [permutations, setPermutations] = useState<PermutationResult[]>([])

  const generate = useCallback(() => {
    const groups = groupByChecksCount(checks)
    const results: PermutationResult[] = []

    for (const [, ids] of groups) {
      if (ids.length < 4) continue
      const remaining = MAX_PERMS - results.length
      if (remaining <= 0) break
      const tuples = sampleTuples(ids, remaining)
      for (const [id0, id1, id2, id3] of tuples) {
        results.push(buildPermutation(id0, id1, id2, id3, checks))
      }
    }

    setPermutations(results)
  }, [checks])

  const shuffle = useCallback(() => generate(), [generate])

  return { permutations, generate, shuffle }
}
