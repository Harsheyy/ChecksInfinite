// frontend/src/components/FundingPrompt.tsx
//
// Shown when charge_credits returns insufficient_balance. Credits are sold
// in three fixed USD packages ($10/$25/$50 -> 10/25/50 credits) rather than
// an arbitrary top-up — this shows the live ETH equivalent for each so the
// user knows exactly how much to send. Text address + copy button for v1 —
// no QR code library is in this app's dependencies yet.
import { useState } from 'react'
import { useEthUsdPrice } from '../useEthUsdPrice'

interface FundingPromptProps {
  actionType: 'search_query' | 'recipe_view'
  priceCredits: number
  receivingAddress: string
  onClose: () => void
}

const ACTION_LABELS: Record<FundingPromptProps['actionType'], string> = {
  search_query: 'a search',
  recipe_view: 'viewing a recipe',
}

const PACKAGES = [
  { usd: 10, credits: 10 },
  { usd: 25, credits: 25 },
  { usd: 50, credits: 50 },
]

export function FundingPrompt({ actionType, priceCredits, receivingAddress, onClose }: FundingPromptProps) {
  const [copied, setCopied] = useState(false)
  const ethUsdPrice = useEthUsdPrice()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(receivingAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      // Silent failure — user can manually select and copy the address
      console.error('Failed to copy address to clipboard:', err)
    }
  }

  return (
    <div className="funding-prompt-overlay" onClick={onClose}>
      <div className="funding-prompt" onClick={e => e.stopPropagation()}>
        <h3>Not enough credits</h3>
        <p>
          {ACTION_LABELS[actionType]} costs {priceCredits} credit{priceCredits === 1 ? '' : 's'}. Buy a credit
          package by sending ETH to the address below — it's credited automatically within a block or two.
        </p>

        <div className="funding-prompt-packages">
          {PACKAGES.map(pkg => (
            <div key={pkg.usd} className="funding-prompt-package">
              <span className="funding-prompt-package-usd">${pkg.usd}</span>
              <span className="funding-prompt-package-credits">{pkg.credits} credits</span>
              <span className="funding-prompt-package-eth">
                {ethUsdPrice ? `≈ ${(pkg.usd / ethUsdPrice).toFixed(5)} ETH` : 'loading…'}
              </span>
            </div>
          ))}
        </div>

        <div className="funding-prompt-address" onClick={handleCopy}>
          {receivingAddress}
          <span className="funding-prompt-copy">{copied ? 'Copied!' : 'Copy'}</span>
        </div>
        <button type="button" className="funding-prompt-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
