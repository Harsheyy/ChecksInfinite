// frontend/src/components/FilterBar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FilterBar, emptyFilters, matchesFilters } from './FilterBar'
import type { Filters } from './FilterBar'
import type { Attribute } from '../utils'

describe('emptyFilters', () => {
  it('returns all empty strings / defaults', () => {
    const f = emptyFilters()
    expect(f.checks).toBe('')
    expect(f.colorBand).toBe('')
    expect(f.gradient).toBe('')
    expect(f.speed).toBe('')
    expect(f.shift).toBe('')
    expect(f.idInput).toBe('')
    expect(f.idMode).toBe('and')
    expect(f.minCost).toBeNull()
    expect(f.maxCost).toBeNull()
  })
})

describe('matchesFilters', () => {
  const attrs: Attribute[] = [
    { trait_type: 'Checks', value: '80' },
    { trait_type: 'Color Band', value: 'Eighty' },
    { trait_type: 'Gradient', value: 'None' },
    { trait_type: 'Speed', value: '1x' },
    { trait_type: 'Shift', value: 'UV' },
  ]

  it('passes when all filters empty', () => {
    expect(matchesFilters(attrs, emptyFilters())).toBe(true)
  })

  it('passes when filter matches attribute value', () => {
    expect(matchesFilters(attrs, { ...emptyFilters(), checks: '80' })).toBe(true)
  })

  it('fails when filter does not match', () => {
    expect(matchesFilters(attrs, { ...emptyFilters(), checks: '40' })).toBe(false)
  })

  it('passes when attribute is absent (unrevealed composite)', () => {
    expect(matchesFilters([], { ...emptyFilters(), checks: '80' })).toBe(true)
  })

  it('applies AND logic: fails if any active filter mismatches', () => {
    const f: Filters = { ...emptyFilters(), checks: '80', colorBand: 'Twenty' }
    expect(matchesFilters(attrs, f)).toBe(false)
  })
})

describe('matchesFilters — ID filter', () => {
  const attrs: Attribute[] = [{ trait_type: 'Checks', value: '1' }]

  it('passes when idInput is empty', () => {
    expect(matchesFilters(attrs, emptyFilters(), ['10', '20', '30', '40'])).toBe(true)
  })

  it('OR: passes when any token ID is in the entered set', () => {
    const f = { ...emptyFilters(), idInput: '10, 99' }
    expect(matchesFilters(attrs, f, ['10', '20', '30', '40'])).toBe(true)
  })

  it('OR: fails when no token ID is in the entered set', () => {
    const f = { ...emptyFilters(), idInput: '99, 88' }
    expect(matchesFilters(attrs, f, ['10', '20', '30', '40'])).toBe(false)
  })

  it('AND: passes when all 4 token IDs are in the entered set', () => {
    const f = { ...emptyFilters(), idInput: '10, 20, 30, 40, 50', idMode: 'and' as const }
    expect(matchesFilters(attrs, f, ['10', '20', '30', '40'])).toBe(true)
  })

  it('AND: fails when any token ID is not in the entered set', () => {
    const f = { ...emptyFilters(), idInput: '10, 20, 30, 50, 60', idMode: 'and' as const }
    expect(matchesFilters(attrs, f, ['10', '20', '30', '40'])).toBe(false)
  })

  it('uses OR when <=4 IDs regardless of idMode', () => {
    const f = { ...emptyFilters(), idInput: '10, 20, 30', idMode: 'and' as const }
    expect(matchesFilters(attrs, f, ['10', '99', '99', '99'])).toBe(true)
  })

  it('passes when no tokenIds provided (chain mode)', () => {
    const f = { ...emptyFilters(), idInput: '10, 20' }
    expect(matchesFilters(attrs, f, undefined)).toBe(true)
  })
})

describe('FilterBar', () => {
  it('renders 5 select dropdowns', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={24} />)
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(5)
  })

  it('shows Showing X count', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={18} />)
    expect(screen.getByText(/Showing 18/)).toBeInTheDocument()
  })

  it('calls onChange when a select changes', () => {
    const onChange = vi.fn()
    render(<FilterBar filters={emptyFilters()} onChange={onChange} visible={24} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: '20' } })
    expect(onChange).toHaveBeenCalledWith({ ...emptyFilters(), checks: '20' })
  })

  it('shows Clear button when any filter is active', () => {
    render(<FilterBar filters={{ ...emptyFilters(), checks: '80' }} onChange={vi.fn()} visible={10} />)
    expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument()
  })

  it('hides Clear button when no filters active', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={24} />)
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull()
  })

  it('calls onChange with emptyFilters when Clear is clicked', () => {
    const onChange = vi.fn()
    render(
      <FilterBar
        filters={{ ...emptyFilters(), checks: '80' }}
        onChange={onChange}
        visible={10}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    expect(onChange).toHaveBeenCalledWith(emptyFilters())
  })

  it('Checks dropdown has options 20, 10, 5, 4, 1 in that order (no 40 or 80)', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={24} />)
    const selects = screen.getAllByRole('combobox')
    const checksSelect = selects[0]
    const options = Array.from(checksSelect.querySelectorAll('option'))
      .map(o => o.value)
      .filter(v => v !== '')
    expect(options).toEqual(['20', '10', '5', '4', '1'])
  })
})
