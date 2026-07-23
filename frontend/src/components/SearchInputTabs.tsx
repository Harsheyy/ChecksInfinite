// frontend/src/components/SearchInputTabs.tsx
import { isValidAddress } from '../utils'

export type SearchInputMode = 'ids' | 'wallet' | 'patterns'

interface SearchInputTabsProps {
  mode: SearchInputMode
  onModeChange: (mode: SearchInputMode) => void
  idsRaw: string
  onIdsRawChange: (v: string) => void
  walletRaw: string
  onWalletRawChange: (v: string) => void
  walletConnectedAddress?: string
  onUseMyWallet: () => void
  loading?: boolean
}

const ID_RE = /^\d+$/

function parseIds(raw: string): string[] {
  return [...new Set(raw.split(',').map(s => s.trim()).filter(s => ID_RE.test(s)))]
}

export function SearchInputTabs({
  mode, onModeChange,
  idsRaw, onIdsRawChange,
  walletRaw, onWalletRawChange,
  walletConnectedAddress, onUseMyWallet,
  loading,
}: SearchInputTabsProps) {
  const ids = parseIds(idsRaw)
  const idCount = ids.length

  const idsHint =
    idsRaw.trim().length === 0 ? '4–10 IDs, comma separated' :
    idCount < 4                ? 'Add at least 4 IDs' :
    idCount > 10               ? 'Maximum 10 IDs' :
                                  `${idCount} IDs · ready to search`

  const walletTrim = walletRaw.trim()
  const isAddr = isValidAddress(walletTrim)
  const isEns  = /\.eth$/i.test(walletTrim)
  const walletHint =
    walletTrim.length === 0 ? '0x… or vitalik.eth' :
    isAddr                   ? '✓ address' :
    isEns                    ? 'ENS — will resolve on Search' :
                               'Enter a 0x address or ENS name'

  return (
    <div className="search-tabs">
      <div className="search-tabs__row" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'ids'}
          className={`search-tabs__tab${mode === 'ids' ? ' search-tabs__tab--on' : ''}`}
          onClick={() => onModeChange('ids')}
        >Token IDs</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'wallet'}
          className={`search-tabs__tab${mode === 'wallet' ? ' search-tabs__tab--on' : ''}`}
          onClick={() => onModeChange('wallet')}
        >Wallet</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'patterns'}
          className={`search-tabs__tab${mode === 'patterns' ? ' search-tabs__tab--on' : ''}`}
          onClick={() => onModeChange('patterns')}
        >Patterns</button>
      </div>

      {mode === 'ids' && (
        <>
          <input
            type="text"
            className="search-tabs__input"
            placeholder="e.g. 42, 137, 509, 1024"
            value={idsRaw}
            onChange={e => onIdsRawChange(e.target.value)}
            disabled={loading}
            spellCheck={false}
            autoFocus
          />
          <div className="search-tabs__hint">{idsHint}</div>
        </>
      )}

      {mode === 'wallet' && (
        <>
          <input
            type="text"
            className="search-tabs__input"
            placeholder="0x… or vitalik.eth"
            value={walletRaw}
            onChange={e => onWalletRawChange(e.target.value)}
            disabled={loading}
            spellCheck={false}
            autoFocus
          />
          <div className="search-tabs__hint search-tabs__hint--row">
            <span>{walletHint}</span>
            {walletConnectedAddress && (
              <button
                type="button"
                className="search-tabs__use-mine"
                onClick={onUseMyWallet}
                disabled={loading}
              >
                Use my wallet
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export { parseIds }
