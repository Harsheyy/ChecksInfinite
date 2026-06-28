// frontend/src/components/SearchQueryBar.tsx
import type { SearchInputMode } from './SearchInputTabs'
import type { SearchFilters } from '../searchFilters'

interface SearchQueryBarProps {
  inputMode: SearchInputMode | null      // null when traits-only global search
  inputSummary: string                   // e.g. "42, 137, 509, 1024" or "vitalik.eth"
  filters: SearchFilters
  onClearInput: () => void
  onClearTrait: (trait: keyof SearchFilters) => void
  onClearPrice: () => void
  onEdit: () => void                     // re-opens the homepage form
  totalMatches: number
  capped: boolean
  globalTotal?: number                   // used when capped=true
  onShuffle?: () => void
  shuffleDisabled?: boolean
}

const TRAIT_LABELS = {
  checks:    'Checks',
  colorBand: 'Color Band',
  gradient:  'Gradient',
  speed:     'Speed',
  shift:     'Shift',
} as const

export function SearchQueryBar({
  inputMode, inputSummary, filters,
  onClearInput, onClearTrait, onClearPrice, onEdit,
  totalMatches, capped, globalTotal,
  onShuffle, shuffleDisabled,
}: SearchQueryBarProps) {

  const inputChipLabel =
    inputMode === 'ids'    ? `IDs · ${inputSummary}` :
    inputMode === 'wallet' ? `Wallet · ${inputSummary}` :
                              null

  const traitKeys = (Object.keys(TRAIT_LABELS) as (keyof typeof TRAIT_LABELS)[])
    .filter(k => filters[k].length > 0)

  const priceChipLabel = filters.priceMin && filters.priceMax
    ? `Price · ${filters.priceMin}–${filters.priceMax} ETH`
    : filters.priceMin
      ? `Price · ≥${filters.priceMin} ETH`
      : filters.priceMax
        ? `Price · ≤${filters.priceMax} ETH`
        : null

  return (
    <div className="search-querybar">
      <div className="search-querybar__chips">
        {inputChipLabel && (
          <span className="search-querybar__chip search-querybar__chip--input">
            {inputChipLabel}
            <button type="button" aria-label="Remove input" onClick={onClearInput}>×</button>
          </span>
        )}
        {traitKeys.map(k => (
          <span key={k} className="search-querybar__chip">
            {TRAIT_LABELS[k]} · {filters[k].join(', ')}
            <button type="button" aria-label={`Remove ${TRAIT_LABELS[k]}`} onClick={() => onClearTrait(k)}>×</button>
          </span>
        ))}
        {priceChipLabel && (
          <span className="search-querybar__chip">
            {priceChipLabel}
            <button type="button" aria-label="Remove price filter" onClick={onClearPrice}>×</button>
          </span>
        )}
        <button type="button" className="search-querybar__edit" onClick={onEdit}>Edit</button>
      </div>
      <div className="search-querybar__meta">
        <span>
          {totalMatches} permutation{totalMatches === 1 ? '' : 's'}
          {capped && globalTotal !== undefined && ` · showing 500 of ~${globalTotal}`}
        </span>
        {onShuffle && (
          <button
            type="button"
            className="search-querybar__shuffle"
            onClick={onShuffle}
            disabled={shuffleDisabled}
          >↻ Shuffle</button>
        )}
      </div>
    </div>
  )
}
