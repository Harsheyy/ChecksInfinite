import { Footer } from '@checks-wiki/shared'

const TOOLS = [
  {
    name: 'Single Check Calculator',
    description: 'Find the cheapest way to acquire a single Check.',
    href: 'https://calc.checks.wiki',
    status: 'live' as const,
  },
  {
    name: 'Permutation Browser',
    description: 'Browse every possible composite from the Checks VV collection.',
    href: 'https://explore.checks.wiki',
    status: 'live' as const,
  },
  {
    name: 'Migration Predictor',
    description: 'Preview possible composite outcomes before migrating a Check.',
    href: null,
    status: 'coming-soon' as const,
  },
]

export default function App() {
  return (
    <div className="landing">
      <header className="landing-header">
        <img src="/checks-icon.svg" alt="" className="landing-icon" />
        <h1>Checks Wiki</h1>
        <p className="landing-tagline">Tools for the Checks VV collection.</p>
      </header>
      <div className="landing-cards">
        {TOOLS.map(tool => (
          <a
            key={tool.name}
            href={tool.href ?? undefined}
            className={`landing-card${tool.status === 'coming-soon' ? ' disabled' : ''}`}
            aria-disabled={tool.status === 'coming-soon'}
          >
            <span className="landing-card-name">{tool.name}</span>
            <span className="landing-card-desc">{tool.description}</span>
            {tool.status === 'coming-soon' && <span className="landing-card-badge">Coming soon</span>}
          </a>
        ))}
      </div>
      <Footer />
    </div>
  )
}
