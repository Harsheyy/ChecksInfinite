// frontend/src/components/FilterBar.tsx
import { useState, useEffect, useMemo } from 'react'
import type { Attribute } from '../utils'
import type { PermutationResult } from '../useAllPermutations'

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

function countActiveFilters(f: Filters): number {
  let n = 0
  if (f.checks) n++
  if (f.colorBand) n++
  if (f.gradient) n++
  if (f.speed) n++
  if (f.shift) n++
  if (f.idInput.trim()) n++
  if (f.minCost !== null || f.maxCost !== null) n++
  return n
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
  counts?: Map<string, number>
}

function FilterSelect({ label, options, value, onChange, counts }: FilterSelectProps) {
  const visibleOptions = counts
    ? options.filter(opt => (counts.get(opt) ?? 0) > 0)
    : options

  return (
    <label className="filter-select-label">
      <span className="filter-select-name">{label}</span>
      <select
        className="filter-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">All</option>
        {visibleOptions.map(opt => (
          <option key={opt} value={opt}>
            {counts ? `${opt} (${counts.get(opt) ?? 0})` : opt}
          </option>
        ))}
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
  permutations?: PermutationResult[]  // visible permutations for counts
}

const SHUFFLE_COOLDOWN = 60  // seconds

export function FilterBar({ filters, onChange, visible, onShuffle, priceRange, permutations }: FilterBarProps) {
  const [cooldown, setCooldown] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown(s => s - 1), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  // Close panel on Escape
  useEffect(() => {
    if (!panelOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPanelOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelOpen])

  const attributeCounts = useMemo(() => {
    if (!permutations?.length) return null
    const counts = {
      checks:    new Map<string, number>(),
      colorBand: new Map<string, number>(),
      gradient:  new Map<string, number>(),
      speed:     new Map<string, number>(),
      shift:     new Map<string, number>(),
    }
    const traitMap: Array<[keyof typeof counts, string]> = [
      ['checks',    'Checks'    ],
      ['colorBand', 'Color Band'],
      ['gradient',  'Gradient'  ],
      ['speed',     'Speed'     ],
      ['shift',     'Shift'     ],
    ]
    for (const p of permutations) {
      for (const [key, traitType] of traitMap) {
        const attr = p.nodeAbcd.attributes.find(a => a.trait_type === traitType)
        if (attr) {
          const val = String(attr.value)
          counts[key].set(val, (counts[key].get(val) ?? 0) + 1)
        }
      }
    }
    return counts
  }, [permutations])

  const uniqueCheckIdCount = useMemo(() => {
    if (!permutations?.length) return null
    const ids = new Set<string>()
    for (const p of permutations) {
      for (const id of p.def.tokenIds ?? []) ids.add(id)
    }
    return ids.size
  }, [permutations])

  useEffect(() => {
    if (!attributeCounts) return
    const check = (key: keyof Pick<Filters, 'checks' | 'colorBand' | 'gradient' | 'speed' | 'shift'>, map: Map<string, number>) => {
      const val = filters[key]
      return val && !map.has(val) ? key : null
    }
    const toReset = [
      check('checks',    attributeCounts.checks),
      check('colorBand', attributeCounts.colorBand),
      check('gradient',  attributeCounts.gradient),
      check('speed',     attributeCounts.speed),
      check('shift',     attributeCounts.shift),
    ].filter((k): k is 'checks' | 'colorBand' | 'gradient' | 'speed' | 'shift' => k !== null)
    if (toReset.length > 0) {
      const patch = Object.fromEntries(toReset.map(k => [k, ''])) as Partial<Filters>
      onChange({ ...filters, ...patch })
    }
  }, [attributeCounts])  // eslint-disable-line react-hooks/exhaustive-deps

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
  const activeCount = countActiveFilters(filters)

  // ── Shared: price slider JSX ───────────────────────────────────────────────
  function PriceSlider({ fullWidth }: { fullWidth?: boolean }) {
    if (!priceRange) return null
    const currentMin = filters.minCost ?? priceRange.min
    const currentMax = filters.maxCost ?? priceRange.max
    const span = priceRange.max - priceRange.min || 1
    const leftPct  = ((currentMin - priceRange.min) / span) * 100
    const rightPct = ((currentMax - priceRange.min) / span) * 100
    const trackFill = `linear-gradient(to right, #2a2a2a ${leftPct}%, #888 ${leftPct}%, #888 ${rightPct}%, #2a2a2a ${rightPct}%)`
    return (
      <>
        <span className="filter-select-name">Cost</span>
        <span className="filter-price-val">{currentMin.toFixed(3)}</span>
        <div
          className="filter-price-track"
          style={{ backgroundImage: trackFill, maxWidth: fullWidth ? 'none' : undefined }}
        >
          <input
            type="range"
            aria-label="min cost"
            className="filter-price-range filter-price-range--min"
            min={priceRange.min}
            max={priceRange.max}
            step={(priceRange.max - priceRange.min) / 200}
            value={currentMin}
            onChange={e => {
              const v = Math.min(parseFloat(e.target.value), currentMax)
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
              const v = Math.max(parseFloat(e.target.value), currentMin)
              onChange({ ...filters, maxCost: v >= priceRange.max ? null : v })
            }}
          />
        </div>
        <span className="filter-price-val">{currentMax.toFixed(3)} ETH</span>
      </>
    )
  }

  return (
    <>
      <div className="filter-strip">
        {/* ── Desktop: inline row ── */}
        <div className="filter-row">
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
          {parseIdCount(filters.idInput) >= 4 && (
            <div className="filter-mode-toggle">
              <button type="button" className={`filter-mode-btn${filters.idMode === 'and' ? ' filter-mode-btn--active' : ''}`} onClick={() => update('idMode', 'and')} aria-label="AND">AND</button>
              <button type="button" className={`filter-mode-btn${filters.idMode === 'or'  ? ' filter-mode-btn--active' : ''}`} onClick={() => update('idMode', 'or')}  aria-label="OR">OR</button>
            </div>
          )}
          <FilterSelect label="Checks"     options={CHECKS_OPTIONS}     value={filters.checks}    onChange={v => update('checks', v)}    counts={attributeCounts?.checks} />
          <FilterSelect label="Color Band" options={COLOR_BAND_OPTIONS} value={filters.colorBand} onChange={v => update('colorBand', v)} counts={attributeCounts?.colorBand} />
          <FilterSelect label="Gradient"   options={GRADIENT_OPTIONS}   value={filters.gradient}  onChange={v => update('gradient', v)}  counts={attributeCounts?.gradient} />
          <FilterSelect label="Speed"      options={SPEED_OPTIONS}      value={filters.speed}     onChange={v => update('speed', v)}     counts={attributeCounts?.speed} />
          <FilterSelect label="Shift"      options={SHIFT_OPTIONS}      value={filters.shift}     onChange={v => update('shift', v)}     counts={attributeCounts?.shift} />
          <PriceSlider />
          <span className="filter-count">
            Showing {visible}
            {uniqueCheckIdCount != null && (
              <span className="info-icon-wrapper" tabIndex={0} aria-label="info">
                <span className="info-icon" aria-hidden="true">ⓘ</span>
                <span className="info-tooltip" role="tooltip">
                  Showing a sample of all permutations. This sample draws from {uniqueCheckIdCount} unique Check IDs.
                </span>
              </span>
            )}
          </span>
          {isActive && <button type="button" className="filter-clear" onClick={clearAll}>Clear</button>}
          {onShuffle && (
            <button type="button" className="filter-shuffle" onClick={handleShuffle} disabled={cooldown > 0}>
              {cooldown > 0 ? `↻ ${cooldown}s` : '↻ Shuffle'}
            </button>
          )}
        </div>

        {/* ── Mobile: trigger bar ── */}
        <div className="filter-mobile-bar">
          <button
            type="button"
            className={`filter-mobile-trigger${isActive ? ' filter-mobile-trigger--active' : ''}`}
            onClick={() => setPanelOpen(true)}
          >
            {isActive ? `${activeCount} Filter${activeCount !== 1 ? 's' : ''}` : 'Filters'}
          </button>
          <span className="filter-count">
            Showing {visible}
            {uniqueCheckIdCount != null && (
              <span className="info-icon-wrapper" tabIndex={0} aria-label="info">
                <span className="info-icon" aria-hidden="true">ⓘ</span>
                <span className="info-tooltip" role="tooltip">
                  Showing a sample of all permutations. This sample draws from {uniqueCheckIdCount} unique Check IDs.
                </span>
              </span>
            )}
          </span>
          {isActive && <button type="button" className="filter-clear" onClick={clearAll}>Clear</button>}
          {onShuffle && (
            <button type="button" className="filter-shuffle" onClick={handleShuffle} disabled={cooldown > 0}>
              {cooldown > 0 ? `↻ ${cooldown}s` : '↻ Shuffle'}
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile: side panel overlay ── */}
      {panelOpen && (
        <>
          <div className="filter-panel-backdrop" onClick={() => setPanelOpen(false)} />
          <div className="filter-panel">
            <div className="filter-panel-header">
              <span>Filters</span>
              <button type="button" className="filter-panel-close" onClick={() => setPanelOpen(false)} aria-label="Close">✕</button>
            </div>

            <div className="filter-panel-body">
              <div className="filter-panel-group">
                <span className="filter-select-name">IDs</span>
                <input
                  className="filter-id-input filter-id-input--full"
                  type="text"
                  placeholder="e.g. 123, 456"
                  value={filters.idInput}
                  onChange={e => update('idInput', e.target.value)}
                />
                {parseIdCount(filters.idInput) >= 4 && (
                  <div className="filter-mode-toggle" style={{ marginTop: '0.35rem' }}>
                    <button type="button" className={`filter-mode-btn${filters.idMode === 'and' ? ' filter-mode-btn--active' : ''}`} onClick={() => update('idMode', 'and')} aria-label="AND">AND</button>
                    <button type="button" className={`filter-mode-btn${filters.idMode === 'or'  ? ' filter-mode-btn--active' : ''}`} onClick={() => update('idMode', 'or')}  aria-label="OR">OR</button>
                  </div>
                )}
              </div>

              <div className="filter-panel-group">
                <span className="filter-select-name">Checks</span>
                <select className="filter-select filter-select--full" value={filters.checks} onChange={e => update('checks', e.target.value)}>
                  <option value="">All</option>
                  {CHECKS_OPTIONS
                    .filter(o => !attributeCounts || (attributeCounts.checks.get(o) ?? 0) > 0)
                    .map(o => (
                      <option key={o} value={o}>
                        {attributeCounts ? `${o} (${attributeCounts.checks.get(o) ?? 0})` : o}
                      </option>
                    ))}
                </select>
              </div>

              <div className="filter-panel-group">
                <span className="filter-select-name">Color Band</span>
                <select data-testid="mobile-colorband-select" className="filter-select filter-select--full" value={filters.colorBand} onChange={e => update('colorBand', e.target.value)}>
                  <option value="">All</option>
                  {COLOR_BAND_OPTIONS
                    .filter(o => !attributeCounts || (attributeCounts.colorBand.get(o) ?? 0) > 0)
                    .map(o => (
                      <option key={o} value={o}>
                        {attributeCounts ? `${o} (${attributeCounts.colorBand.get(o) ?? 0})` : o}
                      </option>
                    ))}
                </select>
              </div>

              <div className="filter-panel-group">
                <span className="filter-select-name">Gradient</span>
                <select className="filter-select filter-select--full" value={filters.gradient} onChange={e => update('gradient', e.target.value)}>
                  <option value="">All</option>
                  {GRADIENT_OPTIONS
                    .filter(o => !attributeCounts || (attributeCounts.gradient.get(o) ?? 0) > 0)
                    .map(o => (
                      <option key={o} value={o}>
                        {attributeCounts ? `${o} (${attributeCounts.gradient.get(o) ?? 0})` : o}
                      </option>
                    ))}
                </select>
              </div>

              <div className="filter-panel-group">
                <span className="filter-select-name">Speed</span>
                <select className="filter-select filter-select--full" value={filters.speed} onChange={e => update('speed', e.target.value)}>
                  <option value="">All</option>
                  {SPEED_OPTIONS
                    .filter(o => !attributeCounts || (attributeCounts.speed.get(o) ?? 0) > 0)
                    .map(o => (
                      <option key={o} value={o}>
                        {attributeCounts ? `${o} (${attributeCounts.speed.get(o) ?? 0})` : o}
                      </option>
                    ))}
                </select>
              </div>

              <div className="filter-panel-group">
                <span className="filter-select-name">Shift</span>
                <select className="filter-select filter-select--full" value={filters.shift} onChange={e => update('shift', e.target.value)}>
                  <option value="">All</option>
                  {SHIFT_OPTIONS
                    .filter(o => !attributeCounts || (attributeCounts.shift.get(o) ?? 0) > 0)
                    .map(o => (
                      <option key={o} value={o}>
                        {attributeCounts ? `${o} (${attributeCounts.shift.get(o) ?? 0})` : o}
                      </option>
                    ))}
                </select>
              </div>

              {priceRange && (() => {
                const currentMin = filters.minCost ?? priceRange.min
                const currentMax = filters.maxCost ?? priceRange.max
                const span = priceRange.max - priceRange.min || 1
                const leftPct  = ((currentMin - priceRange.min) / span) * 100
                const rightPct = ((currentMax - priceRange.min) / span) * 100
                const trackFill = `linear-gradient(to right, #2a2a2a ${leftPct}%, #888 ${leftPct}%, #888 ${rightPct}%, #2a2a2a ${rightPct}%)`
                return (
                  <div className="filter-panel-group">
                    <span className="filter-select-name">Cost</span>
                    <div className="filter-panel-price-row">
                      <span className="filter-price-val">{currentMin.toFixed(3)}</span>
                      <div className="filter-price-track" style={{ backgroundImage: trackFill, maxWidth: 'none', flex: 1 }}>
                        <input type="range" aria-label="min cost" className="filter-price-range filter-price-range--min"
                          min={priceRange.min} max={priceRange.max} step={(priceRange.max - priceRange.min) / 200} value={currentMin}
                          onChange={e => { const v = Math.min(parseFloat(e.target.value), currentMax); onChange({ ...filters, minCost: v <= priceRange.min ? null : v }) }}
                        />
                        <input type="range" aria-label="max cost" className="filter-price-range filter-price-range--max"
                          min={priceRange.min} max={priceRange.max} step={(priceRange.max - priceRange.min) / 200} value={currentMax}
                          onChange={e => { const v = Math.max(parseFloat(e.target.value), currentMin); onChange({ ...filters, maxCost: v >= priceRange.max ? null : v }) }}
                        />
                      </div>
                      <span className="filter-price-val">{currentMax.toFixed(3)} ETH</span>
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="filter-panel-footer">
              {isActive && (
                <button type="button" className="filter-clear" onClick={() => { clearAll(); setPanelOpen(false) }}>
                  Clear all
                </button>
              )}
              <button type="button" className="filter-panel-done" onClick={() => setPanelOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </>
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
