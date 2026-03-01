// frontend/src/useMyChecks.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readMyChecksCache, writeMyChecksCache, CACHE_TTL } from './useMyChecks'
import type { SerializedCheckStruct } from './useMyChecks'

const ADDR = '0xabc'
const mockCheck: SerializedCheckStruct = {
  stored: { composites: [], colorBands: [], gradients: [], divisorIndex: 0, epoch: 0, seed: 0, day: 1 },
  isRevealed: true, seed: '12345', checksCount: 80, hasManyChecks: true,
  composite: 0, isRoot: true, colorBand: 0, gradient: 0, direction: 0, speed: 2,
}

describe('useMyChecks cache', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('returns null when cache is empty', () => {
    expect(readMyChecksCache(ADDR)).toBeNull()
  })

  it('returns cached data when fresh', () => {
    writeMyChecksCache(ADDR, { tokenIds: ['1', '2'], checks: { '1': mockCheck }, cachedAt: Date.now() })
    const result = readMyChecksCache(ADDR)
    expect(result).not.toBeNull()
    expect(result!.tokenIds).toEqual(['1', '2'])
  })

  it('returns null when cache is expired', () => {
    writeMyChecksCache(ADDR, {
      tokenIds: ['1'], checks: {},
      cachedAt: Date.now() - CACHE_TTL - 1000,
    })
    expect(readMyChecksCache(ADDR)).toBeNull()
  })

  it('normalises address to lowercase for cache key', () => {
    writeMyChecksCache('0xABC', { tokenIds: ['3'], checks: {}, cachedAt: Date.now() })
    const result = readMyChecksCache('0xabc')
    expect(result!.tokenIds).toEqual(['3'])
  })
})
