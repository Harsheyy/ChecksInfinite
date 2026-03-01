// frontend/src/components/PermutationCard.tsx
import { useRef, useEffect, useState } from 'react'
import type { PermutationResult } from '../useAllPermutations'

interface PermutationCardProps {
  result: PermutationResult
  visible: boolean
  onClick: () => void
}

export function PermutationCard({ result, visible, onClick }: PermutationCardProps) {
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
  }, [visible])  // re-attach when visible changes (spacer → real card transition)

  if (!visible) {
    // Transparent spacer: preserves grid layout without rendering anything visible
    return <div className="perm-card-spacer" ref={cardRef} />
  }

  const svgReady = !nodeAbcd.loading && !nodeAbcd.error && inView && !!nodeAbcd.svg

  return (
    <div className="perm-card" ref={cardRef} onClick={onClick}>
      {!svgReady && !nodeAbcd.error && <div className="perm-card-pulse" />}
      {nodeAbcd.error && <div className="perm-card-error">✕</div>}
      {svgReady && (
        <div className="perm-card-svg" dangerouslySetInnerHTML={{ __html: nodeAbcd.svg }} />
      )}
    </div>
  )
}
