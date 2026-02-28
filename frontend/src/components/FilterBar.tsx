// frontend/src/components/FilterBar.tsx
import type { Attribute } from '../utils'

export interface Filters {
  checks: string
  colorBand: string
  gradient: string
  speed: string
  shift: string
}

export function emptyFilters(): Filters {
  return { checks: '', colorBand: '', gradient: '', speed: '', shift: '' }
}

const CHECKS_OPTIONS    = ['1', '5', '10', '20', '40', '80']
const COLOR_BAND_OPTIONS = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One']
const GRADIENT_OPTIONS  = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z']
const SPEED_OPTIONS     = ['0.5x', '1x', '2x']
const SHIFT_OPTIONS     = ['IR', 'UV']

interface FilterSelectProps {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}

function FilterSelect({ label, options, value, onChange }: FilterSelectProps) {
  return (
    <label className="filter-select-label">
      <span className="filter-select-name">{label}</span>
      <select
        className="filter-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  )
}

interface FilterBarProps {
  filters: Filters
  onChange: (f: Filters) => void
  total: number
  visible: number
  onShuffle?: () => void
}

export function FilterBar({ filters, onChange, total, visible, onShuffle }: FilterBarProps) {
  function update(key: keyof Filters, val: string) {
    onChange({ ...filters, [key]: val })
  }

  function clearAll() { onChange(emptyFilters()) }

  const isActive = Object.values(filters).some(v => v !== '')

  return (
    <div className="filter-strip">
      <FilterSelect label="Checks"     options={CHECKS_OPTIONS}     value={filters.checks}    onChange={v => update('checks', v)} />
      <FilterSelect label="Color Band" options={COLOR_BAND_OPTIONS} value={filters.colorBand} onChange={v => update('colorBand', v)} />
      <FilterSelect label="Gradient"   options={GRADIENT_OPTIONS}   value={filters.gradient}  onChange={v => update('gradient', v)} />
      <FilterSelect label="Speed"      options={SPEED_OPTIONS}      value={filters.speed}     onChange={v => update('speed', v)} />
      <FilterSelect label="Shift"      options={SHIFT_OPTIONS}      value={filters.shift}     onChange={v => update('shift', v)} />
      <span className="filter-count">Showing {visible} / {total}</span>
      {isActive && (
        <button type="button" className="filter-clear" onClick={clearAll}>Clear</button>
      )}
      {onShuffle && (
        <button type="button" className="filter-shuffle" onClick={onShuffle}>↻ Shuffle</button>
      )}
    </div>
  )
}

/** Returns true if the attributes satisfy all active filters (AND logic; '' = pass all). */
export function matchesFilters(attributes: Attribute[], filters: Filters): boolean {
  function check(key: keyof Filters, traitType: string): boolean {
    if (!filters[key]) return true
    const attr = attributes.find(a => a.trait_type === traitType)
    if (!attr) return true  // unrevealed composites lack some attributes — pass all filters
    return filters[key] === attr.value
  }
  return (
    check('checks', 'Checks') &&
    check('colorBand', 'Color Band') &&
    check('gradient', 'Gradient') &&
    check('speed', 'Speed') &&
    check('shift', 'Shift')
  )
}
