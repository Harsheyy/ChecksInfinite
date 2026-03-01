import { type FormEvent } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'

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
  const { address, isConnected } = useAccount()
  const { connect, connectors }  = useConnect()
  const { disconnect }           = useDisconnect()

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onPreview()
  }

  function handleWallet() {
    if (isConnected) {
      disconnect()
    } else {
      const injected = connectors.find(c => c.id === 'injected')
      if (injected) connect({ connector: injected })
    }
  }

  return (
    <nav className="navbar" aria-label="main navigation">
      <span className="nav-brand">
        <svg viewBox="0 0 36 36" width="15" height="15" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px', marginBottom: '1px' }}>
          <path fillRule="evenodd" d="M21.36 9.886A3.933 3.933 0 0 0 18 8c-1.423 0-2.67.755-3.36 1.887a3.935 3.935 0 0 0-4.753 4.753A3.933 3.933 0 0 0 8 18c0 1.423.755 2.669 1.886 3.36a3.935 3.935 0 0 0 4.753 4.753 3.933 3.933 0 0 0 4.863 1.59 3.953 3.953 0 0 0 1.858-1.589 3.935 3.935 0 0 0 4.753-4.754A3.933 3.933 0 0 0 28 18a3.933 3.933 0 0 0-1.887-3.36 3.934 3.934 0 0 0-1.042-3.711 3.934 3.934 0 0 0-3.71-1.043Zm-3.958 11.713 4.562-6.844c.566-.846-.751-1.724-1.316-.878l-4.026 6.043-1.371-1.368c-.717-.722-1.836.396-1.116 1.116l2.17 2.15a.788.788 0 0 0 1.097-.22Z" fill="#E84AA9"/>
        </svg>
        Checks Infinite
      </span>
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
      <button type="button" className="nav-wallet" onClick={handleWallet}>
        {isConnected ? `${address?.slice(0, 6)}…${address?.slice(-4)}` : 'Connect Wallet'}
      </button>
    </nav>
  )
}
