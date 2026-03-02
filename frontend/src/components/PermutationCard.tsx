// frontend/src/components/PermutationCard.tsx
import { useRef, useEffect, useState } from 'react'
import type { PermutationResult } from '../useAllPermutations'

export interface LikeInfo {
  isLiked: boolean
  likeCount?: number   // only passed on curated page
  alwaysShow?: boolean // curated page: show heart without hover
  onLike: () => void
}

interface PermutationCardProps {
  result: PermutationResult
  visible: boolean
  onClick: () => void
  likeInfo?: LikeInfo  // undefined = no wallet connected, hide heart
}

export function PermutationCard({ result, visible, onClick, likeInfo }: PermutationCardProps) {
  const { nodeAbcd } = result
  const cardRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect() } },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  if (!visible) {
    return <div className="perm-card-spacer" ref={cardRef} />
  }

  const svgReady = !nodeAbcd.loading && !nodeAbcd.error && inView && !!nodeAbcd.svg

  function handleHeartClick(e: React.MouseEvent) {
    e.stopPropagation()  // don't open TreePanel
    likeInfo?.onLike()
  }

  return (
    <div className="perm-card" ref={cardRef} onClick={onClick}>
      {!svgReady && !nodeAbcd.error && <div className="perm-card-pulse" />}
      {nodeAbcd.error && <div className="perm-card-error">✕</div>}
      {svgReady && (
        <div className="perm-card-svg" dangerouslySetInnerHTML={{ __html: nodeAbcd.svg }} />
      )}
      {likeInfo && (
        <div
          className={`perm-card-heart${likeInfo.alwaysShow ? ' perm-card-heart--always' : ''}${likeInfo.isLiked ? ' perm-card-heart--liked' : ''}`}
          onClick={handleHeartClick}
          role="button"
          aria-label={likeInfo.isLiked ? 'Unlike' : 'Like'}
          title={likeInfo.isLiked ? 'Unlike' : 'Like'}
        >
          {likeInfo.isLiked ? '♥' : '♡'}
          {likeInfo.likeCount !== undefined && (
            <span className="perm-card-heart-count">{likeInfo.likeCount}</span>
          )}
        </div>
      )}
    </div>
  )
}
