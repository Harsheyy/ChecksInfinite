import { describe, it, expect } from 'vitest'
import { random, randomSalted, avg, minGt0, min, max } from './checksArtJS'
import { DIVISORS, EIGHTY_COLORS } from './checksArtJS'
import { colorBandIndex, gradientIndex, colorIndexes } from './checksArtJS'
import { compositeGenesJS, simulateCompositeJS, generateSVGJS } from './checksArtJS'
import type { CheckStruct } from './checksArtJS'

function makeCheck(seed: bigint, divisorIndex: number, colorBands: number[], gradients: number[]): CheckStruct {
  return {
    stored: {
      composites: [0,0,0,0,0,0],
      colorBands,
      gradients,
      divisorIndex,
      epoch: 1,
      seed: 1,
      day: 1,
    },
    isRevealed: true,
    seed,
    checksCount: 80,
    hasManyChecks: true,
    composite: 0,
    isRoot: divisorIndex === 0,
    colorBand: 0,
    gradient: 0,
    direction: 0,
    speed: 2,
  }
}

describe('random', () => {
  it('returns a value in [0, max)', () => {
    const r = random(12345n, 80n)
    expect(r).toBeGreaterThanOrEqual(0n)
    expect(r).toBeLessThan(80n)
  })
  it('is deterministic', () => {
    expect(random(999n, 100n)).toBe(random(999n, 100n))
  })
})

describe('randomSalted', () => {
  it('returns a value in [0, max)', () => {
    const r = randomSalted(42n, 'band', 120n)
    expect(r).toBeGreaterThanOrEqual(0n)
    expect(r).toBeLessThan(120n)
  })
  it('differs from random with same seed', () => {
    expect(randomSalted(42n, 'band', 120n)).not.toBe(random(42n, 120n))
  })
})

describe('math helpers', () => {
  it('avg rounds toward lower', () => {
    expect(avg(3, 4)).toBe(3)
    expect(avg(4, 4)).toBe(4)
  })
  it('min returns smaller', () => expect(min(3, 7)).toBe(3))
  it('max returns larger', () => expect(max(3, 7)).toBe(7))
  it('minGt0 returns smallest non-zero', () => {
    expect(minGt0(0, 3)).toBe(3)
    expect(minGt0(2, 3)).toBe(2)
    expect(minGt0(0, 0)).toBe(0)
  })
  it('avg at boundary values', () => {
    expect(avg(255, 255)).toBe(255)
    expect(avg(0, 1)).toBe(0)
  })
  it('minGt0 with nonzero left and zero right', () => {
    expect(minGt0(3, 0)).toBe(3)
  })
})

describe('constants', () => {
  it('EIGHTY_COLORS has exactly 80 entries', () => {
    expect(EIGHTY_COLORS).toHaveLength(80)
  })
  it('DIVISORS has 8 entries', () => {
    expect(DIVISORS).toHaveLength(8)
  })
})

describe('colorBandIndex', () => {
  it('returns 6 for divisorIndex >= 6', () => {
    const c = makeCheck(42n, 6, [0,0,0,0,0], [0,0,0,0,0])
    expect(colorBandIndex(c, 6)).toBe(6)
  })
  it('reads from stored.colorBands for divisorIndex 1-5', () => {
    const c = makeCheck(42n, 2, [3,2,1,0,0], [0,0,0,0,0])
    expect(colorBandIndex(c, 2)).toBe(2) // stored.colorBands[1]
  })
  it('computes from seed for divisorIndex 0', () => {
    const c = makeCheck(42n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const result = colorBandIndex(c, 0)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(6)
  })
})

describe('gradientIndex', () => {
  it('returns 0 for divisorIndex >= 6', () => {
    const c = makeCheck(42n, 6, [0,0,0,0,0], [0,0,0,0,0])
    expect(gradientIndex(c, 6)).toBe(0)
  })
  it('reads from stored.gradients for divisorIndex 1-5', () => {
    const c = makeCheck(42n, 2, [0,0,0,0,0], [3,2,1,0,0])
    expect(gradientIndex(c, 2)).toBe(2) // stored.gradients[1]
  })
  it('computes a value in [0,6] from seed for divisorIndex 0', () => {
    const c = makeCheck(42n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const result = gradientIndex(c, 0)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(6)
  })
})

describe('colorIndexes', () => {
  it('returns an array of length DIVISORS[0]=80 for a root check', () => {
    const c = makeCheck(999n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const map = new Map<number, CheckStruct>()
    const result = colorIndexes(0, c, map)
    expect(result).toHaveLength(80)
    result.forEach(i => {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(80)
    })
  })

  it('returns empty array for divisorIndex 7 (black check, DIVISORS[7]=0)', () => {
    const c = makeCheck(1n, 7, [0,0,0,0,0], [0,0,0,0,0])
    const map = new Map<number, CheckStruct>()
    const result = colorIndexes(7, c, map)
    expect(result).toHaveLength(0)
  })

  it('resolves from parent and composite for divisorIndex 1', () => {
    // A (divisorIndex=0 root) was composited with B (divisorIndex=0 root) → AB at divisorIndex=1
    const b = makeCheck(200n, 0, [0,0,0,0,0], [0,0,0,0,0])

    // AB check: divisorIndex=1, composite=999 (points to B in map)
    const ab: CheckStruct = {
      stored: {
        composites: [999, 0, 0, 0, 0, 0],
        colorBands: [3, 0, 0, 0, 0],
        gradients: [0, 0, 0, 0, 0],
        divisorIndex: 1,
        epoch: 1, seed: 1, day: 1,
      },
      isRevealed: true,
      seed: 100n, // same seed as A
      checksCount: 40,
      hasManyChecks: true,
      composite: 999, // points to B in virtualMap
      isRoot: false,
      colorBand: 3,
      gradient: 0,
      direction: 0,
      speed: 2,
    }

    const map = new Map<number, CheckStruct>([[999, b]])
    const result = colorIndexes(1, ab, map)
    expect(result).toHaveLength(40) // DIVISORS[1] = 40
    result.forEach(i => {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(80)
    })
  })

  it('throws if virtual map is missing the composite key', () => {
    const ab: CheckStruct = {
      stored: {
        composites: [999, 0, 0, 0, 0, 0],
        colorBands: [3, 0, 0, 0, 0],
        gradients: [0, 0, 0, 0, 0],
        divisorIndex: 1,
        epoch: 1, seed: 1, day: 1,
      },
      isRevealed: true,
      seed: 100n,
      checksCount: 40,
      hasManyChecks: true,
      composite: 999,
      isRoot: false,
      colorBand: 3,
      gradient: 0,
      direction: 0,
      speed: 2,
    }
    const emptyMap = new Map<number, CheckStruct>()
    expect(() => colorIndexes(1, ab, emptyMap)).toThrow('Virtual map missing key: 999')
  })

  it('is deterministic for the same seed', () => {
    const c = makeCheck(12345n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const map = new Map<number, CheckStruct>()
    const result1 = colorIndexes(0, c, map)
    const result2 = colorIndexes(0, c, map)
    expect(result1).toEqual(result2)
    expect(result1[0]).toBe(result2[0]) // spot-check determinism of index 0
  })
})

describe('compositeGenesJS', () => {
  it('returns gradient and colorBand in valid ranges', () => {
    const keeper = makeCheck(100n, 0, [0,0,0,0,0], [0,0,0,0,0])
    keeper.gradient = 2; keeper.colorBand = 3
    const burner = makeCheck(200n, 0, [0,0,0,0,0], [0,0,0,0,0])
    burner.gradient = 1; burner.colorBand = 4
    const { gradient, colorBand } = compositeGenesJS(keeper, burner)
    expect(gradient).toBeGreaterThanOrEqual(0)
    expect(gradient).toBeLessThanOrEqual(6)
    expect(colorBand).toBeGreaterThanOrEqual(0)
    expect(colorBand).toBeLessThanOrEqual(6)
  })
  it('is deterministic', () => {
    const keeper = makeCheck(100n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const burner = makeCheck(200n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const r1 = compositeGenesJS(keeper, burner)
    const r2 = compositeGenesJS(keeper, burner)
    expect(r1.gradient).toBe(r2.gradient)
    expect(r1.colorBand).toBe(r2.colorBand)
  })
})

describe('simulateCompositeJS', () => {
  it('returns a CheckStruct with divisorIndex + 1', () => {
    const keeper = makeCheck(100n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const burner = makeCheck(200n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const result = simulateCompositeJS(keeper, burner, 65535)
    expect(result.stored.divisorIndex).toBe(1)
    expect(result.stored.composites[0]).toBe(65535)
  })
  it('sets colorBand and gradient on result', () => {
    const keeper = makeCheck(100n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const burner = makeCheck(200n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const result = simulateCompositeJS(keeper, burner, 65535)
    expect(result.colorBand).toBeGreaterThanOrEqual(0)
    expect(result.colorBand).toBeLessThanOrEqual(6)
    expect(result.gradient).toBeGreaterThanOrEqual(0)
    expect(result.gradient).toBeLessThanOrEqual(6)
  })
})

describe('generateSVGJS', () => {
  it('returns a non-empty SVG string for a root check', () => {
    const c = makeCheck(999n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const map = new Map<number, CheckStruct>()
    const svg = generateSVGJS(c, map)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg.length).toBeGreaterThan(100)
  })
  it('returns an SVG for a black check (divisorIndex 7)', () => {
    const c = makeCheck(1n, 7, [0,0,0,0,0], [0,0,0,0,0])
    c.stored = { ...c.stored, divisorIndex: 7 }
    const map = new Map<number, CheckStruct>()
    const svg = generateSVGJS(c, map)
    expect(svg).toContain('<svg')
  })
})
