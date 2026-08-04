interface SweepCalculatorProps {
  checksSweepCost: number | null
  checksSweepCount: number
  editionsSweepCost: number | null
  editionsSweepCount: number
  tokenworksSweepCost: number | null
  tokenworksSweepCount: number
}

export function SweepCalculator({
  checksSweepCost,
  checksSweepCount,
  editionsSweepCost,
  editionsSweepCount,
  tokenworksSweepCost,
  tokenworksSweepCount,
}: SweepCalculatorProps) {
  return (
    <section className="checkmath-card">
      <h2>Sweep Calculator</h2>
      <p className="checkmath-card-desc">Cost of sweeping the cheapest listed tokens, per collection (up to 64)</p>
      <div className="checkmath-sweep-row">
        <div className="checkmath-sweep-item">
          <span className="checkmath-sweep-label">Checks VV ({checksSweepCount}/64 listed)</span>
          <span className="checkmath-stat">{checksSweepCost !== null ? `${checksSweepCost.toFixed(3)} ETH` : 'N/A'}</span>
        </div>
        <div className="checkmath-sweep-item">
          <span className="checkmath-sweep-label">Checks Editions ({editionsSweepCount}/64 listed)</span>
          <span className="checkmath-stat">{editionsSweepCost !== null ? `${editionsSweepCost.toFixed(3)} ETH` : 'N/A'}</span>
        </div>
        <div className="checkmath-sweep-item">
          <span className="checkmath-sweep-label">Token Works ({tokenworksSweepCount}/64 listed)</span>
          <span className="checkmath-stat">{tokenworksSweepCost !== null ? `${tokenworksSweepCost.toFixed(3)} ETH` : 'N/A'}</span>
        </div>
      </div>
    </section>
  )
}
