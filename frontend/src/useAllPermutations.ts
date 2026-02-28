import { useState } from 'react'
import { checksClient, CHECKS_CONTRACT } from './client'
import { CHECKS_ABI } from './checksAbi'
import { parseTokenURI, mapCheckAttributes, type CheckStruct, type CardState } from './utils'
import { simulateCompositeJS, generateSVGJS } from './checksArtJS'

export type { CardState } from './utils'

export interface PermutationDef {
  // Four indices into the ids[] array: [pair1-keeper, pair1-burner, pair2-keeper, pair2-burner]
  indices: [number, number, number, number]
  label: string
  // DB mode: actual token ID strings embedded directly (avoids needing a global ids[] lookup)
  tokenIds?: [string, string, string, string]
}

export interface PermutationResult {
  def: PermutationDef
  nodeA: CardState
  nodeB: CardState
  nodeC: CardState
  nodeD: CardState
  nodeL1a: CardState
  nodeL1b: CardState
  nodeAbcd: CardState
}

export interface AllPermutationsState {
  permutations: PermutationResult[]
  leafsReady: boolean
}

/** Generate all ordered 4-tuples from [0..n-1] with no repeated index. */
function generatePermDefs(ids: string[]): PermutationDef[] {
  const n = ids.length
  const defs: PermutationDef[] = []
  for (let p0 = 0; p0 < n; p0++) {
    for (let p1 = 0; p1 < n; p1++) {
      if (p1 === p0) continue
      for (let p2 = 0; p2 < n; p2++) {
        if (p2 === p0 || p2 === p1) continue
        for (let p3 = 0; p3 < n; p3++) {
          if (p3 === p0 || p3 === p1 || p3 === p2) continue
          const indices: [number, number, number, number] = [p0, p1, p2, p3]
          const label = `#${ids[p0]}▸#${ids[p1]}, #${ids[p2]}▸#${ids[p3]}`
          defs.push({ indices, label })
        }
      }
    }
  }
  return defs
}

function loadingCard(name: string): CardState {
  return { name, svg: '', attributes: [], loading: true, error: '' }
}

function loadingPermutation(def: PermutationDef, ids: string[]): PermutationResult {
  const [p0, p1, p2, p3] = def.indices
  return {
    def,
    nodeA: loadingCard(`Token #${ids[p0]}`),
    nodeB: loadingCard(`Token #${ids[p1]}`),
    nodeC: loadingCard(`Token #${ids[p2]}`),
    nodeD: loadingCard(`Token #${ids[p3]}`),
    nodeL1a: loadingCard(`Composite #${ids[p0]}+#${ids[p1]}`),
    nodeL1b: loadingCard(`Composite #${ids[p2]}+#${ids[p3]}`),
    nodeAbcd: loadingCard('Composite ABCD'),
  }
}

function resolveTokenURI(result: PromiseSettledResult<string>, name: string): CardState {
  if (result.status === 'fulfilled') {
    try {
      const parsed = parseTokenURI(result.value)
      return { name: parsed.name, svg: parsed.svg, attributes: parsed.attributes, loading: false, error: '' }
    } catch {
      return { name, svg: '', attributes: [], loading: false, error: 'Failed to parse token data' }
    }
  }
  return { name, svg: '', attributes: [], loading: false, error: humanizeError(result.reason) }
}

/** Render an L1 composite SVG in JS using the on-chain simulateComposite check struct. */
function resolveL1Card(
  name: string,
  checkResult: PromiseSettledResult<unknown>,
  burnerCheck: PromiseSettledResult<unknown>,
): CardState {
  if (checkResult.status !== 'fulfilled') {
    return { name, svg: '', attributes: [], loading: false, error: humanizeError((checkResult as PromiseRejectedResult).reason) }
  }
  if (burnerCheck.status !== 'fulfilled') {
    return { name, svg: '', attributes: [], loading: false, error: humanizeError((burnerCheck as PromiseRejectedResult).reason) }
  }
  try {
    const l1Check = checkResult.value as CheckStruct
    const bCheck = burnerCheck.value as CheckStruct
    // l1Check.composite = the real burner token ID (set by on-chain simulateComposite)
    const renderMap = new Map<number, CheckStruct>([[l1Check.composite, bCheck]])
    const svg = generateSVGJS(l1Check, renderMap)
    const attrs = mapCheckAttributes(l1Check)
    return { name, svg, attributes: attrs, loading: false, error: '' }
  } catch {
    return { name, svg: '', attributes: [], loading: false, error: 'Failed to build L1 composite preview' }
  }
}

const CD_VIRTUAL_ID = 65535

function computeL2JS(
  name: string,
  rawCheckBurner1: PromiseSettledResult<unknown>,
  rawCheckBurner2: PromiseSettledResult<unknown>,
  rawL1a: PromiseSettledResult<unknown>,
  rawL1b: PromiseSettledResult<unknown>,
): CardState {
  try {
    if (
      rawCheckBurner1.status !== 'fulfilled' || rawCheckBurner2.status !== 'fulfilled' ||
      rawL1a.status !== 'fulfilled' || rawL1b.status !== 'fulfilled'
    ) {
      return { name, svg: '', attributes: [], loading: false, error: 'One or more prerequisite checks failed — cannot compute L2 composite.' }
    }

    const burner1Check = rawCheckBurner1.value as CheckStruct
    const burner2Check = rawCheckBurner2.value as CheckStruct
    const l1a = rawL1a.value as CheckStruct
    const l1b = rawL1b.value as CheckStruct

    const l1aComposites = [...l1a.stored.composites] as number[]
    l1aComposites[l1a.stored.divisorIndex] = CD_VIRTUAL_ID
    const l1aWithPointer: CheckStruct = { ...l1a, stored: { ...l1a.stored, composites: l1aComposites } }

    const abcdCheck = simulateCompositeJS(l1aWithPointer, l1b, CD_VIRTUAL_ID)

    const renderMap = new Map<number, CheckStruct>([
      [CD_VIRTUAL_ID, l1b],
      [l1a.composite, burner1Check],
      [l1b.composite, burner2Check],
    ])

    const svg = generateSVGJS(abcdCheck, renderMap)
    const attrs = mapCheckAttributes(abcdCheck)
    return { name, svg, attributes: attrs, loading: false, error: '' }
  } catch (e) {
    return { name, svg: '', attributes: [], loading: false, error: humanizeError(e) }
  }
}

function humanizeError(err: unknown): string {
  const msg = String(err)
  if (msg.includes('NotAllowed')) return 'Tokens must have the same check count, be different, and exist on-chain.'
  if (msg.includes('revert')) return 'Contract reverted — tokens may not exist or may be incompatible.'
  if (msg.includes('network') || msg.includes('fetch')) return 'Network error — check your Alchemy key.'
  return 'Something went wrong. Check the token IDs and try again.'
}

export function useAllPermutations() {
  const [state, setState] = useState<AllPermutationsState>({
    permutations: [],
    leafsReady: false,
  })

  async function preview(ids: string[]) {
    const n = ids.length
    const bigIds = ids.map(id => BigInt(id))
    const permDefs = generatePermDefs(ids)

    setState({
      permutations: permDefs.map(def => loadingPermutation(def, ids)),
      leafsReady: false,
    })

    // Phase 1: tokenURI × n + getCheck × n (2n calls, batched via multicall)
    const phase1Calls = [
      ...bigIds.map(id =>
        checksClient.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'tokenURI', args: [id] })
      ),
      ...bigIds.map(id =>
        checksClient.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'getCheck', args: [id] })
      ),
    ]
    const phase1Results = await Promise.allSettled(phase1Calls)

    const uriResults = phase1Results.slice(0, n) as PromiseSettledResult<string>[]
    const checkResults = phase1Results.slice(n, 2 * n) as PromiseSettledResult<unknown>[]

    const leafCards = ids.map((id, i) => resolveTokenURI(uriResults[i], `Token #${id}`))

    setState(prev => ({
      leafsReady: true,
      permutations: prev.permutations.map(perm => {
        const [p0, p1, p2, p3] = perm.def.indices
        return { ...perm, nodeA: leafCards[p0], nodeB: leafCards[p1], nodeC: leafCards[p2], nodeD: leafCards[p3] }
      }),
    }))

    // Phase 2: simulateComposite × n·(n-1) ordered pairs (batched via multicall)
    // No simulateCompositeSVG calls — L1 SVG is computed in JS via generateSVGJS
    const orderedPairs: [number, number][] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) orderedPairs.push([i, j])
      }
    }

    const phase2Results = await Promise.allSettled(
      orderedPairs.map(([i, j]) =>
        checksClient.readContract({ address: CHECKS_CONTRACT, abi: CHECKS_ABI, functionName: 'simulateComposite', args: [bigIds[i], bigIds[j]] })
      )
    )

    // Build lookup: "i-j" → PromiseSettledResult<CheckStruct>
    const l1Map = new Map<string, PromiseSettledResult<unknown>>()
    orderedPairs.forEach(([i, j], idx) => {
      l1Map.set(`${i}-${j}`, phase2Results[idx])
    })

    const finalPermutations: PermutationResult[] = permDefs.map(def => {
      const [p0, p1, p2, p3] = def.indices
      const l1aResult = l1Map.get(`${p0}-${p1}`)!
      const l1bResult = l1Map.get(`${p2}-${p3}`)!

      const nodeL1a = resolveL1Card(
        `Composite #${ids[p0]}+#${ids[p1]}`,
        l1aResult,
        checkResults[p1],
      )
      const nodeL1b = resolveL1Card(
        `Composite #${ids[p2]}+#${ids[p3]}`,
        l1bResult,
        checkResults[p3],
      )
      const nodeAbcd = computeL2JS(
        'Composite ABCD',
        checkResults[p1],
        checkResults[p3],
        l1aResult,
        l1bResult,
      )

      return {
        def,
        nodeA: leafCards[p0],
        nodeB: leafCards[p1],
        nodeC: leafCards[p2],
        nodeD: leafCards[p3],
        nodeL1a,
        nodeL1b,
        nodeAbcd,
      }
    })

    setState({ permutations: finalPermutations, leafsReady: true })
  }

  return { state, preview }
}
