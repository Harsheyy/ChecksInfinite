// frontend/src/components/FilterBar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FilterBar, emptyFilters, matchesFilters } from './FilterBar'
import type { Filters } from './FilterBar'
import type { Attribute } from '../utils'
import type { PermutationResult } from '../useAllPermutations'

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

  it('uses OR when <4 IDs regardless of idMode', () => {
    const f = { ...emptyFilters(), idInput: '10, 20, 30', idMode: 'and' as const }
    expect(matchesFilters(attrs, f, ['10', '99', '99', '99'])).toBe(true)
  })

  it('AND mode activates at exactly 4 IDs', () => {
    const attrs: Attribute[] = [{ trait_type: 'Checks', value: '1' }]
    // 4 IDs entered with AND mode — all 4 positions must be in the set
    const f = { ...emptyFilters(), idInput: '10, 20, 30, 40', idMode: 'and' as const }
    expect(matchesFilters(attrs, f, ['10', '20', '30', '40'])).toBe(true)
    expect(matchesFilters(attrs, f, ['10', '20', '30', '99'])).toBe(false)
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
    expect(screen.getAllByText(/Showing 18/).length).toBeGreaterThanOrEqual(1)
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
    expect(screen.getAllByRole('button', { name: /Clear/ }).length).toBeGreaterThanOrEqual(1)
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
    fireEvent.click(screen.getAllByRole('button', { name: /Clear/ })[0])
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

  it('renders Check IDs input field', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={24} />)
    expect(screen.getByPlaceholderText(/e\.g\. 123, 456/)).toBeInTheDocument()
  })

  it('does not show AND/OR toggle for <4 IDs', () => {
    const f = { ...emptyFilters(), idInput: '1, 2, 3' }
    render(<FilterBar filters={f} onChange={vi.fn()} visible={24} />)
    expect(screen.queryByRole('button', { name: /AND/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /OR/ })).toBeNull()
  })

  it('shows AND/OR toggle when >=4 IDs entered', () => {
    const f = { ...emptyFilters(), idInput: '1, 2, 3, 4' }
    render(<FilterBar filters={f} onChange={vi.fn()} visible={24} />)
    expect(screen.getByRole('button', { name: /AND/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /OR/ })).toBeInTheDocument()
  })

  it('AND/OR toggle switches idMode', () => {
    const onChange = vi.fn()
    const f = { ...emptyFilters(), idInput: '1, 2, 3, 4', idMode: 'and' as const }
    render(<FilterBar filters={f} onChange={onChange} visible={24} />)
    fireEvent.click(screen.getByRole('button', { name: /OR/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ idMode: 'or' }))
  })

  it('does not render price slider when priceRange is not provided', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={24} />)
    expect(screen.queryByLabelText(/min cost/i)).toBeNull()
    expect(screen.queryByLabelText(/max cost/i)).toBeNull()
  })

  it('renders price slider when priceRange is provided', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={24} priceRange={{ min: 0.1, max: 1.0 }} />)
    const sliders = screen.getAllByRole('slider')
    expect(sliders.length).toBeGreaterThanOrEqual(2)
  })

  it('price slider onChange updates minCost', () => {
    const onChange = vi.fn()
    render(<FilterBar filters={emptyFilters()} onChange={onChange} visible={24} priceRange={{ min: 0.1, max: 1.0 }} />)
    const sliders = screen.getAllByRole('slider')
    fireEvent.change(sliders[0], { target: { value: '0.3' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minCost: 0.3 }))
  })

  function makePermutation(
    colorBand: string,
    checks: string,
    tokenIds: [string, string, string, string] = ['1','2','3','4'],
  ): PermutationResult {
    return {
      def: { indices: [0,1,2,3], label: 'test', tokenIds },
      nodeA: { name:'', svg:'', attributes:[], loading:false, error:'' },
      nodeB: { name:'', svg:'', attributes:[], loading:false, error:'' },
      nodeC: { name:'', svg:'', attributes:[], loading:false, error:'' },
      nodeD: { name:'', svg:'', attributes:[], loading:false, error:'' },
      nodeL1a: { name:'', svg:'', attributes:[], loading:false, error:'' },
      nodeL1b: { name:'', svg:'', attributes:[], loading:false, error:'' },
      nodeAbcd: {
        name: 'Final Composite',
        svg: '',
        attributes: [
          { trait_type: 'Color Band', value: colorBand },
          { trait_type: 'Checks', value: checks },
        ],
        loading: false,
        error: '',
      },
    }
  }

  it('shows count next to Color Band option when permutations provided', () => {
    const perms = [
      makePermutation('Eighty', '20'),
      makePermutation('Eighty', '20'),
      makePermutation('Sixty', '10'),
    ]
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={3} permutations={perms} />)
    const selects = screen.getAllByRole('combobox')
    const colorBandSelect = selects[1]  // index 1 = Color Band
    const options = Array.from(colorBandSelect.querySelectorAll('option')).map(o => o.textContent)
    expect(options).toContain('Eighty (2)')
    expect(options).toContain('Sixty (1)')
  })

  it('hides zero-count options when permutations provided', () => {
    const perms = [makePermutation('Eighty', '20')]
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={1} permutations={perms} />)
    const selects = screen.getAllByRole('combobox')
    const colorBandSelect = selects[1]
    const options = Array.from(colorBandSelect.querySelectorAll('option')).map(o => o.textContent)
    expect(options.some(t => t?.startsWith('Sixty'))).toBe(false)
  })

  it('shows all options when no permutations provided', () => {
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={0} />)
    const selects = screen.getAllByRole('combobox')
    const colorBandSelect = selects[1]
    const options = Array.from(colorBandSelect.querySelectorAll('option')).map(o => o.value).filter(v => v !== '')
    expect(options).toEqual(['Eighty','Sixty','Forty','Twenty','Ten','Five','One'])
  })

  it('mobile panel shows counts and hides zero-count options', () => {
    const perms = [
      makePermutation('Eighty', '20'),
      makePermutation('Eighty', '20'),
    ]
    render(<FilterBar filters={emptyFilters()} onChange={vi.fn()} visible={2} permutations={perms} />)
    // Open mobile panel
    fireEvent.click(screen.getByText('Filters'))
    // After panel opens, there are 10 comboboxes total: 5 desktop + 5 panel
    // Color Band is index 1 desktop, index 6 panel (5 + 1)
    const selects = screen.getAllByRole('combobox')
    const panelColorBandSelect = selects[6]
    const options = Array.from(panelColorBandSelect.querySelectorAll('option')).map(o => o.textContent)
    expect(options).toContain('Eighty (2)')
    expect(options.some(t => t?.startsWith('Sixty'))).toBe(false)
  })
})
