import { describe, it, expect, beforeEach } from 'vitest'
import { readCache, writeCache } from './permutationsCache'

// PermRow shape used in tests (minimal — only needs to roundtrip as JSON)
const fakeRow = {
  keeper_1_id: 1, burner_1_id: 2, keeper_2_id: 3, burner_2_id: 4,
  abcd_checks: 20, abcd_color_band: 'Eighty', abcd_gradient: 'None',
  abcd_speed: '1x', abcd_shift: null,
  keeper_1: { check_struct: { seed: '123', isRevealed: true, checksCount: 80, hasManyChecks: true, composite: 0, isRoot: false, colorBand: 0, gradient: 0, direction: 0, speed: 1, stored: { composites: [], colorBands: [], gradients: [], divisorIndex: 0, epoch: 0, seed: 0, day: 0 } } },
  burner_1: { check_struct: { seed: '456', isRevealed: true, checksCount: 80, hasManyChecks: true, composite: 0, isRoot: false, colorBand: 0, gradient: 0, direction: 0, speed: 1, stored: { composites: [], colorBands: [], gradients: [], divisorIndex: 0, epoch: 0, seed: 0, day: 0 } } },
  keeper_2: { check_struct: { seed: '789', isRevealed: true, checksCount: 80, hasManyChecks: true, composite: 0, isRoot: false, colorBand: 0, gradient: 0, direction: 0, speed: 1, stored: { composites: [], colorBands: [], gradients: [], divisorIndex: 0, epoch: 0, seed: 0, day: 0 } } },
  burner_2: { check_struct: { seed: '999', isRevealed: true, checksCount: 80, hasManyChecks: true, composite: 0, isRoot: false, colorBand: 0, gradient: 0, direction: 0, speed: 1, stored: { composites: [], colorBands: [], gradients: [], divisorIndex: 0, epoch: 0, seed: 0, day: 0 } } },
}

describe('permutationsCache', () => {
  beforeEach(() => sessionStorage.clear())

  it('readCache returns null when sessionStorage is empty', () => {
    expect(readCache()).toBeNull()
  })

  it('writeCache + readCache roundtrips rows', () => {
    writeCache([fakeRow] as any)
    const result = readCache()
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    expect(result![0].keeper_1_id).toBe(1)
    expect(result![0].keeper_1.check_struct.seed).toBe('123')
  })

  it('readCache returns null on corrupted data', () => {
    sessionStorage.setItem('checks-infinite-perms-v1', 'not-json{{{')
    expect(readCache()).toBeNull()
  })

  it('writeCache silently no-ops when sessionStorage throws', () => {
    const original = sessionStorage.setItem.bind(sessionStorage)
    sessionStorage.setItem = () => { throw new Error('QuotaExceeded') }
    expect(() => writeCache([fakeRow] as any)).not.toThrow()
    sessionStorage.setItem = original
  })
})
