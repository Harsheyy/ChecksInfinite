// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  parseTokenURI,
  mapCheckAttributes,
  formatSpeed,
  formatShift,
  colorBandName,
  gradientName,
} from './utils'

describe('parseTokenURI', () => {
  it('decodes a base64 data URI and returns name, image SVG, and attributes', () => {
    const fakePayload = {
      name: 'Checks 42',
      description: 'desc',
      image: 'data:image/svg+xml;base64,' + btoa('<svg>test</svg>'),
      animation_url: 'data:text/html;base64,' + btoa('<html/>'),
      attributes: [
        { trait_type: 'Checks', value: '80' },
        { trait_type: 'Color Band', value: 'Sixty' },
      ],
    }
    const encoded =
      'data:application/json;base64,' + btoa(JSON.stringify(fakePayload))

    const result = parseTokenURI(encoded)
    expect(result.name).toBe('Checks 42')
    expect(result.svg).toBe('<svg>test</svg>')
    expect(result.attributes).toEqual([
      { trait_type: 'Checks', value: '80' },
      { trait_type: 'Color Band', value: 'Sixty' },
    ])
  })
})

describe('colorBandName', () => {
  it('maps index 0 to Eighty', () => expect(colorBandName(0)).toBe('Eighty'))
  it('maps index 1 to Sixty',  () => expect(colorBandName(1)).toBe('Sixty'))
  it('maps index 6 to One',    () => expect(colorBandName(6)).toBe('One'))
})

describe('gradientName', () => {
  it('maps index 0 to None',   () => expect(gradientName(0)).toBe('None'))
  it('maps index 1 to Linear', () => expect(gradientName(1)).toBe('Linear'))
  it('maps index 6 to Linear Z', () => expect(gradientName(6)).toBe('Linear Z'))
})

describe('formatSpeed', () => {
  it('returns 2x for speed 4', () => expect(formatSpeed(4)).toBe('2x'))
  it('returns 1x for speed 2', () => expect(formatSpeed(2)).toBe('1x'))
  it('returns 0.5x for speed 1', () => expect(formatSpeed(1)).toBe('0.5x'))
})

describe('formatShift', () => {
  it('returns IR for direction 0', () => expect(formatShift(0)).toBe('IR'))
  it('returns UV for direction 1', () => expect(formatShift(1)).toBe('UV'))
})

describe('mapCheckAttributes', () => {
  it('maps a Check struct to display attributes', () => {
    const mockCheck = {
      stored: {
        composites: [0, 0, 0, 0, 0, 0],
        colorBands: [0, 0, 0, 0, 0],
        gradients: [0, 0, 0, 0, 0],
        divisorIndex: 1,
        epoch: 1,
        seed: 42,
        day: 5,
      },
      isRevealed: true,
      seed: BigInt(12345),
      checksCount: 40,
      hasManyChecks: true,
      composite: 0,
      isRoot: false,
      colorBand: 2,
      gradient: 1,
      direction: 0,
      speed: 2,
    }

    const attrs = mapCheckAttributes(mockCheck)
    expect(attrs).toContainEqual({ trait_type: 'Checks', value: '40' })
    expect(attrs).toContainEqual({ trait_type: 'Color Band', value: 'Forty' })
    expect(attrs).toContainEqual({ trait_type: 'Gradient', value: 'Linear' })
    expect(attrs).toContainEqual({ trait_type: 'Speed', value: '1x' })
    expect(attrs).toContainEqual({ trait_type: 'Shift', value: 'IR' })
  })

  it('omits Color Band, Gradient, Speed, Shift when isRevealed is false', () => {
    const mockCheck = {
      stored: {
        composites: [0, 0, 0, 0, 0, 0],
        colorBands: [0, 0, 0, 0, 0],
        gradients: [0, 0, 0, 0, 0],
        divisorIndex: 1,
        epoch: 1,
        seed: 42,
        day: 5,
      },
      isRevealed: false,
      seed: BigInt(12345),
      checksCount: 40,
      hasManyChecks: true,
      composite: 0,
      isRoot: false,
      colorBand: 2,
      gradient: 1,
      direction: 0,
      speed: 2,
    }

    const attrs = mapCheckAttributes(mockCheck)
    const types = attrs.map((a) => a.trait_type)
    expect(types).not.toContain('Color Band')
    expect(types).not.toContain('Gradient')
    expect(types).not.toContain('Speed')
    expect(types).not.toContain('Shift')
    expect(attrs).toContainEqual({ trait_type: 'Checks', value: '40' })
    expect(attrs).toContainEqual({ trait_type: 'Day', value: '5' })
  })

  it('omits Color Band and Gradient when hasManyChecks is false, but shows Speed and Shift', () => {
    const mockCheck = {
      stored: {
        composites: [0, 0, 0, 0, 0, 0],
        colorBands: [0, 0, 0, 0, 0],
        gradients: [0, 0, 0, 0, 0],
        divisorIndex: 6,
        epoch: 1,
        seed: 99,
        day: 10,
      },
      isRevealed: true,
      seed: BigInt(99999),
      checksCount: 1,
      hasManyChecks: false,
      composite: 0,
      isRoot: false,
      colorBand: 6,
      gradient: 0,
      direction: 1,
      speed: 4,
    }

    const attrs = mapCheckAttributes(mockCheck)
    const types = attrs.map((a) => a.trait_type)
    expect(types).not.toContain('Color Band')
    expect(types).not.toContain('Gradient')
    expect(attrs).toContainEqual({ trait_type: 'Speed', value: '2x' })
    expect(attrs).toContainEqual({ trait_type: 'Shift', value: 'UV' })
    expect(attrs).toContainEqual({ trait_type: 'Checks', value: '1' })
  })
})
