# Recursive Composite (4-Token Tree) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the Checks Composer to accept 4 token IDs (A, B, C, D), render the L1 composites (AB and CD) via the contract, and render the L2 composite (ABCD) entirely in JS using a TypeScript port of ChecksArt.sol.

**Architecture:** A virtual `Map<number, CheckStruct>` holds all 6 Check structs (4 real + 2 simulated L1). The AB struct gets `stored.composites[divisorIndex] = 65535` to point to CD. JS-side `colorIndexes` recursion resolves colors by walking this map instead of on-chain storage.

**Tech Stack:** React 18, Vite, TypeScript, viem (keccak256 + encodePacked), happy-dom (tests), vitest

---

### Task 1: Add `getCheck` to `checksAbi.ts`

**Files:**
- Modify: `src/checksAbi.ts`

**Step 1: Add the `getCheck` entry to the ABI array**

Insert this entry into the `CHECKS_ABI` array in `src/checksAbi.ts`:

```ts
{
  name: 'getCheck',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
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
```

**Step 2: Build to confirm no TS errors**

Run: `cd /Users/harsh/Desktop/Experiments/Infinite/frontend && npm run build`
Expected: build succeeds

**Step 3: Commit**

```bash
git add src/checksAbi.ts
git commit -m "feat: add getCheck to ABI"
```

---

### Task 2: Create `src/checksArtJS.ts` — constants and random utilities

**Files:**
- Create: `src/checksArtJS.ts`
- Create: `src/checksArtJS.test.ts`

**Step 1: Write failing tests**

Create `src/checksArtJS.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { random, randomSalted, avg, minGt0, min, max } from './checksArtJS'

describe('random', () => {
  it('returns a value in [0, max)', () => {
    const r = random(12345n, 80n)
    expect(r).toBeGreaterThanOrEqual(0n)
    expect(r).toBeLessThan(80n)
  })
  it('is deterministic', () => {
    expect(random(999n, 100n)).toBe(random(999n, 100n))
  })
})

describe('randomSalted', () => {
  it('returns a value in [0, max)', () => {
    const r = randomSalted(42n, 'band', 120n)
    expect(r).toBeGreaterThanOrEqual(0n)
    expect(r).toBeLessThan(120n)
  })
  it('differs from random with same seed', () => {
    expect(randomSalted(42n, 'band', 120n)).not.toBe(random(42n, 120n))
  })
})

describe('math helpers', () => {
  it('avg rounds toward lower', () => {
    expect(avg(3, 4)).toBe(3)
    expect(avg(4, 4)).toBe(4)
  })
  it('min returns smaller', () => expect(min(3, 7)).toBe(3))
  it('max returns larger', () => expect(max(3, 7)).toBe(7))
  it('minGt0 returns smallest non-zero', () => {
    expect(minGt0(0, 3)).toBe(3)
    expect(minGt0(2, 3)).toBe(2)
    expect(minGt0(0, 0)).toBe(0)
  })
})
```

**Step 2: Run tests — expect FAIL**

Run: `npm test -- --passWithNoTests`
Expected: FAIL (functions not exported yet)

**Step 3: Implement constants and utilities**

Create `src/checksArtJS.ts`:

```ts
import { keccak256, encodePacked } from 'viem'
import type { CheckStruct } from './utils'

export const DIVISORS = [80, 40, 20, 10, 5, 4, 1, 0] as const
export const COLOR_BANDS = [80, 60, 40, 20, 10, 5, 1] as const
export const GRADIENTS_TABLE = [0, 1, 2, 5, 8, 9, 10] as const

export const EIGHTY_COLORS = [
  'E84AA9','F2399D','DB2F96','E73E85','FF7F8E','FA5B67','E8424E','D5332F',
  'C23532','F2281C','D41515','9D262F','DE3237','DA3321','EA3A2D','EB4429',
  'EC7368','FF8079','FF9193','EA5B33','D05C35','ED7C30','EF9933','EF8C37',
  'F18930','F09837','F9A45C','F2A43A','F2A840','F2A93C','FFB340','F2B341',
  'FAD064','F7CA57','F6CB45','FFAB00','F4C44A','FCDE5B','F9DA4D','F9DA4A',
  'FAE272','F9DB49','FAE663','FBEA5B','A7CA45','B5F13B','94E337','63C23C',
  '86E48E','77E39F','5FCD8C','83F1AE','9DEFBF','2E9D9A','3EB8A1','5FC9BF',
  '77D3DE','6AD1DE','5ABAD3','4291A8','33758D','45B2D3','81D1EC','A7DDF9',
  '9AD9FB','A4C8EE','60B1F4','2480BD','4576D0','3263D0','2E4985','25438C',
  '525EAA','3D43B3','322F92','4A2387','371471','3B088C','6C31D7','9741DA',
] as const

// Mirrors Utilities.random(uint256, uint256)
export function random(input: bigint, max: bigint): bigint {
  const hash = keccak256(encodePacked(['uint256'], [input]))
  return BigInt(hash) % max
}

// Mirrors Utilities.random(uint256, string, uint256)
export function randomSalted(input: bigint, salt: string, max: bigint): bigint {
  const hash = keccak256(encodePacked(['uint256', 'string'], [input, salt]))
  return BigInt(hash) % max
}

// Mirrors Utilities.avg
export function avg(a: number, b: number): number {
  return (a >> 1) + (b >> 1) + (a & b & 1)
}

// Mirrors Utilities.min
export function min(a: number, b: number): number {
  return a < b ? a : b
}

// Mirrors Utilities.max
export function max(a: number, b: number): number {
  return a > b ? a : b
}

// Mirrors Utilities.minGt0
export function minGt0(a: number, b: number): number {
  return a > b ? (b > 0 ? b : a) : a
}
```

**Step 4: Run tests — expect PASS**

Run: `npm test`
Expected: all tests pass

**Step 5: Commit**

```bash
git add src/checksArtJS.ts src/checksArtJS.test.ts
git commit -m "feat: checksArtJS constants and random utilities"
```

---

### Task 3: Add `colorBandIndex` and `gradientIndex` to `checksArtJS.ts`

**Files:**
- Modify: `src/checksArtJS.ts`
- Modify: `src/checksArtJS.test.ts`

**Step 1: Add tests**

Append to `src/checksArtJS.test.ts`:

```ts
import { colorBandIndex, gradientIndex } from './checksArtJS'
import type { CheckStruct } from './utils'

function makeCheck(seed: bigint, divisorIndex: number, colorBands: number[], gradients: number[]): CheckStruct {
  return {
    stored: {
      composites: [0,0,0,0,0,0],
      colorBands,
      gradients,
      divisorIndex,
      epoch: 1,
      seed: 1,
      day: 1,
    },
    isRevealed: true,
    seed,
    checksCount: 80,
    hasManyChecks: true,
    composite: 0,
    isRoot: divisorIndex === 0,
    colorBand: 0,
    gradient: 0,
    direction: 0,
    speed: 2,
  }
}

describe('colorBandIndex', () => {
  it('returns 6 for divisorIndex >= 6', () => {
    const c = makeCheck(42n, 6, [0,0,0,0,0], [0,0,0,0,0])
    expect(colorBandIndex(c, 6)).toBe(6)
  })
  it('reads from stored.colorBands for divisorIndex 1-5', () => {
    const c = makeCheck(42n, 2, [3,2,1,0,0], [0,0,0,0,0])
    expect(colorBandIndex(c, 2)).toBe(2) // stored.colorBands[1]
  })
  it('computes from seed for divisorIndex 0', () => {
    const c = makeCheck(42n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const result = colorBandIndex(c, 0)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(6)
  })
})

describe('gradientIndex', () => {
  it('returns 0 for divisorIndex >= 6', () => {
    const c = makeCheck(42n, 6, [0,0,0,0,0], [0,0,0,0,0])
    expect(gradientIndex(c, 6)).toBe(0)
  })
  it('reads from stored.gradients for divisorIndex 1-5', () => {
    const c = makeCheck(42n, 2, [0,0,0,0,0], [3,2,1,0,0])
    expect(gradientIndex(c, 2)).toBe(2) // stored.gradients[1]
  })
})
```

**Step 2: Run tests — expect FAIL**

Run: `npm test`

**Step 3: Implement**

Append to `src/checksArtJS.ts`:

```ts
// Mirrors ChecksArt.colorBandIndex
export function colorBandIndex(check: CheckStruct, divisorIndex: number): number {
  const n = Number(randomSalted(check.seed, 'band', 120n))

  if (divisorIndex === 0) {
    if (n > 80) return 0
    if (n > 40) return 1
    if (n > 20) return 2
    if (n > 10) return 3
    if (n >  4) return 4
    if (n >  1) return 5
    return 6
  }
  if (divisorIndex < 6) return check.stored.colorBands[divisorIndex - 1]
  return 6
}

// Mirrors ChecksArt.gradientIndex
export function gradientIndex(check: CheckStruct, divisorIndex: number): number {
  const n = Number(randomSalted(check.seed, 'gradient', 100n))

  if (divisorIndex === 0) {
    return n < 20 ? 1 + (n % 6) : 0
  }
  if (divisorIndex < 6) return check.stored.gradients[divisorIndex - 1]
  return 0
}
```

**Step 4: Run tests — expect PASS**

Run: `npm test`

**Step 5: Commit**

```bash
git add src/checksArtJS.ts src/checksArtJS.test.ts
git commit -m "feat: colorBandIndex and gradientIndex"
```

---

### Task 4: Add `colorIndexes` (recursive) to `checksArtJS.ts`

**Files:**
- Modify: `src/checksArtJS.ts`
- Modify: `src/checksArtJS.test.ts`

**Step 1: Add tests**

Append to `src/checksArtJS.test.ts`:

```ts
import { colorIndexes } from './checksArtJS'

describe('colorIndexes', () => {
  it('returns an array of length matching DIVISORS[divisorIndex] for a root check', () => {
    const c = makeCheck(999n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const map = new Map([[0, c]])
    const result = colorIndexes(0, c, map)
    expect(result).toHaveLength(80) // DIVISORS[0] = 80
    result.forEach(i => {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(80)
    })
  })

  it('returns [999] for a black check (divisorIndex 7)', () => {
    const c = makeCheck(1n, 7, [0,0,0,0,0], [0,0,0,0,0])
    c.stored = { ...c.stored, divisorIndex: 7 }
    // black checks return early with index 999 (handled in colors())
    // colorIndexes itself is still called — result length = DIVISORS[7] = 0, handled
    const map = new Map([[0, c]])
    const result = colorIndexes(7, c, map)
    expect(result).toHaveLength(0) // DIVISORS[7] = 0
  })
})
```

**Step 2: Run tests — expect FAIL**

Run: `npm test`

**Step 3: Implement**

Append to `src/checksArtJS.ts`:

```ts
// Mirrors ChecksArt.colorIndexes — resolves colors recursively through the virtual map
export function colorIndexes(
  divisorIndex: number,
  check: CheckStruct,
  virtualMap: Map<number, CheckStruct>
): number[] {
  const checksCount = DIVISORS[divisorIndex]
  const seed = check.seed
  const colorBandSize = COLOR_BANDS[colorBandIndex(check, divisorIndex)]
  const gradient = GRADIENTS_TABLE[gradientIndex(check, divisorIndex)]

  const possibleColorChoices = divisorIndex > 0 ? DIVISORS[divisorIndex - 1] * 2 : 80

  const indexes: number[] = new Array(checksCount).fill(0)
  indexes[0] = Number(random(seed, BigInt(possibleColorChoices)))

  if (check.hasManyChecks) {
    if (gradient > 0) {
      for (let i = 1; i < checksCount; i++) {
        indexes[i] = (indexes[0] + Math.floor((i * gradient * colorBandSize) / checksCount) % colorBandSize) % 80
      }
    } else if (divisorIndex === 0) {
      for (let i = 1; i < checksCount; i++) {
        indexes[i] = (indexes[0] + Number(random(seed + BigInt(i), BigInt(colorBandSize)))) % 80
      }
    } else {
      for (let i = 1; i < checksCount; i++) {
        indexes[i] = Number(random(seed + BigInt(i), BigInt(possibleColorChoices)))
      }
    }
  }

  if (divisorIndex > 0) {
    const previousDivisor = divisorIndex - 1

    const parentIndexes = colorIndexes(previousDivisor, check, virtualMap)

    const compositeCheck = virtualMap.get(check.composite)
    if (!compositeCheck) throw new Error(`Virtual map missing key: ${check.composite}`)
    const compositedIndexes = colorIndexes(previousDivisor, compositeCheck, virtualMap)

    const count = DIVISORS[previousDivisor]

    const initialBranchIndex = indexes[0] % count
    indexes[0] = indexes[0] < count
      ? parentIndexes[initialBranchIndex]
      : compositedIndexes[initialBranchIndex]

    if (gradient === 0) {
      for (let i = 0; i < checksCount; i++) {
        const branchIndex = indexes[i] % count
        indexes[i] = indexes[i] < count
          ? parentIndexes[branchIndex]
          : compositedIndexes[branchIndex]
      }
    } else {
      for (let i = 1; i < checksCount; i++) {
        indexes[i] = (indexes[0] + Math.floor((i * gradient * colorBandSize) / checksCount) % colorBandSize) % 80
      }
    }
  }

  return indexes
}
```

**Step 4: Run tests — expect PASS**

Run: `npm test`

**Step 5: Commit**

```bash
git add src/checksArtJS.ts src/checksArtJS.test.ts
git commit -m "feat: colorIndexes recursive implementation"
```

---

### Task 5: Add `compositeGenesJS`, `simulateCompositeJS`, and `generateSVGJS` to `checksArtJS.ts`

**Files:**
- Modify: `src/checksArtJS.ts`
- Modify: `src/checksArtJS.test.ts`

**Step 1: Add tests for `compositeGenesJS` and `simulateCompositeJS`**

Append to `src/checksArtJS.test.ts`:

```ts
import { compositeGenesJS, simulateCompositeJS } from './checksArtJS'

describe('compositeGenesJS', () => {
  it('returns gradient and colorBand in valid ranges', () => {
    const keeper = makeCheck(100n, 0, [0,0,0,0,0], [0,0,0,0,0])
    keeper.gradient = 2; keeper.colorBand = 3
    const burner = makeCheck(200n, 0, [0,0,0,0,0], [0,0,0,0,0])
    burner.gradient = 1; burner.colorBand = 4
    const { gradient, colorBand } = compositeGenesJS(keeper, burner)
    expect(gradient).toBeGreaterThanOrEqual(0)
    expect(gradient).toBeLessThanOrEqual(6)
    expect(colorBand).toBeGreaterThanOrEqual(0)
    expect(colorBand).toBeLessThanOrEqual(6)
  })
})

describe('simulateCompositeJS', () => {
  it('returns a CheckStruct with divisorIndex + 1', () => {
    const keeper = makeCheck(100n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const burner = makeCheck(200n, 0, [0,0,0,0,0], [0,0,0,0,0])
    const result = simulateCompositeJS(keeper, burner, 65535)
    expect(result.stored.divisorIndex).toBe(1)
    expect(result.stored.composites[0]).toBe(65535)
  })
})
```

**Step 2: Run tests — expect FAIL**

Run: `npm test`

**Step 3: Implement**

Append to `src/checksArtJS.ts`:

```ts
// Mirrors Checks._compositeGenes
export function compositeGenesJS(
  keeper: CheckStruct,
  burner: CheckStruct
): { gradient: number; colorBand: number } {
  const randomizer = BigInt(
    keccak256(encodePacked(['uint256', 'uint256'], [keeper.seed, burner.seed]))
  )
  const r = Number(randomizer % 100n)

  let gradient: number
  if (r > 80) {
    gradient = randomizer % 2n === 0n
      ? minGt0(keeper.gradient, burner.gradient)
      : max(keeper.gradient, burner.gradient)
  } else {
    gradient = min(keeper.gradient, burner.gradient)
  }

  const colorBand = avg(keeper.colorBand, burner.colorBand)

  return { gradient, colorBand }
}

// Mirrors Checks.simulateComposite but fully in JS
export function simulateCompositeJS(
  keeper: CheckStruct,
  burner: CheckStruct,
  burnerVirtualId: number
): CheckStruct {
  const divisorIndex = keeper.stored.divisorIndex
  const nextDivisor = divisorIndex + 1

  const composites = [...keeper.stored.composites] as number[]
  composites[divisorIndex] = burnerVirtualId

  let colorBands = [...keeper.stored.colorBands] as number[]
  let gradients = [...keeper.stored.gradients] as number[]

  if (divisorIndex < 5) {
    const { gradient, colorBand } = compositeGenesJS(keeper, burner)
    colorBands[divisorIndex] = colorBand
    gradients[divisorIndex] = gradient
  }

  const stored = {
    ...keeper.stored,
    composites,
    colorBands,
    gradients,
    divisorIndex: nextDivisor,
  }

  const result: CheckStruct = {
    stored,
    isRevealed: keeper.isRevealed,
    seed: keeper.seed,
    checksCount: DIVISORS[nextDivisor],
    hasManyChecks: nextDivisor < 6,
    composite: composites[nextDivisor - 1] ?? 0,
    isRoot: nextDivisor === 0,
    colorBand: 0,
    gradient: 0,
    direction: keeper.direction,
    speed: keeper.speed,
  }

  result.colorBand = colorBandIndex(result, nextDivisor)
  result.gradient = gradientIndex(result, nextDivisor)

  return result
}

// Mirrors ChecksArt.generateSVG — returns an SVG string
export function generateSVGJS(
  check: CheckStruct,
  virtualMap: Map<number, CheckStruct>
): string {
  const isBlack = check.stored.divisorIndex === 7
  const count = isBlack ? 1 : DIVISORS[check.stored.divisorIndex]
  const gridColor = isBlack ? '#F2F2F2' : '#191919'
  const canvasColor = isBlack ? '#FFF' : '#111'

  let checkColors: string[]
  let colorIdxs: number[]

  if (isBlack) {
    checkColors = ['000']
    colorIdxs = [999]
  } else if (!check.isRevealed) {
    checkColors = ['424242']
    colorIdxs = [0]
  } else {
    colorIdxs = colorIndexes(check.stored.divisorIndex, check, virtualMap)
    checkColors = colorIdxs.map(i => EIGHTY_COLORS[i])
  }

  const scale = count > 20 ? '1' : count > 1 ? '2' : '3'
  const spaceX = count === 80 ? 36 : 72
  const spaceY = count > 20 ? 36 : 72
  const perRow_ = perRow(count)
  const indent = count === 40
  let rowX_ = rowX(count)
  let rowY_ = rowY(count)

  const CHECKS_PATH = 'M21.36 9.886A3.933 3.933 0 0 0 18 8c-1.423 0-2.67.755-3.36 1.887a3.935 3.935 0 0 0-4.753 4.753A3.933 3.933 0 0 0 8 18c0 1.423.755 2.669 1.886 3.36a3.935 3.935 0 0 0 4.753 4.753 3.933 3.933 0 0 0 4.863 1.59 3.953 3.953 0 0 0 1.858-1.589 3.935 3.935 0 0 0 4.753-4.754A3.933 3.933 0 0 0 28 18a3.933 3.933 0 0 0-1.887-3.36 3.934 3.934 0 0 0-1.042-3.711 3.934 3.934 0 0 0-3.71-1.043Zm-3.958 11.713 4.562-6.844c.566-.846-.751-1.724-1.316-.878l-4.026 6.043-1.371-1.368c-.717-.722-1.836.396-1.116 1.116l2.17 2.15a.788.788 0 0 0 1.097-.22Z'

  // Build grid rows
  let gridRowContent = ''
  for (let i = 0; i < 8; i++) {
    gridRowContent += `<use href="#square" x="${196 + i * 36}" y="160"/>`
  }
  let gridContent = ''
  for (let i = 0; i < 10; i++) {
    gridContent += `<use href="#row" y="${i * 36}"/>`
  }
  const grid = `<g id="grid" x="196" y="160">${gridContent}</g>`

  // Build check elements
  let checksContent = ''
  for (let i = 0; i < count; i++) {
    const indexInRow = i % perRow_
    const isNewRow = indexInRow === 0 && i > 0

    if (isNewRow) rowY_ += spaceY
    if (isNewRow && indent) {
      if (i % (perRow_ * 2) === 0) {
        rowX_ -= spaceX / 2
      } else {
        rowX_ += spaceX / 2
      }
    }

    const tx = rowX_ + indexInRow * spaceX
    const color = check.isRevealed ? checkColors[i] : checkColors[0]

    let animContent = ''
    if (check.isRevealed && !isBlack) {
      const offset = colorIdxs[i]
      let values = ''
      if (check.direction === 0) {
        for (let j = offset + 80; j > offset; j -= 4) {
          values += `#${EIGHTY_COLORS[j % 80]};`
        }
      } else {
        for (let j = offset; j < offset + 80; j += 4) {
          values += `#${EIGHTY_COLORS[j % 80]};`
        }
      }
      values += `#${EIGHTY_COLORS[offset]}`
      const dur = Math.floor(20 * 2 / check.speed)
      animContent = `<animate attributeName="fill" values="${values}" dur="${dur}s" begin="animation.begin" repeatCount="indefinite"/>`
    }

    checksContent += `<g transform="translate(${tx}, ${rowY_}) scale(${scale})"><use href="#check" fill="#${color}">${animContent}</use></g>`
  }

  return `<svg viewBox="0 0 680 680" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;background:black;"><defs><path id="check" fill-rule="evenodd" d="${CHECKS_PATH}"></path><rect id="square" width="36" height="36" stroke="${gridColor}"></rect><g id="row">${gridRowContent}</g></defs><rect width="680" height="680" fill="black"/><rect x="188" y="152" width="304" height="376" fill="${canvasColor}"/>${grid}${checksContent}<rect width="680" height="680" fill="transparent"><animate attributeName="width" from="680" to="0" dur="0.2s" begin="click" fill="freeze" id="animation"/></rect></svg>`
}

function perRow(count: number): number {
  if (count === 80) return 8
  if (count >= 20) return 4
  if (count === 10 || count === 4) return 2
  return 1
}

function rowX(count: number): number {
  if (count <= 1) return 286
  if (count === 5) return 304
  if (count === 10 || count === 4) return 268
  return 196
}

function rowY(count: number): number {
  if (count > 4) return 160
  if (count === 4) return 268
  if (count > 1) return 304
  return 286
}
```

**Step 4: Run tests — expect PASS**

Run: `npm test`

**Step 5: Commit**

```bash
git add src/checksArtJS.ts src/checksArtJS.test.ts
git commit -m "feat: compositeGenesJS, simulateCompositeJS, generateSVGJS"
```

---

### Task 6: Create `src/useTreeComposite.ts` hook

**Files:**
- Create: `src/useTreeComposite.ts`

No unit tests for hooks (async RPC calls). We verify via integration in the UI.

**Step 1: Create the hook**

```ts
import { useState } from 'react'
import { createChecksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import { parseTokenURI, mapCheckAttributes, type ParsedTokenURI, type Attribute, type CheckStruct } from './utils'
import { simulateCompositeJS, generateSVGJS } from './checksArtJS'

export interface CardState {
  name: string
  svg: string
  attributes: Attribute[]
  loading: boolean
  error: string
}

export interface TreeState {
  a: CardState | null
  b: CardState | null
  c: CardState | null
  d: CardState | null
  ab: CardState | null
  cd: CardState | null
  abcd: CardState | null
}

const loadingCard = (name: string): CardState => ({ name, svg: '', attributes: [], loading: true, error: '' })
const errorCard = (name: string, err: unknown): CardState => ({ name, svg: '', attributes: [], loading: false, error: humanizeError(err) })

export function useTreeComposite() {
  const [state, setState] = useState<TreeState>({
    a: null, b: null, c: null, d: null,
    ab: null, cd: null, abcd: null,
  })

  async function preview(alchemyKey: string, idA: string, idB: string, idC: string, idD: string) {
    const [A, B, C, D] = [BigInt(idA), BigInt(idB), BigInt(idC), BigInt(idD)]

    setState({
      a: loadingCard(`Token #${idA}`),
      b: loadingCard(`Token #${idB}`),
      c: loadingCard(`Token #${idC}`),
      d: loadingCard(`Token #${idD}`),
      ab: loadingCard('Composite AB'),
      cd: loadingCard('Composite CD'),
      abcd: loadingCard('Composite ABCD'),
    })

    const client = createChecksClient(alchemyKey)

    // Phase 1: tokenURI + getCheck for all 4 tokens (8 parallel calls)
    const [uriA, uriB, uriC, uriD, checkA, checkB, checkC, checkD] = await Promise.allSettled([
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [A] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [B] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [C] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [D] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'getCheck', args: [A] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'getCheck', args: [B] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'getCheck', args: [C] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'getCheck', args: [D] }),
    ])

    // Update leaf cards immediately
    setState(prev => ({
      ...prev,
      a: resolveTokenURI(uriA, `Token #${idA}`),
      b: resolveTokenURI(uriB, `Token #${idB}`),
      c: resolveTokenURI(uriC, `Token #${idC}`),
      d: resolveTokenURI(uriD, `Token #${idD}`),
    }))

    // Phase 2: simulateComposite + simulateCompositeSVG for (A,B) and (C,D) (4 parallel calls)
    const [abSVG, abCheck, cdSVG, cdCheck] = await Promise.allSettled([
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateCompositeSVG', args: [A, B] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateComposite', args: [A, B] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateCompositeSVG', args: [C, D] }),
      client.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateComposite', args: [C, D] }),
    ])

    setState(prev => ({
      ...prev,
      ab: resolveL1Card('Composite AB', abSVG, abCheck),
      cd: resolveL1Card('Composite CD', cdSVG, cdCheck),
    }))

    // Phase 3: JS-only L2 computation
    const abcdCard = computeL2(checkA, checkB, checkC, checkD, abCheck, cdCheck)
    setState(prev => ({ ...prev, abcd: abcdCard }))
  }

  return { state, preview }
}

function resolveTokenURI(result: PromiseSettledResult<string>, name: string): CardState {
  if (result.status === 'fulfilled') {
    try {
      const parsed = parseTokenURI(result.value)
      return { ...parsed, loading: false, error: '' }
    } catch {
      return errorCard(name, 'Failed to parse token data')
    }
  }
  return errorCard(name, result.reason)
}

function resolveL1Card(
  name: string,
  svgResult: PromiseSettledResult<string>,
  checkResult: PromiseSettledResult<unknown>
): CardState {
  if (svgResult.status === 'fulfilled' && checkResult.status === 'fulfilled') {
    try {
      const attrs = mapCheckAttributes(checkResult.value as CheckStruct)
      return { name, svg: svgResult.value, attributes: attrs, loading: false, error: '' }
    } catch {
      return errorCard(name, 'Failed to build L1 composite')
    }
  }
  const reason = svgResult.status === 'rejected' ? svgResult.reason : (checkResult as PromiseRejectedResult).reason
  return errorCard(name, reason)
}

function computeL2(
  checkA: PromiseSettledResult<unknown>,
  checkB: PromiseSettledResult<unknown>,
  checkC: PromiseSettledResult<unknown>,
  checkD: PromiseSettledResult<unknown>,
  abCheck: PromiseSettledResult<unknown>,
  cdCheck: PromiseSettledResult<unknown>
): CardState {
  try {
    if (
      checkA.status !== 'fulfilled' || checkB.status !== 'fulfilled' ||
      checkC.status !== 'fulfilled' || checkD.status !== 'fulfilled' ||
      abCheck.status !== 'fulfilled' || cdCheck.status !== 'fulfilled'
    ) {
      return errorCard('Composite ABCD', 'One or more prerequisite checks failed — cannot compute L2 composite.')
    }

    const A = checkA.value as CheckStruct
    const B = checkB.value as CheckStruct
    const C = checkC.value as CheckStruct
    const D = checkD.value as CheckStruct
    const ab = abCheck.value as CheckStruct
    const cd = cdCheck.value as CheckStruct

    const AB_VIRTUAL_ID = 65534
    const CD_VIRTUAL_ID = 65535

    // Give virtual IDs to L1 checks
    const abWithId = { ...ab, stored: { ...ab.stored, composites: [...ab.stored.composites] as number[] } }
    abWithId.stored.composites[ab.stored.divisorIndex] = CD_VIRTUAL_ID

    // Build the virtual map
    const virtualMap = new Map<number, CheckStruct>([
      [Number(A.seed), A],  // Not used by key lookup; real IDs come from composite field
      [Number(B.seed), B],
      [Number(C.seed), C],
      [Number(D.seed), D],
      [AB_VIRTUAL_ID, abWithId],
      [CD_VIRTUAL_ID, cd],
    ])

    // Compute ABCD
    const abcdCheck = simulateCompositeJS(abWithId, cd, CD_VIRTUAL_ID)

    // For generateSVGJS, the virtualMap must be keyed by the composite field values
    // Rebuild with correct keys based on what colorIndexes will look up
    const renderMap = new Map<number, CheckStruct>()

    // The leaf checks: we need to know the IDs the contract uses in stored.composites
    // A's stored.composites[0] = B (real burnId), B's composites were set at mint
    // For the root (A and C at divisorIndex=0), colorIndexes doesn't recurse
    // AB.composite = stored.composites[ab.stored.divisorIndex - 1] = the real B ID? No.
    // Actually: abWithId.composite = abWithId.stored.composites[abWithId.stored.divisorIndex - 1]
    // We need to populate the map by the composite field value of each check

    // The ABCD check's composite field = CD_VIRTUAL_ID → map must have CD_VIRTUAL_ID
    renderMap.set(CD_VIRTUAL_ID, cd)
    // The AB check's composite = the real burnId B used in simulateComposite(A,B)
    // The CD check's composite = the real burnId D used in simulateComposite(C,D)
    // For L1 checks (divisorIndex=1), they look up their composite in the map
    // ab.composite = ab.stored.composites[0] = real token B id
    // cd.composite = cd.stored.composites[0] = real token D id
    renderMap.set(ab.composite, B)
    renderMap.set(cd.composite, D)
    // The A and C checks are roots (divisorIndex=0), so colorIndexes won't recurse further
    // But abWithId (divisorIndex=1) needs its composite (B) in the map
    // ab (divisorIndex=1) when called with divisorIndex=1 looks up check.composite = B id
    // We already set renderMap.set(ab.composite, B) above
    // Similarly for cd looking up D — done
    // abcdCheck (divisorIndex=2) looks up abcdCheck.composite = CD_VIRTUAL_ID — done
    // When recursing for previousDivisor=1 on abcdCheck, it calls colorIndexes(1, abcdCheck, map)
    // which then looks up abcdCheck.composite = CD_VIRTUAL_ID for the composited branch
    // and uses abWithId itself for the parent branch
    // But wait — colorIndexes(1, abcdCheck...) will use check.composite = CD_VIRTUAL_ID
    // and also recurse with check=abcdCheck for parentIndexes (its own stored as divisorIndex=1 parent)
    // Actually colorIndexes(1, check, map) where check = abcdCheck:
    //   parentIndexes = colorIndexes(0, abcdCheck, map) — root, no recursion
    //   compositedIndexes = colorIndexes(0, map.get(abcdCheck.composite), map)
    //                     = colorIndexes(0, map.get(CD_VIRTUAL_ID), map) = colorIndexes(0, cd, map) ✓
    // Then colorIndexes(2, abcdCheck, map):
    //   parentIndexes = colorIndexes(1, abcdCheck, map) — as above ✓
    //   compositedCheck = map.get(abcdCheck.composite) = map.get(CD_VIRTUAL_ID) = cd ✓
    //   compositedIndexes = colorIndexes(1, cd, map)
    //     → cd.composite = real D id → map must have real D id ✓ (set above)

    renderMap.set(AB_VIRTUAL_ID, abWithId)
    // Also need A and C as roots for when colorIndexes(0, check, map) is called
    // colorIndexes(0, ...) doesn't recurse so no map lookups needed at divisorIndex=0

    const svg = generateSVGJS(abcdCheck, renderMap)
    const attrs = mapCheckAttributes(abcdCheck)

    return { name: 'Composite ABCD', svg, attributes: attrs, loading: false, error: '' }
  } catch (e) {
    return errorCard('Composite ABCD', e)
  }
}

function humanizeError(err: unknown): string {
  const msg = String(err)
  if (msg.includes('NotAllowed')) return 'Tokens must have the same check count, be different, and exist on-chain.'
  if (msg.includes('revert')) return 'Contract reverted — tokens may not exist or may be incompatible.'
  if (msg.includes('network') || msg.includes('fetch')) return 'Network error — check your Alchemy key.'
  return 'Something went wrong. Check the token IDs and try again.'
}
```

**Step 2: Build to check TS types**

Run: `npm run build`
Expected: no type errors

**Step 3: Commit**

```bash
git add src/useTreeComposite.ts
git commit -m "feat: useTreeComposite hook with 3-phase fetching"
```

---

### Task 7: Update `InputPanel.tsx` for 4 IDs

**Files:**
- Modify: `src/components/InputPanel.tsx`

**Step 1: Rewrite InputPanel to accept 4 IDs**

Replace the file content:

```tsx
interface InputPanelProps {
  alchemyKey: string
  idA: string
  idB: string
  idC: string
  idD: string
  loading: boolean
  onAlchemyKeyChange: (v: string) => void
  onIdAChange: (v: string) => void
  onIdBChange: (v: string) => void
  onIdCChange: (v: string) => void
  onIdDChange: (v: string) => void
  onPreview: () => void
}

export function InputPanel({
  alchemyKey, idA, idB, idC, idD, loading,
  onAlchemyKeyChange, onIdAChange, onIdBChange, onIdCChange, onIdDChange, onPreview,
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
        <span className="pair-label">Pair 1</span>
        <label>
          Token A
          <input type="number" placeholder="e.g. 1234" min="0"
            value={idA} onChange={(e) => onIdAChange(e.target.value)} required />
        </label>
        <label>
          Token B
          <input type="number" placeholder="e.g. 5678" min="0"
            value={idB} onChange={(e) => onIdBChange(e.target.value)} required />
        </label>
        <span className="pair-label">Pair 2</span>
        <label>
          Token C
          <input type="number" placeholder="e.g. 9012" min="0"
            value={idC} onChange={(e) => onIdCChange(e.target.value)} required />
        </label>
        <label>
          Token D
          <input type="number" placeholder="e.g. 3456" min="0"
            value={idD} onChange={(e) => onIdDChange(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Preview →'}
        </button>
      </div>
    </form>
  )
}
```

**Step 2: Build to confirm**

Run: `npm run build`
Expected: may fail on App.tsx (not yet updated) — that's fine at this step

**Step 3: Commit**

```bash
git add src/components/InputPanel.tsx
git commit -m "feat: InputPanel updated for 4 token IDs"
```

---

### Task 8: Create `TreeLayout.tsx` component

**Files:**
- Create: `src/components/TreeLayout.tsx`

**Step 1: Create the tree layout component**

```tsx
import { CheckCard } from './CheckCard'
import type { TreeState } from '../useTreeComposite'

interface TreeLayoutProps {
  state: TreeState
  ids: { a: string; b: string; c: string; d: string }
}

export function TreeLayout({ state, ids }: TreeLayoutProps) {
  if (!state.a && !state.b && !state.c && !state.d) return null

  return (
    <div className="tree-layout">
      {/* Row 1: Leaf tokens */}
      <div className="tree-row tree-row-leaves">
        <div className="tree-pair">
          <CheckCard label={`Token A #${ids.a}`} {...cardProps(state.a)} />
          <CheckCard label={`Token B #${ids.b}`} {...cardProps(state.b)} />
        </div>
        <div className="tree-pair">
          <CheckCard label={`Token C #${ids.c}`} {...cardProps(state.c)} />
          <CheckCard label={`Token D #${ids.d}`} {...cardProps(state.d)} />
        </div>
      </div>
      {/* Row 2: L1 composites */}
      <div className="tree-row tree-row-l1">
        <div className="tree-node-centered">
          <CheckCard label="Composite AB" {...cardProps(state.ab)} />
        </div>
        <div className="tree-node-centered">
          <CheckCard label="Composite CD" {...cardProps(state.cd)} />
        </div>
      </div>
      {/* Row 3: L2 composite */}
      <div className="tree-row tree-row-l2">
        <div className="tree-node-centered">
          <CheckCard label="Composite ABCD" {...cardProps(state.abcd)} />
        </div>
      </div>
    </div>
  )
}

function cardProps(card: import('../useTreeComposite').CardState | null) {
  return {
    name: card?.name ?? '',
    svg: card?.svg ?? '',
    attributes: card?.attributes ?? [],
    loading: card?.loading ?? false,
    error: card?.error ?? '',
  }
}
```

**Step 2: Build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/components/TreeLayout.tsx
git commit -m "feat: TreeLayout component for 7-node tree"
```

---

### Task 9: Update `App.tsx` and `index.css` for tree layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`

**Step 1: Rewrite App.tsx**

```tsx
import { useState } from 'react'
import { InputPanel } from './components/InputPanel'
import { TreeLayout } from './components/TreeLayout'
import { useTreeComposite } from './useTreeComposite'

export default function App() {
  const [alchemyKey, setAlchemyKey] = useState(import.meta.env.VITE_ALCHEMY_API_KEY ?? '')
  const [idA, setIdA] = useState('')
  const [idB, setIdB] = useState('')
  const [idC, setIdC] = useState('')
  const [idD, setIdD] = useState('')
  const [validationError, setValidationError] = useState('')

  const { state, preview } = useTreeComposite()

  const isLoading = !!(
    state.a?.loading || state.b?.loading ||
    state.c?.loading || state.d?.loading ||
    state.ab?.loading || state.cd?.loading || state.abcd?.loading
  )

  function handlePreview() {
    setValidationError('')
    if (!alchemyKey.trim()) { setValidationError('Please enter an Alchemy API key.'); return }
    if (!idA || !idB || !idC || !idD) { setValidationError('Please enter all four token IDs.'); return }
    const ids = [idA, idB, idC, idD]
    if (new Set(ids).size < 4) { setValidationError('All four token IDs must be different.'); return }
    preview(alchemyKey, idA, idB, idC, idD)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>◆ Checks Composer</h1>
        <p>Preview a 2-level recursive composite of four Checks.</p>
      </header>
      <InputPanel
        alchemyKey={alchemyKey}
        idA={idA} idB={idB} idC={idC} idD={idD}
        loading={isLoading}
        onAlchemyKeyChange={setAlchemyKey}
        onIdAChange={setIdA} onIdBChange={setIdB}
        onIdCChange={setIdC} onIdDChange={setIdD}
        onPreview={handlePreview}
      />
      {validationError && <div className="validation-error">{validationError}</div>}
      <TreeLayout state={state} ids={{ a: idA, b: idB, c: idC, d: idD }} />
    </div>
  )
}
```

**Step 2: Add tree layout CSS to `index.css`**

Append the following to `src/index.css`:

```css
/* Tree layout */
.tree-layout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
  padding: 1rem;
}

.tree-row {
  display: flex;
  justify-content: center;
  gap: 3rem;
  width: 100%;
}

.tree-pair {
  display: flex;
  gap: 1rem;
}

.tree-node-centered {
  display: flex;
  justify-content: center;
}

.tree-row-l1 {
  gap: 8rem;
}

.tree-row-l2 {
  justify-content: center;
}
```

**Step 3: Remove the old 3-panel `.panels` styles from `index.css` if present** (only remove lines referencing `.panels` and `.composite-arrow` — do not delete unrelated styles)

**Step 4: Build and verify**

Run: `npm run build`
Expected: clean build

**Step 5: Run tests**

Run: `npm test`
Expected: all tests pass

**Step 6: Commit**

```bash
git add src/App.tsx src/index.css
git commit -m "feat: App and CSS updated for tree layout"
```

---

### Task 10: Fix virtual map key alignment in `useTreeComposite.ts`

> This task exists to correct the virtual map key strategy after the full integration is built. The `computeL2` function in Task 6 has inline comments explaining the correct key layout; this task verifies and fixes any key mismatches discovered during Task 9 build.

**Files:**
- Modify: `src/useTreeComposite.ts`

**Step 1: Read `useTreeComposite.ts` and trace through colorIndexes logic**

The rendering path for `abcdCheck` (divisorIndex=2):
1. `colorIndexes(2, abcdCheck, map)` → needs `map.get(abcdCheck.composite)` = `map.get(CD_VIRTUAL_ID)` ✓
2. `colorIndexes(1, abcdCheck, map)` (parent) → needs `map.get(abcdCheck.composite)` = same ✓
3. `colorIndexes(1, cd, map)` (composited) → needs `map.get(cd.composite)` = real D token id
4. `colorIndexes(0, ...)` → no lookup needed (root)

So `renderMap` needs:
- `CD_VIRTUAL_ID → cd`
- `cd.composite → D` (real D check struct, but at divisorIndex=0 for root resolution)
- `ab.composite → B` (real B check struct, at divisorIndex=0)

The real D and B check structs are available from Phase 1's `getCheck` calls. The key issue: `checkD.value` is a `CheckStruct` but it has `divisorIndex=0` (its actual on-chain state). That's correct — `colorIndexes(0, D, map)` doesn't recurse.

**Step 2: Update computeL2 to use the real check structs from Phase 1 for leaf map entries**

Ensure the `renderMap` is built as follows (replace the renderMap section in computeL2):

```ts
const renderMap = new Map<number, CheckStruct>([
  [CD_VIRTUAL_ID, cd],
  [AB_VIRTUAL_ID, abWithId],
  [ab.composite, B],   // B's real check, needed when colorIndexes(1, ab, map) looks up ab.composite
  [cd.composite, D],   // D's real check, needed when colorIndexes(1, cd, map) looks up cd.composite
])
```

**Step 3: Build and run tests**

Run: `npm run build && npm test`

**Step 4: Commit**

```bash
git add src/useTreeComposite.ts
git commit -m "fix: correct virtual map key alignment for L2 color resolution"
```

---

### Task 11: Final verification

**Files:** none

**Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass (green)

**Step 2: Run build**

Run: `npm run build`
Expected: zero errors, dist/ generated

**Step 3: Confirm test count**

Run: `npm test -- --reporter=verbose`
Expected: ≥ 19 tests pass (15 from utils + new checksArtJS tests)

**Step 4: Commit (if any last fixes)**

```bash
git add -p
git commit -m "chore: final verification cleanup"
```
