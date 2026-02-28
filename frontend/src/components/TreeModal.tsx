import { useEffect, useState } from 'react'
import { useAccount, useReadContracts, useWriteContract } from 'wagmi'
import { formatEther } from 'viem'
import { CheckCard } from './CheckCard'
import { supabase } from '../supabaseClient'
import { tokenStrategyAbi, TOKEN_STRATEGY_ADDRESS } from '../tokenStrategyAbi'
import type { PermutationResult } from '../useAllPermutations'
import type { CardState } from '../utils'

interface TreeModalProps {
  result: PermutationResult
  ids: string[]
  onClose: () => void
  dbMode?: boolean
}

function cardProps(card: CardState, svgOverride?: string) {
  return { name: card.name, svg: svgOverride ?? card.svg, attributes: card.attributes, loading: card.loading, error: card.error }
}

export function TreeModal({ result, ids, onClose, dbMode }: TreeModalProps) {
  const { def, nodeA, nodeB, nodeC, nodeD, nodeL1a, nodeL1b, nodeAbcd } = result
  const [p0, p1, p2, p3] = def.indices
  // DB mode embeds token IDs directly; chain mode looks them up from the global ids[] array
  const [id0, id1, id2, id3] = def.tokenIds ?? [ids[p0], ids[p1], ids[p2], ids[p3]]

  // Lazy-load individual check SVGs (DB mode omits them from the grid query)
  const [liveSvgs, setLiveSvgs] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!supabase || nodeA.svg) return  // chain mode already has SVGs
    const tokenIds = [id0, id1, id2, id3].map(Number)
    supabase
      .from('tokenstr_checks')
      .select('token_id, svg')
      .in('token_id', tokenIds)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, string> = {}
        for (const row of data as { token_id: number; svg: string }[]) {
          map[String(row.token_id)] = row.svg
        }
        setLiveSvgs(map)
      })
  }, [nodeA.svg, id0, id1, id2, id3])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  // ── Buy all 4 (DB mode only) ───────────────────────────────────────────────
  const { isConnected } = useAccount()
  const tokenIdsBigInt = [id0, id1, id2, id3].map(BigInt)

  const { data: priceData } = useReadContracts({
    contracts: tokenIdsBigInt.map(tokenId => ({
      address: TOKEN_STRATEGY_ADDRESS,
      abi: tokenStrategyAbi,
      functionName: 'nftForSale' as const,
      args: [tokenId] as const,
    })),
    query: { enabled: !!dbMode },
  })

  const prices = priceData?.map(p => p.status === 'success' ? p.result as bigint : null) ?? []
  const allPricesLoaded = prices.length === 4 && prices.every(p => p !== null)
  const totalPrice = allPricesLoaded ? prices.reduce((sum, p) => sum! + p!, 0n) : null

  const { writeContractAsync } = useWriteContract()
  const [buyState, setBuyState] = useState<'idle' | 'buying' | 'done' | 'error'>('idle')
  const [buyIndex, setBuyIndex] = useState(0)

  async function handleBuyAll() {
    if (!allPricesLoaded || !isConnected) return
    setBuyState('buying')
    try {
      for (let i = 0; i < 4; i++) {
        setBuyIndex(i)
        const price = prices[i]!
        await writeContractAsync({
          address: TOKEN_STRATEGY_ADDRESS,
          abi: tokenStrategyAbi,
          functionName: 'sellTargetNFT',
          args: [price, tokenIdsBigInt[i]],
          value: price,
        })
      }
      setBuyState('done')
    } catch {
      setBuyState('error')
    }
  }

  function priceLabel(i: number): string | undefined {
    if (!dbMode || !prices[i]) return undefined
    return `${formatEther(prices[i]!)} ETH`
  }

  function buyLabel() {
    if (!dbMode) return null
    if (!allPricesLoaded) return 'Fetching prices…'
    if (!isConnected) return 'Connect wallet to buy'
    if (buyState === 'buying') return `Buying ${buyIndex + 1} / 4…`
    if (buyState === 'done') return 'Bought!'
    if (buyState === 'error') return 'Failed — try again'
    return `Buy All 4  (${formatEther(totalPrice!)} ETH)`
  }

  const buyDisabled =
    !dbMode ||
    !allPricesLoaded ||
    !isConnected ||
    buyState === 'buying' ||
    buyState === 'done'

  return (
    <div className="tree-modal-overlay" onClick={handleOverlayClick}>
      <div className="tree-modal">
        <button className="tree-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="tree-modal-title">{def.label}</div>
        <div className="tree-layout">
          <div className="tree-row">
            <div className="tree-pair">
              <CheckCard label={`Keeper #${id0}`} sublabel={priceLabel(0)} {...cardProps(nodeA, liveSvgs[id0])} />
              <CheckCard label={`Burn #${id1}`} sublabel={priceLabel(1)} {...cardProps(nodeB, liveSvgs[id1])} />
            </div>
            <div className="tree-pair">
              <CheckCard label={`Keeper #${id2}`} sublabel={priceLabel(2)} {...cardProps(nodeC, liveSvgs[id2])} />
              <CheckCard label={`Burn #${id3}`} sublabel={priceLabel(3)} {...cardProps(nodeD, liveSvgs[id3])} />
            </div>
          </div>
          <div className="tree-row tree-row-l1">
            <div className="tree-node-centered">
              <CheckCard label={`#${id0}+#${id1}`} {...cardProps(nodeL1a)} />
            </div>
            <div className="tree-node-centered">
              <CheckCard label={`#${id2}+#${id3}`} {...cardProps(nodeL1b)} />
            </div>
          </div>
          <div className="tree-row tree-row-l2">
            <div className="tree-node-centered">
              <CheckCard label="Final Composite" {...cardProps(nodeAbcd)} />
            </div>
          </div>
          {dbMode && (
            <div className="tree-buy-row">
              <button
                className={`tree-buy-btn${buyState === 'done' ? ' tree-buy-btn--done' : ''}${buyState === 'error' ? ' tree-buy-btn--error' : ''}`}
                onClick={handleBuyAll}
                disabled={buyDisabled}
              >
                {buyLabel()}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
