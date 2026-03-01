import type { Attribute } from '../utils'

const COMPACT_ATTRS = ['Checks', 'Color Band']

interface CheckCardProps {
  name: string
  svg: string
  attributes: Attribute[]
  loading?: boolean
  error?: string
  label?: string
  sublabel?: string
  compact?: boolean
}

export function CheckCard({ name, svg, attributes, loading, error, label, sublabel, compact }: CheckCardProps) {
  const visibleAttrs = compact
    ? attributes.filter(a => COMPACT_ATTRS.includes(a.trait_type))
    : attributes

  return (
    <div className="check-card">
      {(label || sublabel) && (
        <div className="check-card-label-row">
          {label && <span className="check-card-label">{label}</span>}
          {sublabel && <span className="check-card-sublabel">{sublabel}</span>}
        </div>
      )}
      {loading && <div className="check-card-loading">Loading…</div>}
      {error && <div className="check-card-error">{error}</div>}
      {!loading && !error && (
        <>
          <h2 className="check-card-name">{name}</h2>
          {svg && (
            <div className="check-card-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
          <dl className="check-card-attrs">
            {visibleAttrs.map((attr) => (
              <div key={attr.trait_type} className="check-card-attr">
                <dt>{attr.trait_type}</dt>
                <dd>{attr.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  )
}
