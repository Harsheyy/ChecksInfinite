import { useEffect, useState } from 'react'
import { CheckCard } from './CheckCard'
import { supabase } from '../supabaseClient'
import type { PermutationResult } from '../useAllPermutations'
import type { CardState } from '../utils'

interface TreeModalProps {
  result: PermutationResult
  ids: string[]
  onClose: () => void
}

function cardProps(card: CardState, svgOverride?: string) {
  return { name: card.name, svg: svgOverride ?? card.svg, attributes: card.attributes, loading: card.loading, error: card.error }
}

export function TreeModal({ result, ids, onClose }: TreeModalProps) {
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

  return (
    <div className="tree-modal-overlay" onClick={handleOverlayClick}>
      <div className="tree-modal">
        <button className="tree-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="tree-modal-title">{def.label}</div>
        <div className="tree-layout">
          <div className="tree-row">
            <div className="tree-pair">
              <CheckCard label={`Keeper #${id0}`} {...cardProps(nodeA, liveSvgs[id0])} />
              <CheckCard label={`Burn #${id1}`} {...cardProps(nodeB, liveSvgs[id1])} />
            </div>
            <div className="tree-pair">
              <CheckCard label={`Keeper #${id2}`} {...cardProps(nodeC, liveSvgs[id2])} />
              <CheckCard label={`Burn #${id3}`} {...cardProps(nodeD, liveSvgs[id3])} />
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
        </div>
      </div>
    </div>
  )
}
