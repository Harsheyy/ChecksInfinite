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
      <button type="button" className="nav-wallet" onClick={handleWallet}>
        {isConnected ? `${address?.slice(0, 6)}…${address?.slice(-4)}` : 'Connect Wallet'}
      </button>
    </nav>
  )
}
