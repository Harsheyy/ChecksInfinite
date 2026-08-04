interface SweepCalculatorProps {
  checksSweepCost: number | null
  editionsSweepCost: number | null
}

export function SweepCalculator({ checksSweepCost, editionsSweepCost }: SweepCalculatorProps) {
  return (
    <section className="checkmath-card">
      <h2>Sweep Calculator</h2>
      <p className="checkmath-card-desc">Cost of sweeping the 64 cheapest listed tokens, per collection</p>
      <div className="checkmath-sweep-row">
        <div className="checkmath-sweep-item">
          <span className="checkmath-sweep-label">Checks VV</span>
          <span className="checkmath-stat">{checksSweepCost !== null ? `${checksSweepCost.toFixed(3)} ETH` : 'N/A'}</span>
        </div>
        <div className="checkmath-sweep-item">
          <span className="checkmath-sweep-label">Checks Editions</span>
          <span className="checkmath-stat">{editionsSweepCost !== null ? `${editionsSweepCost.toFixed(3)} ETH` : 'N/A'}</span>
        </div>
      </div>
    </section>
  )
}
