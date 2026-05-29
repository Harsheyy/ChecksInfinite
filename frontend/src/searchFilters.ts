// frontend/src/searchFilters.ts
import type { Attribute } from './utils'

export interface SearchFilters {
  checks: string[]
  colorBand: string[]
  gradient: string[]
  speed: string[]
  shift: string[]
}

export function emptySearchFilters(): SearchFilters {
  return { checks: [], colorBand: [], gradient: [], speed: [], shift: [] }
}

export function hasActiveSearchFilters(f: SearchFilters): boolean {
  return f.checks.length > 0
      || f.colorBand.length > 0
      || f.gradient.length > 0
      || f.speed.length > 0
      || f.shift.length > 0
}

export function countActiveSearchFilters(f: SearchFilters): number {
  let n = 0
  if (f.checks.length > 0) n++
  if (f.colorBand.length > 0) n++
  if (f.gradient.length > 0) n++
  if (f.speed.length > 0) n++
  if (f.shift.length > 0) n++
  return n
}

/** Returns true if attributes satisfy the multi-select filters (OR within trait, AND across traits). */
export function matchesSearchFilters(attributes: Attribute[], f: SearchFilters): boolean {
  function check(values: string[], traitType: string): boolean {
    if (values.length === 0) return true
    const attr = attributes.find(a => a.trait_type === traitType)
    if (!attr) return true // unrevealed composites lack some attributes — pass
    return values.includes(String(attr.value))
  }
  return (
    check(f.checks,    'Checks') &&
    check(f.colorBand, 'Color Band') &&
    check(f.gradient,  'Gradient') &&
    check(f.speed,     'Speed') &&
    check(f.shift,     'Shift')
  )
}

export const TRAIT_OPTIONS = {
  checks:    ['20', '10', '5', '4', '1'],
  colorBand: ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One'],
  gradient:  ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z'],
  speed:     ['0.5x', '1x', '2x'],
  shift:     ['IR', 'UV'],
} as const
