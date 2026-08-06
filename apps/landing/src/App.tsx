import { Footer } from '@checks-wiki/shared'

interface Tool {
  name: string
  /** Optional — an unreleased tool can be a name and nothing more. */
  description?: string
  href: string | null
  status: 'live' | 'coming-soon'
}

const TOOLS: Tool[] = [
  {
    name: 'Single Check Calculator',
    description: 'Find the cheapest way to acquire a single Check.',
    href: 'https://calc.checks.wiki',
    status: 'live',
  },
  {
    name: 'Permutation Browser',
    description: 'Browse every possible composite from the Checks VV collection.',
    href: 'https://explore.checks.wiki',
    status: 'live',
  },
  {
    name: 'Migration Predictor',
    description: 'Preview possible composite outcomes before migrating a Check.',
    href: null,
    status: 'coming-soon',
  },
  {
    name: 'Black Check Accelerator',
    description: 'Pool funds on a single Check and hold $BLKCHK for your share of the Black Check.',
    href: null,
    status: 'coming-soon',
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
            {/* Grouped so the blur on an unreleased tool veils the name and
              * description together and leaves the badge sharp — the badge is
              * the only thing this card is actually saying. */}
            <span className="landing-card-veil">
              <span className="landing-card-name">{tool.name}</span>
              {tool.description && (
                <span className="landing-card-desc">{tool.description}</span>
              )}
            </span>
            {tool.status === 'coming-soon' && <span className="landing-card-badge">Coming soon</span>}
          </a>
        ))}
      </div>
      <Footer />
    </div>
  )
}
