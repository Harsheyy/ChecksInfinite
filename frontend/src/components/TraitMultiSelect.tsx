// frontend/src/components/TraitMultiSelect.tsx
import { useState, useEffect, useRef } from 'react'

interface TraitMultiSelectProps {
  label: string
  options: readonly string[]
  values: string[]
  onChange: (values: string[]) => void
  counts?: Map<string, number>
}

export function TraitMultiSelect({ label, options, values, onChange, counts }: TraitMultiSelectProps) {
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

  function toggle(opt: string) {
    if (values.includes(opt)) {
      onChange(values.filter(v => v !== opt))
    } else {
      onChange([...values, opt])
    }
  }

  const summary = values.length === 0 ? 'Any' : values.join(', ')

  return (
    <div className="trait-multi" ref={ref}>
      <span className="trait-multi__label">{label}</span>
      <button
        type="button"
        className={`trait-multi__btn${values.length === 0 ? ' trait-multi__btn--empty' : ''}${open ? ' trait-multi__btn--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="trait-multi__summary">{summary}</span>
        <span className="trait-multi__caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="trait-multi__popover" role="listbox">
          {options.map(opt => {
            const checked = values.includes(opt)
            const count = counts?.get(opt)
            return (
              <label key={opt} className="trait-multi__option">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                />
                <span className="trait-multi__option-label">{opt}</span>
                {count !== undefined && (
                  <span className="trait-multi__option-count">{count}</span>
                )}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
