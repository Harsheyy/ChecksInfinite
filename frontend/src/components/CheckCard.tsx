import type { Attribute } from '../utils'

interface CheckCardProps {
  name: string
  svg: string
  attributes: Attribute[]
  loading?: boolean
  error?: string
  label?: string
}

export function CheckCard({ name, svg, attributes, loading, error, label }: CheckCardProps) {
  return (
    <div className="check-card">
      {label && <div className="check-card-label">{label}</div>}
      {loading && <div className="check-card-loading">Loading…</div>}
      {error && <div className="check-card-error">{error}</div>}
      {!loading && !error && (
        <>
          <h2 className="check-card-name">{name}</h2>
          {svg && (
            <div
              className="check-card-svg"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
          <dl className="check-card-attrs">
            {attributes.map((attr) => (
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
