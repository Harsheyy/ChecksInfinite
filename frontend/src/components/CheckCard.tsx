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
  hideAttrs?: boolean
  tooltip?: boolean
}

export function CheckCard({ name, svg, attributes, loading, error, label, sublabel, compact, hideAttrs, tooltip }: CheckCardProps) {
  const displayAttrs = attributes.filter(a => a.trait_type !== 'Day')
  const visibleAttrs = compact
    ? displayAttrs.filter(a => COMPACT_ATTRS.includes(a.trait_type))
    : displayAttrs

  return (
    <div className={`check-card${tooltip ? ' check-card--has-tooltip' : ''}`}>
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
          {!hideAttrs && (
            <dl className="check-card-attrs">
              {visibleAttrs.map((attr) => (
                <div key={attr.trait_type} className="check-card-attr">
                  <dt>{attr.trait_type}</dt>
                  <dd>{attr.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {tooltip && displayAttrs.length > 0 && (
            <div className="check-card-tooltip">
              <dl className="check-card-attrs">
                {displayAttrs.map((attr) => (
                  <div key={attr.trait_type} className="check-card-attr">
                    <dt>{attr.trait_type}</dt>
                    <dd>{attr.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      )}
    </div>
  )
}
