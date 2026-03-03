// frontend/src/components/FilterBar.tsx
import { useState, useEffect, useMemo, useRef } from 'react'
import type { Attribute } from '../utils'
import type { PermutationResult } from '../useAllPermutations'

export interface Filters {
  checks: string
  colorBand: string
  gradient: string
  speed: string
  shift: string
  selectedIds: string[]
  minCost: number | null
  maxCost: number | null
}

export function emptyFilters(): Filters {
  return {
    checks: '', colorBand: '', gradient: '', speed: '', shift: '',
    selectedIds: [],
    minCost: null, maxCost: null,
  }
}

export function hasActiveFilters(f: Filters): boolean {
  return !!(
    f.checks || f.colorBand || f.gradient || f.speed || f.shift ||
    f.selectedIds.length > 0 || f.minCost !== null || f.maxCost !== null
  )
}

function countActiveFilters(f: Filters): number {
  let n = 0
  if (f.checks) n++
  if (f.colorBand) n++
  if (f.gradient) n++
  if (f.speed) n++
  if (f.shift) n++
  if (f.selectedIds.length > 0) n++
  if (f.minCost !== null || f.maxCost !== null) n++
  return n
}

const CHECKS_OPTIONS    = ['20', '10', '5', '4', '1']
const COLOR_BAND_OPTIONS = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One']
const GRADIENT_OPTIONS  = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z']
const SPEED_OPTIONS     = ['0.5x', '1x', '2x']
const SHIFT_OPTIONS     = ['IR', 'UV']


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

interface IdMultiSelectProps {
  tokenIdCounts: Map<string, number>
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

function IdMultiSelect({ tokenIdCounts, selectedIds, onChange }: IdMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(x => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const sorted = Array.from(tokenIdCounts.entries()).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))

  return (
    <div className="filter-select-label filter-id-multi" ref={ref}>
      <span className="filter-select-name">Child IDs</span>
      <button
        type="button"
        className="filter-select filter-id-multi-btn"
        onClick={() => setOpen(o => !o)}
      >
        {selectedIds.length > 0 ? `(${selectedIds.length})` : 'ALL'}
      </button>
      {open && (
        <div className="filter-id-multi-dropdown">
          {sorted.map(([id, count]) => (
            <label key={id} className="filter-id-multi-option">
              <input
                type="checkbox"
                checked={selectedIds.includes(id)}
                onChange={() => toggle(id)}
              />
              <span>#{id} ({count})</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

interface FilterBarProps {
  filters: Filters
  onChange: (f: Filters) => void
  visible: number
  onShuffle?: () => void
  priceRange?: { min: number; max: number }
  permutations?: PermutationResult[]  // visible permutations for counts
  curatedMode?: boolean
  walletOnly?: boolean
  onWalletOnlyChange?: (v: boolean) => void
  isConnected?: boolean
  hideIdFilter?: boolean
  exploreMode?: boolean
  onExploreSearch?: (ids: string[]) => void
  onExploreClear?: () => void
  exploreLoading?: boolean
  exploreError?: string
  exploreSearched?: boolean
}

const SHUFFLE_COOLDOWN = 60  // seconds

export function FilterBar({ filters, onChange, visible, onShuffle, priceRange, permutations, curatedMode, walletOnly, onWalletOnlyChange, isConnected, hideIdFilter, exploreMode, onExploreSearch, onExploreClear, exploreLoading, exploreError, exploreSearched }: FilterBarProps) {
  const [cooldown, setCooldown] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [exploreRaw, setExploreRaw] = useState('')

  function submitExplore() {
    const ids = exploreRaw
      .split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s))
    onExploreSearch?.([...new Set(ids)])
  }

  function handleExploreSubmit(e: React.FormEvent) {
    e.preventDefault()
    submitExplore()
  }

  const exploreIdCount = exploreRaw
    .split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).length

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

  const tokenIdCounts = useMemo(() => {
    if (!permutations?.length) return null
    const counts = new Map<string, number>()
    for (const p of permutations) {
      for (const id of p.def.tokenIds ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
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

    const validSelected = tokenIdCounts
      ? filters.selectedIds.filter(id => tokenIdCounts.has(id))
      : filters.selectedIds
    const idReset = validSelected.length !== filters.selectedIds.length

    if (toReset.length > 0 || idReset) {
      onChange({
        ...filters,
        ...Object.fromEntries(toReset.map(k => [k, ''])),
        selectedIds: validSelected,
      })
    }
  }, [attributeCounts, tokenIdCounts])  // eslint-disable-line react-hooks/exhaustive-deps

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
          {exploreMode && (
            <div className="filter-explore-wrap">
              <form className="filter-explore-form" onSubmit={handleExploreSubmit}>
                <label className="filter-select-label">
                  <span className="filter-select-name">IDs</span>
                  <input
                    className={`filter-id-input${exploreError ? ' filter-id-input--error' : ''}`}
                    type="text"
                    placeholder="4–10 token IDs, comma-separated"
                    value={exploreRaw}
                    onChange={e => setExploreRaw(e.target.value)}
                    disabled={exploreLoading}
                    spellCheck={false}
                  />
                </label>
                <button
                  type="submit"
                  className="filter-explore-submit"
                  disabled={exploreLoading || exploreIdCount < 4 || exploreIdCount > 10}
                >
                  {exploreLoading ? '…' : '→'}
                </button>
                {exploreSearched && (
                  <button
                    type="button"
                    className="filter-explore-clear"
                    onClick={() => { setExploreRaw(''); onExploreClear?.() }}
                  >
                    Clear
                  </button>
                )}
              </form>
              {exploreError && (
                <p className="filter-explore-error">{exploreError}</p>
              )}
            </div>
          )}
          {curatedMode && (
            <div className="filter-curated-toggle">
              <button
                type="button"
                className={`filter-mode-btn${!walletOnly ? ' filter-mode-btn--active' : ''}`}
                onClick={() => onWalletOnlyChange?.(false)}
              >Community</button>
              <button
                type="button"
                className={`filter-mode-btn${walletOnly ? ' filter-mode-btn--active' : ''}`}
                onClick={() => isConnected && onWalletOnlyChange?.(true)}
                title={!isConnected ? 'Connect wallet to see your likes' : undefined}
                disabled={!isConnected}
              >Mine</button>
            </div>
          )}
          {!hideIdFilter && tokenIdCounts && tokenIdCounts.size > 0 && (
            <IdMultiSelect
              tokenIdCounts={tokenIdCounts}
              selectedIds={filters.selectedIds}
              onChange={ids => onChange({ ...filters, selectedIds: ids })}
            />
          )}
          {!exploreMode && <FilterSelect label="Checks" options={CHECKS_OPTIONS} value={filters.checks} onChange={v => update('checks', v)} counts={attributeCounts?.checks} />}
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

        {/* ── Mobile: explore form (outside panel) ── */}
        {exploreMode && (
          <div className="filter-mobile-explore">
            <form className="filter-explore-form" onSubmit={handleExploreSubmit}>
              <input
                className={`filter-id-input filter-id-input--full${exploreError ? ' filter-id-input--error' : ''}`}
                type="text"
                placeholder="4–10 token IDs, comma-separated"
                value={exploreRaw}
                onChange={e => setExploreRaw(e.target.value)}
                disabled={exploreLoading}
                spellCheck={false}
              />
              <button
                type="submit"
                className="filter-explore-submit"
                disabled={exploreLoading || exploreIdCount < 4 || exploreIdCount > 10}
              >
                {exploreLoading ? '…' : '→'}
              </button>
              {exploreSearched && (
                <button
                  type="button"
                  className="filter-explore-clear"
                  onClick={() => { setExploreRaw(''); onExploreClear?.() }}
                >
                  Clear
                </button>
              )}
            </form>
            {exploreError && (
              <p className="filter-explore-error">{exploreError}</p>
            )}
          </div>
        )}

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
              {curatedMode && (
                <div className="filter-panel-group">
                  <span className="filter-select-name">View</span>
                  <div className="filter-mode-toggle">
                    <button
                      type="button"
                      className={`filter-mode-btn${!walletOnly ? ' filter-mode-btn--active' : ''}`}
                      onClick={() => onWalletOnlyChange?.(false)}
                    >Community</button>
                    <button
                      type="button"
                      className={`filter-mode-btn${walletOnly ? ' filter-mode-btn--active' : ''}`}
                      onClick={() => isConnected && onWalletOnlyChange?.(true)}
                      title={!isConnected ? 'Connect wallet to see your likes' : undefined}
                      disabled={!isConnected}
                    >Mine</button>
                  </div>
                </div>
              )}
              {!hideIdFilter && tokenIdCounts && tokenIdCounts.size > 0 && (
                <div className="filter-panel-group">
                  <span className="filter-select-name">
                    Child IDs{filters.selectedIds.length > 0 ? ` (${filters.selectedIds.length})` : ''}
                  </span>
                  <div className="filter-id-panel-list">
                    {Array.from(tokenIdCounts.entries())
                      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                      .map(([id, count]) => (
                        <label key={id} className="filter-id-multi-option">
                          <input
                            type="checkbox"
                            checked={filters.selectedIds.includes(id)}
                            onChange={() => {
                              const selected = filters.selectedIds.includes(id)
                                ? filters.selectedIds.filter(x => x !== id)
                                : [...filters.selectedIds, id]
                              onChange({ ...filters, selectedIds: selected })
                            }}
                          />
                          <span>#{id} ({count})</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}
              {!exploreMode && (
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
              )}

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
  totalCost?: number | null,
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

  if (filters.selectedIds.length > 0 && tokenIds) {
    if (!filters.selectedIds.every(id => tokenIds.includes(id))) return false
  }

  if (filters.minCost !== null && (totalCost == null || totalCost < filters.minCost)) return false
  if (filters.maxCost !== null && (totalCost == null || totalCost > filters.maxCost)) return false

  return true
}
