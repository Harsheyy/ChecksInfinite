// frontend/src/components/FundingPrompt.tsx
//
// Shown when charge_credits returns insufficient_balance. Credits are sold
// in three fixed USD packages ($10/$25/$50 -> 10/25/50 credits). Primary
// flow: pick a package, sign a plain ETH transfer to the receiving address
// from the already-connected wallet (wagmi's useSendTransaction) — no
// manual copy/paste needed. Credits land via the existing credits-webhook
// path (same on-chain transfer either way, whether sent from this button
// or from an external wallet), typically within a block or two, so this
// polls the balance for a short window after the transaction confirms and
// reflects the update reactively (useCreditBalance's shared cache means
// Navbar's chip picks it up too).
import { useState, useEffect, useRef } from 'react'
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
import { useEthUsdPrice } from '../useEthUsdPrice'
import { useCreditBalance } from '../useCreditBalance'

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

// How long to keep polling the balance after a payment confirms on-chain,
// waiting for credits-webhook to process it — typically a block or two.
const CREDIT_POLL_WINDOW_MS = 90_000
const CREDIT_POLL_INTERVAL_MS = 4_000

export function FundingPrompt({ actionType, priceCredits, receivingAddress, onClose }: FundingPromptProps) {
  const [copied, setCopied] = useState(false)
  const [buyingUsd, setBuyingUsd] = useState<number | null>(null)
  const [buyError, setBuyError] = useState('')
  const [awaitingCredit, setAwaitingCredit] = useState(false)
  const ethUsdPrice = useEthUsdPrice()
  const { address } = useAccount()
  const credits = useCreditBalance(address)
  const balanceAtSendRef = useRef<number | null>(null)

  const { sendTransactionAsync, isPending: isSending } = useSendTransaction()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined)
  const { isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  // Once the payment tx confirms on-chain, start polling for the credit to
  // land (the webhook processes it asynchronously, off this tx's timeline).
  useEffect(() => {
    if (!isConfirmed || awaitingCredit) return
    setAwaitingCredit(true)
    balanceAtSendRef.current = credits.balance
    const start = Date.now()
    const interval = setInterval(() => {
      credits.refresh()
      if (Date.now() - start > CREDIT_POLL_WINDOW_MS) clearInterval(interval)
    }, CREDIT_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const creditReceived = awaitingCredit && balanceAtSendRef.current !== null && credits.balance !== null
    && credits.balance > balanceAtSendRef.current

  async function handleBuy(pkg: { usd: number; credits: number }) {
    if (!ethUsdPrice) return
    setBuyError('')
    setBuyingUsd(pkg.usd)
    try {
      const ethAmount = (pkg.usd / ethUsdPrice).toFixed(18)
      const hash = await sendTransactionAsync({
        to: receivingAddress as `0x${string}`,
        value: parseEther(ethAmount),
      })
      setTxHash(hash)
    } catch (err) {
      // User rejected in their wallet, or the send failed outright.
      setBuyError(err instanceof Error ? err.message : 'Transaction failed or was rejected.')
      setBuyingUsd(null)
    }
  }

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
          {ACTION_LABELS[actionType]} costs {priceCredits} credit{priceCredits === 1 ? '' : 's'}. Pick a package
          below to pay directly from your connected wallet.
        </p>

        {creditReceived ? (
          <p className="funding-prompt-success">✓ Credits added — you're all set.</p>
        ) : awaitingCredit ? (
          <p className="funding-prompt-status">Payment confirmed — waiting for your credits to land (usually a block or two)…</p>
        ) : (
          <div className="funding-prompt-packages">
            {PACKAGES.map(pkg => {
              const isThisBuying = buyingUsd === pkg.usd && (isSending || (txHash && !isConfirmed))
              return (
                <div key={pkg.usd} className="funding-prompt-package">
                  <span className="funding-prompt-package-usd">${pkg.usd}</span>
                  <span className="funding-prompt-package-credits">{pkg.credits} credits</span>
                  <span className="funding-prompt-package-eth">
                    {ethUsdPrice ? `≈ ${(pkg.usd / ethUsdPrice).toFixed(5)} ETH` : 'loading…'}
                  </span>
                  <button
                    type="button"
                    className="funding-prompt-buy"
                    disabled={!ethUsdPrice || !address || isSending || Boolean(txHash && !isConfirmed)}
                    onClick={() => handleBuy(pkg)}
                  >
                    {isThisBuying ? (isSending ? 'Confirm in wallet…' : 'Confirming…') : 'Buy'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {buyError && <p className="funding-prompt-error">{buyError}</p>}

        {!awaitingCredit && (
          <>
            <p className="funding-prompt-manual-label">Or send manually to:</p>
            <div className="funding-prompt-address" onClick={handleCopy}>
              {receivingAddress}
              <span className="funding-prompt-copy">{copied ? 'Copied!' : 'Copy'}</span>
            </div>
          </>
        )}

        <button type="button" className="funding-prompt-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
