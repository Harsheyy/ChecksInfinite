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

export function parseIds(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

export function validateIds(ids: string[], hasKey: boolean): string {
  if (!hasKey) return 'VITE_ALCHEMY_API_KEY is not set in .env'
  if (ids.length < 4) return 'Enter at least 4 token IDs separated by commas.'
  for (const id of ids) {
    if (!/^\d+$/.test(id)) return `"${id}" is not a valid token ID.`
  }
  if (new Set(ids).size < ids.length) return 'All token IDs must be unique.'
  return ''
}

export interface CardState {
  name: string
  svg: string
  attributes: Attribute[]
  loading: boolean
  error: string
}
