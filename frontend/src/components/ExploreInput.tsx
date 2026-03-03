import { useState, type FormEvent } from 'react'
import { EXPLORE_MAX_IDS } from '../useExplorePermutations'

interface Props {
  onSearch: (ids: string[]) => void
  loading:  boolean
  error:    string
}

export function ExploreInput({ onSearch, loading, error }: Props) {
  const [raw, setRaw] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const ids = raw
      .split(',')
      .map(s => s.trim())
      .filter(s => /^\d+$/.test(s))
    // Deduplicate
    const unique = [...new Set(ids)]
    onSearch(unique)
  }

  const idCount = raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).length
  const overLimit = idCount > EXPLORE_MAX_IDS

  return (
    <div className="explore-input-wrap">
      <form className="explore-input-form" onSubmit={handleSubmit}>
        <input
          className={`explore-input${overLimit ? ' explore-input--invalid' : ''}`}
          type="text"
          placeholder={`Input IDs (up to ${EXPLORE_MAX_IDS}, comma-separated)`}
          value={raw}
          onChange={e => setRaw(e.target.value)}
          spellCheck={false}
          disabled={loading}
        />
        <button
          type="submit"
          className="explore-search-btn"
          disabled={loading || overLimit || idCount < 4}
        >
          {loading ? 'Loading…' : 'Search →'}
        </button>
      </form>
      {overLimit && (
        <p className="explore-input-hint explore-input-hint--error">
          Maximum {EXPLORE_MAX_IDS} IDs. Remove {idCount - EXPLORE_MAX_IDS} to continue.
        </p>
      )}
      {error && !overLimit && (
        <p className="explore-input-hint explore-input-hint--error">{error}</p>
      )}
    </div>
  )
}
