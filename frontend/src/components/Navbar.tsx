import { type FormEvent } from 'react'

interface NavbarProps {
  ids: string
  loading: boolean
  onIdsChange: (v: string) => void
  onPreview: () => void
  error: string
  dbMode?: boolean
  dbTotal?: number
}

export function Navbar({ ids, loading, onIdsChange, onPreview, error, dbMode }: NavbarProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onPreview()
  }

  return (
    <nav className="navbar" aria-label="main navigation">
      <span className="nav-brand">◆ Checks Infinite</span>
      <div className="nav-center">
        {dbMode ? (
          <span className="nav-db-status">
            {loading ? 'Loading…' : ''}
          </span>
        ) : (
          <form onSubmit={handleSubmit} aria-label="form">
            <input
              type="text"
              className="nav-ids-input"
              placeholder="e.g. 1234, 5678, 9012, 3456"
              aria-label="Token IDs"
              value={ids}
              onChange={e => onIdsChange(e.target.value)}
            />
            <button type="submit" disabled={loading} className="nav-preview-btn">
              {loading ? 'Loading…' : 'Preview →'}
            </button>
          </form>
        )}
        {error && <div className="nav-error">{error}</div>}
      </div>
      <button type="button" className="nav-wallet" disabled>Connect Wallet</button>
    </nav>
  )
}
