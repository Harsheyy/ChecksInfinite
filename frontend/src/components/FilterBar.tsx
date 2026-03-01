// frontend/src/components/FilterBar.tsx
import { useState, useEffect } from 'react'
import type { Attribute } from '../utils'

export interface Filters {
  checks: string
  colorBand: string
  gradient: string
  speed: string
  shift: string
  idInput: string
  idMode: 'and' | 'or'
  minCost: number | null
  maxCost: number | null
}

export function emptyFilters(): Filters {
  return {
    checks: '', colorBand: '', gradient: '', speed: '', shift: '',
    idInput: '', idMode: 'and',
    minCost: null, maxCost: null,
  }
}

export function hasActiveFilters(f: Filters): boolean {
  return !!(
    f.checks || f.colorBand || f.gradient || f.speed || f.shift ||
    f.idInput.trim() || f.minCost !== null || f.maxCost !== null
  )
}

const CHECKS_OPTIONS    = ['20', '10', '5', '4', '1']
const COLOR_BAND_OPTIONS = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One']
const GRADIENT_OPTIONS  = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z']
const SPEED_OPTIONS     = ['0.5x', '1x', '2x']
const SHIFT_OPTIONS     = ['IR', 'UV']

function parseIdCount(input: string): number {
  return input.split(',').map(s => s.trim()).filter(Boolean).length
}

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
  visible: number
  onShuffle?: () => void
  priceRange?: { min: number; max: number }
}

const SHUFFLE_COOLDOWN = 60  // seconds

export function FilterBar({ filters, onChange, visible, onShuffle, priceRange }: FilterBarProps) {
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown(s => s - 1), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  function update(key: keyof Filters, val: string) {
    onChange({ ...filters, [key]: val })
  }

  function clearAll() { onChange(emptyFilters()) }

  function handleShuffle() {
    if (!onShuffle || cooldown > 0) return
    onShuffle()
    setCooldown(SHUFFLE_COOLDOWN)
  }

  const isActive = hasActiveFilters(filters)

  return (
    <div className={`filter-strip${priceRange ? ' filter-strip--two-row' : ''}`}>
      <div className="filter-row">
        <FilterSelect label="Checks"     options={CHECKS_OPTIONS}     value={filters.checks}    onChange={v => update('checks', v)} />
        <FilterSelect label="Color Band" options={COLOR_BAND_OPTIONS} value={filters.colorBand} onChange={v => update('colorBand', v)} />
        <FilterSelect label="Gradient"   options={GRADIENT_OPTIONS}   value={filters.gradient}  onChange={v => update('gradient', v)} />
        <FilterSelect label="Speed"      options={SPEED_OPTIONS}      value={filters.speed}     onChange={v => update('speed', v)} />
        <FilterSelect label="Shift"      options={SHIFT_OPTIONS}      value={filters.shift}     onChange={v => update('shift', v)} />

        {/* ID input */}
        <label className="filter-select-label">
          <span className="filter-select-name">IDs</span>
          <input
            className="filter-id-input"
            type="text"
            placeholder="e.g. 123, 456"
            value={filters.idInput}
            onChange={e => update('idInput', e.target.value)}
          />
        </label>

        {/* AND/OR toggle — appears when >=4 IDs */}
        {parseIdCount(filters.idInput) >= 4 && (
          <div className="filter-mode-toggle">
            <button
              type="button"
              className={`filter-mode-btn${filters.idMode === 'and' ? ' filter-mode-btn--active' : ''}`}
              onClick={() => update('idMode', 'and')}
              aria-label="AND"
            >AND</button>
            <button
              type="button"
              className={`filter-mode-btn${filters.idMode === 'or' ? ' filter-mode-btn--active' : ''}`}
              onClick={() => update('idMode', 'or')}
              aria-label="OR"
            >OR</button>
          </div>
        )}

        <span className="filter-count">
          Showing {visible}
        </span>
        {isActive && (
          <button type="button" className="filter-clear" onClick={clearAll}>Clear</button>
        )}
        {onShuffle && (
          <button
            type="button"
            className="filter-shuffle"
            onClick={handleShuffle}
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? `↻ ${cooldown}s` : '↻ Shuffle'}
          </button>
        )}
      </div>
      {priceRange && (() => {
        const currentMin = filters.minCost ?? priceRange.min
        const currentMax = filters.maxCost ?? priceRange.max
        return (
          <div className="filter-row filter-row--price">
            <span className="filter-select-name">Cost</span>
            <span className="filter-price-val">{currentMin.toFixed(3)}</span>
            <div className="filter-price-track">
              <input
                type="range"
                aria-label="min cost"
                className="filter-price-range filter-price-range--min"
                min={priceRange.min}
                max={priceRange.max}
                step={(priceRange.max - priceRange.min) / 200}
                value={currentMin}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  onChange({ ...filters, minCost: v <= priceRange.min ? null : v })
                }}
              />
              <input
                type="range"
                aria-label="max cost"
                className="filter-price-range filter-price-range--max"
                min={priceRange.min}
                max={priceRange.max}
                step={(priceRange.max - priceRange.min) / 200}
                value={currentMax}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  onChange({ ...filters, maxCost: v >= priceRange.max ? null : v })
                }}
              />
            </div>
            <span className="filter-price-val">{currentMax.toFixed(3)} ETH</span>
          </div>
        )
      })()}
    </div>
  )
}

/** Returns true if the attributes satisfy all active filters (AND logic; '' = pass all). */
export function matchesFilters(
  attributes: Attribute[],
  filters: Filters,
  tokenIds?: string[],
): boolean {
  function check(key: keyof Pick<Filters, 'checks' | 'colorBand' | 'gradient' | 'speed' | 'shift'>, traitType: string): boolean {
    if (!filters[key]) return true
    const attr = attributes.find(a => a.trait_type === traitType)
    if (!attr) return true  // unrevealed composites lack some attributes — pass all filters
    return filters[key] === attr.value
  }

  const attrMatch =
    check('checks', 'Checks') &&
    check('colorBand', 'Color Band') &&
    check('gradient', 'Gradient') &&
    check('speed', 'Speed') &&
    check('shift', 'Shift')

  if (!attrMatch) return false

  // ID filter: only applied when we have token IDs to check
  const trimmed = filters.idInput.trim()
  if (trimmed && tokenIds) {
    const entered = trimmed.split(',').map(s => s.trim()).filter(Boolean)
    if (entered.length === 0) return true
    const enteredSet = new Set(entered)
    const useAnd = entered.length >= 4 && filters.idMode === 'and'
    if (useAnd) {
      return tokenIds.every(id => enteredSet.has(id))
    } else {
      return tokenIds.some(id => enteredSet.has(id))
    }
  }

  return true
}
