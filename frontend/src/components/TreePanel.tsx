import { useEffect, useMemo, useState } from 'react'
import { useAccount, useReadContracts, useWriteContract } from 'wagmi'
import { formatEther } from 'viem'
import { CheckCard } from './CheckCard'
import { supabase } from '../supabaseClient'
import { tokenStrategyAbi, TOKEN_STRATEGY_ADDRESS } from '../tokenStrategyAbi'
import { mapCheckAttributes } from '../utils'
import type { Attribute, CardState, CheckStruct } from '../utils'
import type { PermutationResult } from '../useAllPermutations'

interface TreePanelProps {
  result: PermutationResult
  ids: string[]
  onClose: () => void
  dbMode?: boolean
  hideBuy?: boolean
}

function cardProps(card: CardState, svgOverride?: string, attrsOverride?: Attribute[]) {
  return { name: card.name, svg: svgOverride ?? card.svg, attributes: attrsOverride ?? card.attributes, loading: card.loading, error: card.error }
}

export function TreePanel({ result, ids, onClose, dbMode, hideBuy }: TreePanelProps) {
  const { def, nodeA, nodeB, nodeC, nodeD, nodeL1a, nodeL1b, nodeAbcd } = result
  const [p0, p1, p2, p3] = def.indices
  const [id0, id1, id2, id3] = def.tokenIds ?? [ids[p0], ids[p1], ids[p2], ids[p3]]

  // Lazy-load individual check SVGs + attributes (DB mode omits them from the grid query)
  const [liveSvgs, setLiveSvgs] = useState<Record<string, string>>({})
  const [liveAttrs, setLiveAttrs] = useState<Record<string, Attribute[]>>({})
  useEffect(() => {
    if (!supabase || !dbMode || nodeA.svg) return
    const tokenIds = [id0, id1, id2, id3].map(Number)
    supabase
      .from('tokenstr_checks')
      .select('token_id, svg, check_struct')
      .in('token_id', tokenIds)
      .then(({ data }) => {
        if (!data) return
        const svgMap: Record<string, string> = {}
        const attrsMap: Record<string, Attribute[]> = {}
        for (const row of data as { token_id: number; svg: string; check_struct: { seed: string } }[]) {
          svgMap[String(row.token_id)] = row.svg
          attrsMap[String(row.token_id)] = mapCheckAttributes(
            { ...row.check_struct, seed: BigInt(row.check_struct.seed) } as CheckStruct
          )
        }
        setLiveSvgs(svgMap)
        setLiveAttrs(attrsMap)
      })
  }, [nodeA.svg, id0, id1, id2, id3])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // ── Buy all 4 (DB mode only) ───────────────────────────────────────────────
  const { address, isConnected } = useAccount()
  const tokenIdsBigInt = useMemo(
    () => [id0, id1, id2, id3].map(BigInt),
    [id0, id1, id2, id3]
  )

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
    setBuyIndex(0)
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
      if (supabase && address && totalPrice !== null) {
        supabase.rpc('log_wallet_purchase', {
          p_address: address.toLowerCase(),
          p_spent_eth: parseFloat(formatEther(totalPrice)),
          p_checks_count: 4,
        }).then(() => {}, err => console.warn('[analytics] log_wallet_purchase failed:', err))
      }
    } catch {
      setBuyState('error')
    }
  }

  function priceLabel(i: number): string | undefined {
    if (!dbMode || hideBuy || prices[i] == null) return undefined
    return `${parseFloat(formatEther(prices[i]!)).toFixed(3)} ETH`
  }

  function buyLabel() {
    if (!dbMode) return null
    if (!allPricesLoaded) return 'Fetching prices…'
    if (!isConnected) return 'Connect wallet to buy'
    if (buyState === 'buying') return `Buying ${buyIndex + 1} / 4…`
    if (buyState === 'done') return 'Bought!'
    if (buyState === 'error') return 'Failed — try again'
    return `Buy All 4  (${parseFloat(formatEther(totalPrice!)).toFixed(3)} ETH)`
  }

  const buyDisabled =
    !dbMode ||
    !allPricesLoaded ||
    !isConnected ||
    buyState === 'buying' ||
    buyState === 'done'

  return (
    <div className="tree-panel">
      <div className="tree-panel-header">
        <div className="tree-panel-header-content">
          <span className="tree-panel-header-label">Recipe</span>
          <div className="tree-panel-header-ids">
            <span className="tree-panel-id-chip">#{id0}</span>
            <span className="tree-panel-id-chip">#{id1}</span>
            <span className="tree-panel-header-sep">+</span>
            <span className="tree-panel-id-chip">#{id2}</span>
            <span className="tree-panel-id-chip">#{id3}</span>
          </div>
        </div>
        <button className="tree-panel-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="tree-panel-body">
        <div className="tree-layout">
          {/* Row 0: two leaf pairs */}
          <div className="tree-row-leaves">
            <div className="tree-branch">
              <div className="tree-branch-pair">
                <CheckCard compact hideAttrs tooltip label="Keeper" sublabel={priceLabel(0)} {...cardProps(nodeA, liveSvgs[id0], liveAttrs[id0])} />
                <CheckCard compact hideAttrs tooltip label="Burn"   sublabel={priceLabel(1)} {...cardProps(nodeB, liveSvgs[id1], liveAttrs[id1])} />
              </div>
              <div className="tree-connector-v" />
              <CheckCard compact hideAttrs tooltip label="Composition" {...cardProps(nodeL1a)} />
              <div className="tree-connector-v" />
            </div>
            <div className="tree-branch">
              <div className="tree-branch-pair">
                <CheckCard compact hideAttrs tooltip label="Keeper" sublabel={priceLabel(2)} {...cardProps(nodeC, liveSvgs[id2], liveAttrs[id2])} />
                <CheckCard compact hideAttrs tooltip label="Burn"   sublabel={priceLabel(3)} {...cardProps(nodeD, liveSvgs[id3], liveAttrs[id3])} />
              </div>
              <div className="tree-connector-v" />
              <CheckCard compact hideAttrs tooltip label="Composition" {...cardProps(nodeL1b)} />
              <div className="tree-connector-v" />
            </div>
          </div>

          {/* Horizontal merge connector */}
          <div className="tree-connector-merge" />

          {/* Final result — attributes in hover tooltip */}
          <CheckCard label="Final Composite" {...cardProps(nodeAbcd)} />
        </div>

        {dbMode && !hideBuy && (
          <div className="tree-panel-footer">
            <button
              className={`tree-buy-btn${buyState === 'done' ? ' tree-buy-btn--done' : ''}${buyState === 'error' ? ' tree-buy-btn--error' : ''}`}
              onClick={handleBuyAll}
              disabled={buyDisabled}
              aria-label="Buy"
            >
              {buyLabel()}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
