// frontend/src/useMyCheckPermutations.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { groupByChecksCount, sampleTuples } from './useMyCheckPermutations'
import type { CheckStruct } from './utils'

function fakeCheck(checksCount: number, seed = 1n): CheckStruct {
  return {
    stored: { composites: Array(7).fill(0), colorBands: Array(6).fill(0), gradients: Array(6).fill(0), divisorIndex: 0, epoch: 0, seed: 0, day: 0 },
    isRevealed: true, seed, checksCount, hasManyChecks: checksCount > 1,
    composite: 0, isRoot: true, colorBand: 0, gradient: 0, direction: 0, speed: 2,
  }
}

describe('groupByChecksCount', () => {
  it('groups tokens by their checksCount', () => {
    const checks: Record<string, CheckStruct> = {
      '1': fakeCheck(80), '2': fakeCheck(80), '3': fakeCheck(40), '4': fakeCheck(80),
    }
    const groups = groupByChecksCount(checks)
    expect(groups.get(80)).toEqual(expect.arrayContaining(['1', '2', '4']))
    expect(groups.get(40)).toEqual(['3'])
  })

  it('returns empty map for empty input', () => {
    expect(groupByChecksCount({}).size).toBe(0)
  })
})

describe('sampleTuples', () => {
  it('returns all permutations when group has exactly 4 tokens', () => {
    const ids = ['a', 'b', 'c', 'd']
    const tuples = sampleTuples(ids, 100)
    expect(tuples.length).toBe(24)  // P(4,4) = 24
    for (const t of tuples) expect(new Set(t).size).toBe(4)
  })

  it('returns up to `max` tuples', () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i))
    const tuples = sampleTuples(ids, 50)
    expect(tuples.length).toBeLessThanOrEqual(50)
  })

  it('each tuple has 4 distinct elements', () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(i))
    for (const t of sampleTuples(ids, 200)) {
      expect(new Set(t).size).toBe(4)
    }
  })
})
