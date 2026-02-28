import { describe, it, expect } from 'vitest'
import { parseIds, validateIds } from './utils'

describe('parseIds', () => {
  it('splits comma-separated IDs', () => {
    expect(parseIds('1234, 5678, 9012, 3456')).toEqual(['1234', '5678', '9012', '3456'])
  })
  it('trims whitespace around each ID', () => {
    expect(parseIds('  1 , 2 , 3 , 4  ')).toEqual(['1', '2', '3', '4'])
  })
  it('filters out empty segments', () => {
    expect(parseIds('1,,2,,3,4')).toEqual(['1', '2', '3', '4'])
  })
  it('returns empty array for blank input', () => {
    expect(parseIds('')).toEqual([])
  })
})

describe('validateIds', () => {
  it('returns error when key is missing', () => {
    expect(validateIds(['1', '2', '3', '4'], false)).toContain('VITE_ALCHEMY_API_KEY')
  })
  it('returns error when fewer than 4 IDs', () => {
    expect(validateIds(['1', '2', '3'], true)).toContain('at least 4')
  })
  it('returns error for non-numeric ID', () => {
    expect(validateIds(['1', '2', '3', 'abc'], true)).toContain('"abc"')
  })
  it('returns error for duplicate IDs', () => {
    expect(validateIds(['1', '2', '3', '1'], true)).toContain('unique')
  })
  it('returns empty string for valid input', () => {
    expect(validateIds(['1', '2', '3', '4'], true)).toBe('')
  })
  it('accepts more than 4 IDs', () => {
    expect(validateIds(['1', '2', '3', '4', '5'], true)).toBe('')
  })
})
