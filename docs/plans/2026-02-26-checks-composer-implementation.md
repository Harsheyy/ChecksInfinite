# Checks Composer Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React + Vite SPA that lets users preview the result of compositing two Checks Originals NFTs by entering their token IDs, reading live data from the deployed on-chain contract.

**Architecture:** Single-page app with no router. `viem` reads the Checks Originals contract (read-only, no wallet). `tokenURI` is decoded for input tokens, `simulateCompositeSVG` + `simulateComposite` power the preview. Three panels: left token, center composite result, right token.

**Tech Stack:** React 18, Vite, TypeScript, viem, vitest, @testing-library/react

---

## Reference: Key Solidity Facts

These constants come directly from the Solidity source — do not change them:

```ts
// From ChecksArt.DIVISORS()
const DIVISORS = [80, 40, 20, 10, 5, 4, 1, 0]; // indexed 0-7

// From ChecksMetadata.colorBand()
const COLOR_BAND_NAMES = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One'];

// From ChecksMetadata.gradients()
const GRADIENT_NAMES = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z'];
```

Contract address: `0x036721e5a769cc48b3189efbb9cce4471e8a48b1` (Ethereum Mainnet)

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `.env.example`

**Step 1: Scaffold the Vite project**

From `/Users/harsh/Desktop/Experiments/Infinite`:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install viem
npm install -D vitest @testing-library/react @testing-library/jest-dom @vitejs/plugin-react jsdom
```

**Step 2: Configure vitest in `frontend/vite.config.ts`**

Replace the default content with:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
})
```

**Step 3: Create `frontend/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom'
```

**Step 4: Add test script to `frontend/package.json`**

Ensure `scripts` contains:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 5: Create `.env.example`**

```
VITE_ALCHEMY_API_KEY=your_alchemy_api_key_here
```

**Step 6: Verify the dev server runs**

```bash
cd frontend && npm run dev
```
Expected: Server starts on `http://localhost:5173`

**Step 7: Commit**

```bash
cd frontend
git add -A
git commit -m "feat: scaffold React + Vite + viem project"
```

---

## Task 2: Contract ABI and viem Client

**Files:**
- Create: `frontend/src/checksAbi.ts`
- Create: `frontend/src/client.ts`

**Step 1: Create `frontend/src/checksAbi.ts`**

This is the minimal ABI for only the functions we call. The `Check` and `StoredCheck` struct shapes come from `IChecks.sol`.

```ts
export const CHECKS_ABI = [
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'simulateCompositeSVG',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'burnId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'simulateComposite',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'burnId', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'check',
        type: 'tuple',
        components: [
          {
            name: 'stored',
            type: 'tuple',
            components: [
              { name: 'composites', type: 'uint16[6]' },
              { name: 'colorBands', type: 'uint8[5]' },
              { name: 'gradients', type: 'uint8[5]' },
              { name: 'divisorIndex', type: 'uint8' },
              { name: 'epoch', type: 'uint32' },
              { name: 'seed', type: 'uint16' },
              { name: 'day', type: 'uint24' },
            ],
          },
          { name: 'isRevealed', type: 'bool' },
          { name: 'seed', type: 'uint256' },
          { name: 'checksCount', type: 'uint8' },
          { name: 'hasManyChecks', type: 'bool' },
          { name: 'composite', type: 'uint16' },
          { name: 'isRoot', type: 'bool' },
          { name: 'colorBand', type: 'uint8' },
          { name: 'gradient', type: 'uint8' },
          { name: 'direction', type: 'uint8' },
          { name: 'speed', type: 'uint8' },
        ],
      },
    ],
  },
] as const
```

**Step 2: Create `frontend/src/client.ts`**

```ts
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

export const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1' as const

export function createChecksClient(alchemyKey: string) {
  return createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`),
  })
}
```

**Step 3: Commit**

```bash
git add src/checksAbi.ts src/client.ts
git commit -m "feat: add checks contract ABI and viem client factory"
```

---

## Task 3: Utility Functions (with tests)

**Files:**
- Create: `frontend/src/utils.ts`
- Create: `frontend/src/utils.test.ts`

These pure functions transform raw contract data into display-ready values. Test them first.

**Step 1: Write the failing tests in `frontend/src/utils.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  parseTokenURI,
  mapCheckAttributes,
  formatSpeed,
  formatShift,
  colorBandName,
  gradientName,
} from './utils'

describe('parseTokenURI', () => {
  it('decodes a base64 data URI and returns name, image SVG, and attributes', () => {
    const fakePayload = {
      name: 'Checks 42',
      description: 'desc',
      image: 'data:image/svg+xml;base64,' + btoa('<svg>test</svg>'),
      animation_url: 'data:text/html;base64,' + btoa('<html/>'),
      attributes: [
        { trait_type: 'Checks', value: '80' },
        { trait_type: 'Color Band', value: 'Sixty' },
      ],
    }
    const encoded =
      'data:application/json;base64,' + btoa(JSON.stringify(fakePayload))

    const result = parseTokenURI(encoded)
    expect(result.name).toBe('Checks 42')
    expect(result.svg).toBe('<svg>test</svg>')
    expect(result.attributes).toEqual([
      { trait_type: 'Checks', value: '80' },
      { trait_type: 'Color Band', value: 'Sixty' },
    ])
  })
})

describe('colorBandName', () => {
  it('maps index 0 to Eighty', () => expect(colorBandName(0)).toBe('Eighty'))
  it('maps index 1 to Sixty',  () => expect(colorBandName(1)).toBe('Sixty'))
  it('maps index 6 to One',    () => expect(colorBandName(6)).toBe('One'))
})

describe('gradientName', () => {
  it('maps index 0 to None',   () => expect(gradientName(0)).toBe('None'))
  it('maps index 1 to Linear', () => expect(gradientName(1)).toBe('Linear'))
  it('maps index 6 to Linear Z', () => expect(gradientName(6)).toBe('Linear Z'))
})

describe('formatSpeed', () => {
  it('returns 2x for speed 4', () => expect(formatSpeed(4)).toBe('2x'))
  it('returns 1x for speed 2', () => expect(formatSpeed(2)).toBe('1x'))
  it('returns 0.5x for speed 1', () => expect(formatSpeed(1)).toBe('0.5x'))
})

describe('formatShift', () => {
  it('returns IR for direction 0', () => expect(formatShift(0)).toBe('IR'))
  it('returns UV for direction 1', () => expect(formatShift(1)).toBe('UV'))
})

describe('mapCheckAttributes', () => {
  it('maps a Check struct to display attributes', () => {
    const mockCheck = {
      stored: {
        composites: [0, 0, 0, 0, 0, 0],
        colorBands: [0, 0, 0, 0, 0],
        gradients: [0, 0, 0, 0, 0],
        divisorIndex: 1,
        epoch: 1,
        seed: 42,
        day: 5,
      },
      isRevealed: true,
      seed: BigInt(12345),
      checksCount: 40,
      hasManyChecks: true,
      composite: 0,
      isRoot: false,
      colorBand: 2,
      gradient: 1,
      direction: 0,
      speed: 2,
    }

    const attrs = mapCheckAttributes(mockCheck)
    expect(attrs).toContainEqual({ trait_type: 'Checks', value: '40' })
    expect(attrs).toContainEqual({ trait_type: 'Color Band', value: 'Forty' })
    expect(attrs).toContainEqual({ trait_type: 'Gradient', value: 'Linear' })
    expect(attrs).toContainEqual({ trait_type: 'Speed', value: '1x' })
    expect(attrs).toContainEqual({ trait_type: 'Shift', value: 'IR' })
  })
})
```

**Step 2: Run tests — verify they fail**

```bash
cd frontend && npm test
```
Expected: multiple failures with "cannot find module './utils'"

**Step 3: Implement `frontend/src/utils.ts`**

```ts
// Attribute name arrays mirror the Solidity source exactly.
// Source: ChecksMetadata.colorBand() and ChecksMetadata.gradients()
const COLOR_BAND_NAMES = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One'] as const
const GRADIENT_NAMES = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z'] as const

export interface Attribute {
  trait_type: string
  value: string
}

export interface ParsedTokenURI {
  name: string
  svg: string
  attributes: Attribute[]
}

// CheckStruct shape as returned by viem from the simulateComposite ABI
export interface CheckStruct {
  stored: {
    composites: readonly number[]
    colorBands: readonly number[]
    gradients: readonly number[]
    divisorIndex: number
    epoch: number
    seed: number
    day: number
  }
  isRevealed: boolean
  seed: bigint
  checksCount: number
  hasManyChecks: boolean
  composite: number
  isRoot: boolean
  colorBand: number
  gradient: number
  direction: number
  speed: number
}

export function colorBandName(index: number): string {
  return COLOR_BAND_NAMES[index] ?? 'Unknown'
}

export function gradientName(index: number): string {
  return GRADIENT_NAMES[index] ?? 'Unknown'
}

export function formatSpeed(speed: number): string {
  return speed === 4 ? '2x' : speed === 2 ? '1x' : '0.5x'
}

export function formatShift(direction: number): string {
  return direction === 0 ? 'IR' : 'UV'
}

export function parseTokenURI(dataUri: string): ParsedTokenURI {
  // Strip the "data:application/json;base64," prefix
  const base64 = dataUri.replace(/^data:application\/json;base64,/, '')
  const json = JSON.parse(atob(base64))

  // Strip the "data:image/svg+xml;base64," prefix from the image field
  const svgBase64 = json.image.replace(/^data:image\/svg\+xml;base64,/, '')
  const svg = atob(svgBase64)

  return {
    name: json.name,
    svg,
    attributes: json.attributes ?? [],
  }
}

export function mapCheckAttributes(check: CheckStruct): Attribute[] {
  const attrs: Attribute[] = []

  if (check.isRevealed && check.hasManyChecks) {
    attrs.push({ trait_type: 'Color Band', value: colorBandName(check.colorBand) })
    attrs.push({ trait_type: 'Gradient', value: gradientName(check.gradient) })
  }
  if (check.isRevealed && check.checksCount > 0) {
    attrs.push({ trait_type: 'Speed', value: formatSpeed(check.speed) })
    attrs.push({ trait_type: 'Shift', value: formatShift(check.direction) })
  }
  attrs.push({ trait_type: 'Checks', value: String(check.checksCount) })
  attrs.push({ trait_type: 'Day', value: String(check.stored.day) })

  return attrs
}
```

**Step 4: Run tests — verify they pass**

```bash
cd frontend && npm test
```
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/utils.ts src/utils.test.ts
git commit -m "feat: add attribute mapping utilities with tests"
```

---

## Task 4: InputPanel Component

**Files:**
- Create: `frontend/src/components/InputPanel.tsx`

No test for this component — it's a simple controlled form with no logic.

**Step 1: Create `frontend/src/components/InputPanel.tsx`**

```tsx
interface InputPanelProps {
  alchemyKey: string
  tokenId: string
  burnId: string
  loading: boolean
  onAlchemyKeyChange: (v: string) => void
  onTokenIdChange: (v: string) => void
  onBurnIdChange: (v: string) => void
  onPreview: () => void
}

export function InputPanel({
  alchemyKey,
  tokenId,
  burnId,
  loading,
  onAlchemyKeyChange,
  onTokenIdChange,
  onBurnIdChange,
  onPreview,
}: InputPanelProps) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onPreview()
  }

  return (
    <form onSubmit={handleSubmit} className="input-panel">
      <div className="input-row">
        <label>
          Alchemy Key
          <input
            type="password"
            placeholder="your_alchemy_key"
            value={alchemyKey}
            onChange={(e) => onAlchemyKeyChange(e.target.value)}
            required
          />
        </label>
        <label>
          Token ID
          <input
            type="number"
            placeholder="e.g. 1234"
            min="0"
            value={tokenId}
            onChange={(e) => onTokenIdChange(e.target.value)}
            required
          />
        </label>
        <label>
          Burn ID
          <input
            type="number"
            placeholder="e.g. 5678"
            min="0"
            value={burnId}
            onChange={(e) => onBurnIdChange(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Preview →'}
        </button>
      </div>
    </form>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/InputPanel.tsx
git commit -m "feat: add InputPanel form component"
```

---

## Task 5: CheckCard Component

**Files:**
- Create: `frontend/src/components/CheckCard.tsx`
- Create: `frontend/src/components/CheckCard.test.tsx`

**Step 1: Write failing test in `frontend/src/components/CheckCard.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CheckCard } from './CheckCard'

describe('CheckCard', () => {
  const attrs = [
    { trait_type: 'Checks', value: '80' },
    { trait_type: 'Color Band', value: 'Sixty' },
  ]

  it('renders the token name', () => {
    render(<CheckCard name="Checks 42" svg="<svg/>" attributes={attrs} />)
    expect(screen.getByText('Checks 42')).toBeInTheDocument()
  })

  it('renders all attribute labels and values', () => {
    render(<CheckCard name="Checks 42" svg="<svg/>" attributes={attrs} />)
    expect(screen.getByText('Checks')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('Color Band')).toBeInTheDocument()
    expect(screen.getByText('Sixty')).toBeInTheDocument()
  })

  it('shows loading state when loading=true', () => {
    render(<CheckCard name="" svg="" attributes={[]} loading />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows error message when error is provided', () => {
    render(<CheckCard name="" svg="" attributes={[]} error="Token not found" />)
    expect(screen.getByText('Token not found')).toBeInTheDocument()
  })
})
```

**Step 2: Run tests — verify they fail**

```bash
cd frontend && npm test
```
Expected: FAIL "cannot find module './CheckCard'"

**Step 3: Implement `frontend/src/components/CheckCard.tsx`**

```tsx
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
```

**Step 4: Run tests — verify they pass**

```bash
cd frontend && npm test
```
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/components/CheckCard.tsx src/components/CheckCard.test.tsx
git commit -m "feat: add CheckCard component with tests"
```

---

## Task 6: useComposite Hook

**Files:**
- Create: `frontend/src/useComposite.ts`

This hook owns all contract-reading logic. Keeping it separate from components makes it easy to test and swap.

**Step 1: Create `frontend/src/useComposite.ts`**

```ts
import { useState } from 'react'
import { createChecksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import { parseTokenURI, mapCheckAttributes, type ParsedTokenURI, type Attribute } from './utils'

export interface CompositeState {
  tokenA: (ParsedTokenURI & { loading: boolean; error: string }) | null
  tokenB: (ParsedTokenURI & { loading: boolean; error: string }) | null
  composite: {
    svg: string
    attributes: Attribute[]
    loading: boolean
    error: string
  } | null
}

export function useComposite() {
  const [state, setState] = useState<CompositeState>({
    tokenA: null,
    tokenB: null,
    composite: null,
  })

  async function preview(alchemyKey: string, tokenId: string, burnId: string) {
    const idA = BigInt(tokenId)
    const idB = BigInt(burnId)

    // Reset to loading state
    setState({
      tokenA: { name: '', svg: '', attributes: [], loading: true, error: '' },
      tokenB: { name: '', svg: '', attributes: [], loading: true, error: '' },
      composite: { svg: '', attributes: [], loading: true, error: '' },
    })

    const client = createChecksClient(alchemyKey)

    // Fire all reads in parallel
    const [uriA, uriB, compositeSVG, compositeCheck] = await Promise.allSettled([
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [idA] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [idB] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateCompositeSVG', args: [idA, idB] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateComposite', args: [idA, idB] }),
    ])

    setState({
      tokenA: resolveTokenURI(uriA),
      tokenB: resolveTokenURI(uriB),
      composite: resolveComposite(compositeSVG, compositeCheck),
    })
  }

  return { state, preview }
}

function resolveTokenURI(
  result: PromiseSettledResult<string>
): ParsedTokenURI & { loading: boolean; error: string } {
  if (result.status === 'fulfilled') {
    try {
      return { ...parseTokenURI(result.value), loading: false, error: '' }
    } catch {
      return { name: '', svg: '', attributes: [], loading: false, error: 'Failed to parse token data' }
    }
  }
  return {
    name: '',
    svg: '',
    attributes: [],
    loading: false,
    error: humanizeError(result.reason),
  }
}

function resolveComposite(
  svgResult: PromiseSettledResult<string>,
  checkResult: PromiseSettledResult<unknown>
): { svg: string; attributes: Attribute[]; loading: boolean; error: string } {
  if (svgResult.status === 'fulfilled' && checkResult.status === 'fulfilled') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attrs = mapCheckAttributes(checkResult.value as any)
      return { svg: svgResult.value, attributes: attrs, loading: false, error: '' }
    } catch {
      return { svg: '', attributes: [], loading: false, error: 'Failed to build composite preview' }
    }
  }
  const reason =
    svgResult.status === 'rejected' ? svgResult.reason : (checkResult as PromiseRejectedResult).reason
  return { svg: '', attributes: [], loading: false, error: humanizeError(reason) }
}

function humanizeError(err: unknown): string {
  const msg = String(err)
  if (msg.includes('NotAllowed')) return 'Tokens must have the same check count, be different, and exist on-chain.'
  if (msg.includes('revert')) return 'Contract reverted — tokens may not exist or may be incompatible.'
  if (msg.includes('network') || msg.includes('fetch')) return 'Network error — check your Alchemy key.'
  return 'Something went wrong. Check the token IDs and try again.'
}
```

**Step 2: Commit**

```bash
git add src/useComposite.ts
git commit -m "feat: add useComposite hook for contract reads"
```

---

## Task 7: App Integration

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`

**Step 1: Replace `frontend/src/App.tsx`**

```tsx
import { useState } from 'react'
import { InputPanel } from './components/InputPanel'
import { CheckCard } from './components/CheckCard'
import { useComposite } from './useComposite'

export default function App() {
  const [alchemyKey, setAlchemyKey] = useState(import.meta.env.VITE_ALCHEMY_API_KEY ?? '')
  const [tokenId, setTokenId] = useState('')
  const [burnId, setBurnId] = useState('')
  const [validationError, setValidationError] = useState('')

  const { state, preview } = useComposite()

  const isLoading = !!(
    state.tokenA?.loading ||
    state.tokenB?.loading ||
    state.composite?.loading
  )

  function handlePreview() {
    setValidationError('')

    if (!alchemyKey.trim()) {
      setValidationError('Please enter an Alchemy API key.')
      return
    }
    if (!tokenId || !burnId) {
      setValidationError('Please enter both Token ID and Burn ID.')
      return
    }
    if (tokenId === burnId) {
      setValidationError('Token ID and Burn ID must be different.')
      return
    }

    preview(alchemyKey, tokenId, burnId)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>◆ Checks Composer</h1>
        <p>Preview what two Checks look like when composited together.</p>
      </header>

      <InputPanel
        alchemyKey={alchemyKey}
        tokenId={tokenId}
        burnId={burnId}
        loading={isLoading}
        onAlchemyKeyChange={setAlchemyKey}
        onTokenIdChange={setTokenId}
        onBurnIdChange={setBurnId}
        onPreview={handlePreview}
      />

      {validationError && (
        <div className="validation-error">{validationError}</div>
      )}

      {state.tokenA !== null && (
        <div className="panels">
          <CheckCard
            label={`Token #${tokenId}`}
            name={state.tokenA.name}
            svg={state.tokenA.svg}
            attributes={state.tokenA.attributes}
            loading={state.tokenA.loading}
            error={state.tokenA.error}
          />

          <div className="composite-arrow">→</div>

          <CheckCard
            label="Composite Result"
            name="Simulated Composite"
            svg={state.composite?.svg ?? ''}
            attributes={state.composite?.attributes ?? []}
            loading={state.composite?.loading}
            error={state.composite?.error}
          />

          <div className="composite-arrow">←</div>

          <CheckCard
            label={`Burn #${burnId}`}
            name={state.tokenB?.name ?? ''}
            svg={state.tokenB?.svg ?? ''}
            attributes={state.tokenB?.attributes ?? []}
            loading={state.tokenB?.loading}
            error={state.tokenB?.error}
          />
        </div>
      )}
    </div>
  )
}
```

**Step 2: Run all tests — verify still green**

```bash
cd frontend && npm test
```
Expected: All PASS

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up App with InputPanel, CheckCard panels, and useComposite"
```

---

## Task 8: Styling

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Replace `frontend/src/index.css` with the following**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Courier New', Courier, monospace;
  background: #111;
  color: #eee;
  min-height: 100vh;
}

.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.app-header h1 { font-size: 1.5rem; letter-spacing: 0.05em; }
.app-header p  { color: #888; margin-top: 0.25rem; font-size: 0.85rem; }

/* Input panel */
.input-panel { background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 1.25rem; }

.input-row {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.input-row label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.input-row input {
  background: #111;
  border: 1px solid #444;
  border-radius: 3px;
  color: #eee;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.9rem;
  width: 180px;
}
.input-row input:focus { outline: 1px solid #888; }

.input-row button {
  background: #eee;
  color: #111;
  border: none;
  border-radius: 3px;
  padding: 0.55rem 1.25rem;
  font-family: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  font-weight: bold;
  height: 36px;
}
.input-row button:disabled { opacity: 0.4; cursor: not-allowed; }
.input-row button:hover:not(:disabled) { background: #fff; }

.validation-error {
  color: #f87171;
  font-size: 0.85rem;
  padding: 0.5rem 0;
}

/* Three-panel layout */
.panels {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  gap: 1rem;
  align-items: start;
}

.composite-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 1.5rem;
  padding-top: 3rem;
}

/* Check card */
.check-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.check-card-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #666;
}

.check-card-name {
  font-size: 0.95rem;
  color: #ccc;
  font-weight: normal;
}

.check-card-svg svg {
  width: 100%;
  height: auto;
  display: block;
}

.check-card-attrs {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.check-card-attr {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
}
.check-card-attr dt { color: #666; }
.check-card-attr dd { color: #ddd; }

.check-card-loading { color: #666; font-size: 0.85rem; }
.check-card-error   { color: #f87171; font-size: 0.82rem; line-height: 1.4; }

@media (max-width: 768px) {
  .panels { grid-template-columns: 1fr; }
  .composite-arrow { display: none; }
}
```

**Step 2: Verify the app visually**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173`. Enter a valid Alchemy key and two real Checks token IDs (e.g., `1` and `2`). Verify:
- Both token SVGs load
- The composite SVG appears in the center
- Attributes render correctly in all three panels
- Error states render when IDs are invalid

**Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add dark-theme styling for checks composer"
```

---

## Task 9: Final verification

**Step 1: Run all tests one final time**

```bash
cd frontend && npm test
```
Expected: All PASS

**Step 2: Build for production**

```bash
cd frontend && npm run build
```
Expected: Build succeeds with no TypeScript errors.

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: production build verified"
```

---

## Out of Scope (do not implement)

- Wallet connection / signing
- Executing real composites on-chain
- `compositeMany`, `infinity` (black check)
- Mobile-first layout (responsive breakpoint included but not polished)
- Caching / React Query
