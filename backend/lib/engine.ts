/**
 * Checks JS computation engine — backend port.
 *
 * Mirrors the on-chain ChecksArt.sol and Utilities.sol logic.
 * Ported from frontend/src/checksArtJS.ts and frontend/src/utils.ts.
 *
 * Key differences from the frontend version:
 * - Uses Buffer.from instead of atob (Node.js, no browser globals)
 * - Exports CheckStructJSON for Supabase round-trips (seed stored as string)
 */

import { keccak256, encodePacked } from 'viem'

// ─── Constants ───────────────────────────────────────────────────────────────

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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Attribute {
  trait_type: string
  value: string
}

export interface ParsedTokenURI {
  name: string
  svg: string
  attributes: Attribute[]
}

/** CheckStruct as returned by viem (seed is bigint). */
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

/**
 * CheckStruct safe for JSON / Supabase jsonb storage.
 * seed (uint256) is serialized as a decimal string to avoid precision loss.
 */
export interface CheckStructJSON {
  stored: {
    composites: number[]
    colorBands: number[]
    gradients: number[]
    divisorIndex: number
    epoch: number
    seed: number
    day: number
  }
  isRevealed: boolean
  seed: string   // bigint serialized as decimal string
  checksCount: number
  hasManyChecks: boolean
  composite: number
  isRoot: boolean
  colorBand: number
  gradient: number
  direction: number
  speed: number
}

export function checkStructToJSON(c: CheckStruct): CheckStructJSON {
  return {
    stored: {
      composites: [...c.stored.composites],
      colorBands: [...c.stored.colorBands],
      gradients:  [...c.stored.gradients],
      divisorIndex: c.stored.divisorIndex,
      epoch: c.stored.epoch,
      seed:  c.stored.seed,
      day:   c.stored.day,
    },
    isRevealed:   c.isRevealed,
    seed:         c.seed.toString(),
    checksCount:  c.checksCount,
    hasManyChecks:c.hasManyChecks,
    composite:    c.composite,
    isRoot:       c.isRoot,
    colorBand:    c.colorBand,
    gradient:     c.gradient,
    direction:    c.direction,
    speed:        c.speed,
  }
}

export function checkStructFromJSON(j: CheckStructJSON): CheckStruct {
  return {
    stored: {
      composites: j.stored.composites,
      colorBands: j.stored.colorBands,
      gradients:  j.stored.gradients,
      divisorIndex: j.stored.divisorIndex,
      epoch: j.stored.epoch,
      seed:  j.stored.seed,
      day:   j.stored.day,
    },
    isRevealed:   j.isRevealed,
    seed:         BigInt(j.seed),
    checksCount:  j.checksCount,
    hasManyChecks:j.hasManyChecks,
    composite:    j.composite,
    isRoot:       j.isRoot,
    colorBand:    j.colorBand,
    gradient:     j.gradient,
    direction:    j.direction,
    speed:        j.speed,
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function random(input: bigint, max: bigint): bigint {
  const hash = keccak256(encodePacked(['uint256'], [input]))
  return BigInt(hash) % max
}

export function randomSalted(input: bigint, salt: string, max: bigint): bigint {
  const hash = keccak256(encodePacked(['uint256', 'string'], [input, salt]))
  return BigInt(hash) % max
}

export function avg(a: number, b: number): number {
  return (a >> 1) + (b >> 1) + (a & b & 1)
}

export function min(a: number, b: number): number {
  return a < b ? a : b
}

export function max(a: number, b: number): number {
  return a > b ? a : b
}

export function minGt0(a: number, b: number): number {
  if (a === 0) return b
  if (b === 0) return a
  return a < b ? a : b
}

// ─── Attribute helpers ───────────────────────────────────────────────────────

const COLOR_BAND_NAMES = ['Eighty', 'Sixty', 'Forty', 'Twenty', 'Ten', 'Five', 'One'] as const
const GRADIENT_NAMES   = ['None', 'Linear', 'Double Linear', 'Reflected', 'Double Angled', 'Angled', 'Linear Z'] as const

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

export function mapCheckAttributes(check: CheckStruct): Attribute[] {
  const attrs: Attribute[] = []
  if (check.isRevealed && check.hasManyChecks) {
    attrs.push({ trait_type: 'Color Band', value: colorBandName(check.colorBand) })
    attrs.push({ trait_type: 'Gradient',   value: gradientName(check.gradient) })
  }
  if (check.isRevealed && check.checksCount > 0) {
    attrs.push({ trait_type: 'Speed', value: formatSpeed(check.speed) })
    attrs.push({ trait_type: 'Shift', value: formatShift(check.direction) })
  }
  attrs.push({ trait_type: 'Checks', value: String(check.checksCount) })
  attrs.push({ trait_type: 'Day',    value: String(check.stored.day) })
  return attrs
}

/**
 * parseTokenURI — Node.js version (uses Buffer instead of atob).
 * Input: data:application/json;base64,<...>
 */
export function parseTokenURI(dataUri: string): ParsedTokenURI {
  const base64 = dataUri.replace(/^data:application\/json;base64,/, '')
  const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))

  const svgBase64 = (json.image as string).replace(/^data:image\/svg\+xml;base64,/, '')
  const svg = Buffer.from(svgBase64, 'base64').toString('utf8')

  return {
    name: json.name as string,
    svg,
    attributes: (json.attributes ?? []) as Attribute[],
  }
}

// ─── Composite engine ────────────────────────────────────────────────────────

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

export function gradientIndex(check: CheckStruct, divisorIndex: number): number {
  const n = Number(randomSalted(check.seed, 'gradient', 100n))
  if (divisorIndex === 0) {
    return n < 20 ? 1 + (n % 6) : 0
  }
  if (divisorIndex < 6) return check.stored.gradients[divisorIndex - 1]
  return 0
}

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

/**
 * simulateCompositeJS — mirrors Checks.simulateComposite in JS.
 * burnerVirtualId: a number used as the composite pointer in the result struct.
 *   For L1 operations: use the burner's actual token ID.
 *   For L2 operations: use CD_VIRTUAL_ID (65535).
 */
export function simulateCompositeJS(
  keeper: CheckStruct,
  burner: CheckStruct,
  burnerVirtualId: number
): CheckStruct {
  const divisorIndex = keeper.stored.divisorIndex
  const nextDivisor = divisorIndex + 1

  const composites = [...keeper.stored.composites] as number[]
  composites[divisorIndex] = burnerVirtualId

  const colorBands = [...keeper.stored.colorBands] as number[]
  const gradients  = [...keeper.stored.gradients] as number[]

  if (divisorIndex < 5) {
    const { gradient, colorBand } = compositeGenesJS(keeper, burner)
    colorBands[divisorIndex] = colorBand
    gradients[divisorIndex]  = gradient
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
    isRevealed:   keeper.isRevealed,
    seed:         keeper.seed,
    checksCount:  DIVISORS[nextDivisor],
    hasManyChecks:nextDivisor < 6,
    composite:    composites[nextDivisor - 1] ?? 0,
    isRoot:       false,
    colorBand:    0,
    gradient:     0,
    direction:    keeper.direction,
    speed:        keeper.speed,
  }

  result.colorBand = colorBandIndex(result, nextDivisor)
  result.gradient  = gradientIndex(result, nextDivisor)

  return result
}

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
  if (checksCount === 0) return indexes
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

export function generateSVGJS(
  check: CheckStruct,
  virtualMap: Map<number, CheckStruct>
): string {
  const CHECKS_PATH = 'M21.36 9.886A3.933 3.933 0 0 0 18 8c-1.423 0-2.67.755-3.36 1.887a3.935 3.935 0 0 0-4.753 4.753A3.933 3.933 0 0 0 8 18c0 1.423.755 2.669 1.886 3.36a3.935 3.935 0 0 0 4.753 4.753 3.933 3.933 0 0 0 4.863 1.59 3.953 3.953 0 0 0 1.858-1.589 3.935 3.935 0 0 0 4.753-4.754A3.933 3.933 0 0 0 28 18a3.933 3.933 0 0 0-1.887-3.36 3.934 3.934 0 0 0-1.042-3.711 3.934 3.934 0 0 0-3.71-1.043Zm-3.958 11.713 4.562-6.844c.566-.846-.751-1.724-1.316-.878l-4.026 6.043-1.371-1.368c-.717-.722-1.836.396-1.116 1.116l2.17 2.15a.788.788 0 0 0 1.097-.22Z'

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
  const perRowCount = perRow(count)
  const indent = count === 40
  let curRowX = rowX(count)
  let curRowY = rowY(count)

  let gridRowContent = ''
  for (let i = 0; i < 8; i++) {
    gridRowContent += `<use href="#square" x="${196 + i * 36}" y="160"/>`
  }
  let gridContent = ''
  for (let i = 0; i < 10; i++) {
    gridContent += `<use href="#row" y="${i * 36}"/>`
  }

  let checksContent = ''
  for (let i = 0; i < count; i++) {
    const indexInRow = i % perRowCount
    const isNewRow = indexInRow === 0 && i > 0

    if (isNewRow) {
      curRowY += spaceY
      if (indent) {
        if (i % (perRowCount * 2) === 0) {
          curRowX -= spaceX / 2
        } else {
          curRowX += spaceX / 2
        }
      }
    }

    const tx = curRowX + indexInRow * spaceX
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

    checksContent += `<g transform="translate(${tx}, ${curRowY}) scale(${scale})"><use href="#check" fill="#${color}">${animContent}</use></g>`
  }

  return [
    `<svg viewBox="0 0 680 680" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;background:black;">`,
    `<defs>`,
    `<path id="check" fill-rule="evenodd" d="${CHECKS_PATH}"></path>`,
    `<rect id="square" width="36" height="36" stroke="${gridColor}"></rect>`,
    `<g id="row">${gridRowContent}</g>`,
    `</defs>`,
    `<rect width="680" height="680" fill="black"/>`,
    `<rect x="188" y="152" width="304" height="376" fill="${canvasColor}"/>`,
    `<g id="grid" x="196" y="160">${gridContent}</g>`,
    checksContent,
    `<rect width="680" height="680" fill="transparent">`,
    `<animate attributeName="width" from="680" to="0" dur="0.2s" begin="click" fill="freeze" id="animation"/>`,
    `</rect>`,
    `</svg>`,
  ].join('')
}

// ─── SVG layout helpers ───────────────────────────────────────────────────────

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

// ─── L2 composite helper ──────────────────────────────────────────────────────

/** Virtual ID used as the L1b pointer when computing the L2 composite. */
export const CD_VIRTUAL_ID = 65535

/**
 * computeL2 — computes the ABCD (L2) composite check struct.
 * Mirrors the computeL2JS logic in frontend/src/useAllPermutations.ts.
 *
 * @param l1a  Result of simulateCompositeJS(keeper1, burner1, burner1.token_id)
 * @param l1b  Result of simulateCompositeJS(keeper2, burner2, burner2.token_id)
 */
export function computeL2(l1a: CheckStruct, l1b: CheckStruct): CheckStruct {
  const l1aComposites = [...l1a.stored.composites] as number[]
  l1aComposites[l1a.stored.divisorIndex] = CD_VIRTUAL_ID
  const l1aWithPointer: CheckStruct = {
    ...l1a,
    stored: { ...l1a.stored, composites: l1aComposites },
  }
  return simulateCompositeJS(l1aWithPointer, l1b, CD_VIRTUAL_ID)
}

/**
 * buildL2RenderMap — constructs the virtualMap needed by generateSVGJS for ABCD.
 *
 * @param l1a        L1a struct (composite pointer already set to CD_VIRTUAL_ID by computeL2)
 * @param l1b        L1b struct
 * @param burner1    Original burner of pair 1 (token B)
 * @param burner2    Original burner of pair 2 (token D)
 */
export function buildL2RenderMap(
  l1a: CheckStruct,
  l1b: CheckStruct,
  burner1: CheckStruct,
  burner2: CheckStruct
): Map<number, CheckStruct> {
  return new Map<number, CheckStruct>([
    [CD_VIRTUAL_ID,   l1b],
    [l1a.composite,   burner1],
    [l1b.composite,   burner2],
  ])
}
