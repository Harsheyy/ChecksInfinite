// frontend/src/components/FundingPrompt.tsx
//
// Shown when charge_credits returns insufficient_balance. Text address +
// copy button for v1 — no QR code library is in this app's dependencies
// yet, and address-as-text is sufficient to unblock funding; a QR code is
// a fine later addition but isn't needed to ship this.
import { useState } from 'react'

interface FundingPromptProps {
  actionType: 'search_query' | 'recipe_view'
  priceWei: bigint
  receivingAddress: string
  onClose: () => void
}

const ACTION_LABELS: Record<FundingPromptProps['actionType'], string> = {
  search_query: 'a search',
  recipe_view: 'viewing a recipe',
}

export function FundingPrompt({ actionType, priceWei, receivingAddress, onClose }: FundingPromptProps) {
  const [copied, setCopied] = useState(false)
  const priceEth = (Number(priceWei) / 1e18).toFixed(4)

  function handleCopy() {
    navigator.clipboard.writeText(receivingAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="funding-prompt-overlay" onClick={onClose}>
      <div className="funding-prompt" onClick={e => e.stopPropagation()}>
        <h3>Not enough balance</h3>
        <p>
          {ACTION_LABELS[actionType]} costs {priceEth} ETH. Send ETH to the address below to top up —
          it's credited automatically within a block or two.
        </p>
        <div className="funding-prompt-address" onClick={handleCopy}>
          {receivingAddress}
          <span className="funding-prompt-copy">{copied ? 'Copied!' : 'Copy'}</span>
        </div>
        <button type="button" className="funding-prompt-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
