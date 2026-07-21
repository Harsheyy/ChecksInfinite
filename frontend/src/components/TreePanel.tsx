import { useEffect, useState } from 'react'
import { useAccount, useBalance, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatEther } from 'viem'
import { CheckCard } from './CheckCard'
import type { LikeInfo } from './PermutationCard'
import { supabase } from '../supabaseClient'
import { checksRecipeMinterAbi, CHECKS_RECIPE_MINTER_ADDRESS } from '../checksRecipeMinterAbi'
import { tokenStrategyAbi, TOKEN_STRATEGY_ADDRESS } from '../tokenStrategyAbi'
import { mapCheckAttributes } from '../utils'
import type { Attribute, CardState, CheckStruct } from '../utils'
import type { PermutationResult } from '../useAllPermutations'
import { generateSVGJS } from '../checksArtJS'
import { fromJSON } from '../usePermutationsDB'

interface TreePanelProps {
  result: PermutationResult
  ids: string[]
  onClose: () => void
  dbMode?: boolean
  hideBuy?: boolean
  likeInfo?: LikeInfo
  tokenPriceMap?: Map<string, bigint>
}

function cardProps(card: CardState, svgOverride?: string, attrsOverride?: Attribute[]) {
  return { name: card.name, svg: svgOverride ?? card.svg, attributes: attrsOverride ?? card.attributes, loading: card.loading, error: card.error }
}

export function TreePanel({ result, ids, onClose, dbMode, hideBuy, likeInfo, tokenPriceMap }: TreePanelProps) {
  const { def, nodeA, nodeB, nodeC, nodeD, nodeL1a, nodeL1b, nodeAbcd } = result
  const [p0, p1, p2, p3] = def.indices
  const [id0, id1, id2, id3] = def.tokenIds ?? [ids[p0], ids[p1], ids[p2], ids[p3]]

  // Lazy-load individual check SVGs + attributes (DB mode omits them from the grid query)
  const [liveSvgs, setLiveSvgs] = useState<Record<string, string>>({})
  const [liveAttrs, setLiveAttrs] = useState<Record<string, Attribute[]>>({})
  const isOpenSea = result.fromTokenWorks === false

  useEffect(() => {
    if (!supabase || !dbMode || nodeA.svg) return
    const tokenIds = [id0, id1, id2, id3].map(Number)
    supabase
      .from('all_checks')
      .select('token_id, svg, check_struct')
      .in('token_id', tokenIds)
      .then(({ data }) => {
        if (!data) return
        const svgMap: Record<string, string> = {}
        const attrsMap: Record<string, Attribute[]> = {}
        for (const row of data as { token_id: number; svg: string | null; check_struct: { seed: string } }[]) {
          const struct = { ...row.check_struct, seed: BigInt(row.check_struct.seed) } as CheckStruct
          // Market tokens have no stored SVG — generate from check_struct instead
          svgMap[String(row.token_id)] = row.svg || generateSVGJS(fromJSON(row.check_struct as Parameters<typeof fromJSON>[0]), new Map())
          attrsMap[String(row.token_id)] = mapCheckAttributes(struct)
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

  // ── Mint Recipe (DB mode only) ─────────────────────────────────────────────
  const { address, isConnected } = useAccount()
  const { data: balance } = useBalance({ address, query: { enabled: isConnected } })

  // Fetch individual token prices directly — 4 targeted reads, reliable regardless of App-level batch state
  const pricesEnabled = !!dbMode && result.fromTokenWorks !== false
  const { data: tokenPrices } = useReadContracts({
    contracts: [id0, id1, id2, id3].map(id => ({
      address: TOKEN_STRATEGY_ADDRESS,
      abi: tokenStrategyAbi,
      functionName: 'nftForSale' as const,
      args: [BigInt(id)] as const,
    })),
    query: { enabled: pricesEnabled },
  })

  const quoteEnabled = !!dbMode && !hideBuy && result.fromTokenWorks !== false && !!CHECKS_RECIPE_MINTER_ADDRESS
  const { data: quote, isLoading: quoteLoading } = useReadContract({
    address: CHECKS_RECIPE_MINTER_ADDRESS,
    abi: checksRecipeMinterAbi,
    functionName: 'quote',
    args: [BigInt(id0), BigInt(id1), BigInt(id2), BigInt(id3)],
    query: { enabled: quoteEnabled },
  })

  const totalCost = quote?.[0]
  const tokenCost = quote?.[1]

  function trimEth(wei: bigint): string {
    const s = formatEther(wei)
    const dot = s.indexOf('.')
    if (dot === -1) return s
    return s.slice(dot + 1).length <= 3 ? s : s.slice(0, dot + 4)
  }

  function osHref(tokenId: string) {
    if (!isOpenSea) return undefined
    return `https://opensea.io/assets/ethereum/0x036721e5a769cc48b3189efbb9cce4471e8a48b1/${tokenId}`
  }

  function priceLabel(tokenId: string, idx: number) {
    if (isOpenSea) {
      const ethPrice = result.tokenPrices?.[tokenId]
      return ethPrice != null ? `${parseFloat(ethPrice.toFixed(3))} ETH` : undefined
    }
    // tokenPriceMap from App.tsx is a fast-path (pre-fetched); local reads are the reliable fallback
    const p = tokenPriceMap?.get(tokenId) ?? (tokenPrices?.[idx]?.result as bigint | undefined)
    return p !== undefined && p > 0n ? `${trimEth(p)} ETH` : undefined
  }

  const { writeContract, data: txHash, isPending: isSigning } = useWriteContract()
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({ hash: txHash })

  function handleMint() {
    if (!totalCost || !CHECKS_RECIPE_MINTER_ADDRESS) return
    writeContract({
      address: CHECKS_RECIPE_MINTER_ADDRESS,
      abi: checksRecipeMinterAbi,
      functionName: 'mintRecipe',
      args: [BigInt(id0), BigInt(id1), BigInt(id2), BigInt(id3)],
      value: totalCost,
    })
  }

  const tokensNotListed = tokenCost !== undefined && tokenCost === 0n
  const insufficientBalance = isConnected && !!balance && !!totalCost && balance.value < totalCost
  const ethShortfall = insufficientBalance && balance && totalCost ? totalCost - balance.value : undefined

  const buttonLabel = (() => {
    if (!isConnected) return 'Connect wallet to mint'
    if (quoteLoading) return 'Loading price…'
    if (tokensNotListed) return 'Tokens not available'
    if (isSigning) return 'Confirm in wallet…'
    if (isMining) return 'Minting recipe…'
    if (isMined) return `✓ Minted ABCD #${id0}`
    if (totalCost) return `Mint Recipe (${trimEth(totalCost)} ETH)`
    return 'Mint Recipe'
  })()

  const buttonDisabled = !isConnected || quoteLoading || isSigning || isMining || isMined || !totalCost || tokensNotListed || insufficientBalance

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
        <div className="tree-panel-header-actions">
          {dbMode && !hideBuy && result.fromTokenWorks !== false && !!CHECKS_RECIPE_MINTER_ADDRESS && (
            <span className="tree-panel__mint-btn-wrap">
              <button
                className="tree-panel__mint-button"
                disabled={buttonDisabled}
                onClick={handleMint}
              >
                {buttonLabel}
              </button>
              <div className={`tree-panel__mint-tooltip${insufficientBalance ? ' tree-panel__mint-tooltip--warning' : ''}`}>
                {insufficientBalance && ethShortfall
                  ? `Need ${trimEth(ethShortfall)} more ETH`
                  : 'All minting includes a flat 0.005 ETH fee'}
              </div>
            </span>
          )}
          {isOpenSea && result.total_cost != null && result.total_cost > 0 && (
            <span className="tree-panel__cost-badge">
              Recipe cost: {result.total_cost.toFixed(3)} ETH
            </span>
          )}
          {likeInfo && (
            <span className={likeInfo.canLike === false ? 'tree-panel-like-wrap--no-connect' : undefined}>
            <button
              className={`tree-panel-like-btn${likeInfo.isLiked ? ' tree-panel-like-btn--liked' : ''}`}
              onClick={likeInfo.onLike}
              disabled={likeInfo.canLike === false}
              aria-label={likeInfo.canLike === false ? 'Connect wallet to curate' : likeInfo.isLiked ? 'Unlike' : 'Like'}
            >
              {likeInfo.isLiked ? '♥' : '♡'}
              {likeInfo.likeCount !== undefined && (
                <span className="tree-panel-like-count">{likeInfo.likeCount}</span>
              )}
            </button>
            </span>
          )}
          <button className="tree-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div className="tree-panel-body">
        <div className="tree-layout">
          {/* Row 0: two leaf pairs */}
          <div className="tree-row-leaves">
            <div className="tree-branch">
              <div className="tree-branch-pair">
                <CheckCard compact hideAttrs tooltip label="Keeper" sublabel={priceLabel(id0, 0)} href={osHref(id0)} {...cardProps(nodeA, liveSvgs[id0], liveAttrs[id0])} />
                <CheckCard compact hideAttrs tooltip label="Burn"   sublabel={priceLabel(id1, 1)} href={osHref(id1)} {...cardProps(nodeB, liveSvgs[id1], liveAttrs[id1])} />
              </div>
              <div className="tree-connector-v" />
              <CheckCard compact hideAttrs tooltip label="Composition" {...cardProps(nodeL1a)} />
              <div className="tree-connector-v" />
            </div>
            <div className="tree-branch">
              <div className="tree-branch-pair">
                <CheckCard compact hideAttrs tooltip label="Keeper" sublabel={priceLabel(id2, 2)} href={osHref(id2)} {...cardProps(nodeC, liveSvgs[id2], liveAttrs[id2])} />
                <CheckCard compact hideAttrs tooltip label="Burn"   sublabel={priceLabel(id3, 3)} href={osHref(id3)} {...cardProps(nodeD, liveSvgs[id3], liveAttrs[id3])} />
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

        {dbMode && !hideBuy && result.fromTokenWorks !== false && !!CHECKS_RECIPE_MINTER_ADDRESS && (
          <div className="tree-panel__mint">
            {isMined && txHash && (
              <a
                className="tree-panel__tx-link"
                href={`https://etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View on Etherscan ↗
              </a>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
