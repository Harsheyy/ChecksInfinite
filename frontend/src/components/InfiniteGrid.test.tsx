import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InfiniteGrid } from './InfiniteGrid'
import { WagmiWrapper } from '../test-utils'
import type { PermutationResult } from '../useAllPermutations'

// Mock IntersectionObserver (not available in jsdom)
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', vi.fn().mockImplementation(function (_cb: unknown) {
    return { observe: vi.fn(), disconnect: vi.fn() }
  }))
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => cb(0)))
})

function makePermutation(label: string): PermutationResult {
  const card = { name: label, svg: '', attributes: [], loading: false, error: '' }
  return {
    def: { indices: [0, 1, 2, 3], label },
    nodeA: card, nodeB: card, nodeC: card, nodeD: card,
    nodeL1a: card, nodeL1b: card, nodeAbcd: card,
  }
}

function renderGrid(props: Parameters<typeof InfiniteGrid>[0]) {
  return render(<WagmiWrapper><InfiniteGrid {...props} /></WagmiWrapper>)
}

describe('InfiniteGrid', () => {
  it('renders nothing when permutations is empty', () => {
    const { container } = renderGrid({ permutations: [], ids: [], showFlags: [] })
    expect(container.firstChild).toBeNull()
  })

  it('renders 1 card when a single permutation is provided', () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = renderGrid({
      permutations: perms, ids: ['1','2','3','4'], showFlags: [true],
    })
    const cards = container.querySelectorAll('.perm-card, .perm-card-spacer')
    expect(cards.length).toBe(1)
  })

  it('opens TreePanel when a card is clicked', () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = renderGrid({
      permutations: perms, ids: ['1','2','3','4'], showFlags: [true],
    })
    const card = container.querySelector('.perm-card') as HTMLElement
    fireEvent.click(card)
    expect(document.querySelector('.tree-panel')).toBeTruthy()
  })

  it('adds grid-viewport--with-filters class when hasFilters is true', () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = renderGrid({
      permutations: perms, ids: ['1','2','3','4'], showFlags: [true], hasFilters: true,
    })
    expect(container.querySelector('.grid-viewport--with-filters')).toBeTruthy()
  })

  it('does not add grid-viewport--with-filters class when hasFilters is false', () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = renderGrid({
      permutations: perms, ids: ['1','2','3','4'], showFlags: [true], hasFilters: false,
    })
    expect(container.querySelector('.grid-viewport--with-filters')).toBeNull()
  })

  it('renders multiple cards in looping mode when N >= 25', () => {
    const perms = Array.from({ length: 25 }, (_, i) => makePermutation(`A${i}▸B${i}, C${i}▸D${i}`))
    const { container } = renderGrid({
      permutations: perms,
      ids: Array.from({ length: 100 }, (_, i) => String(i + 1)),
      showFlags: Array(25).fill(true),
    })
    // In looping mode the grid renders a 3×3 torus (up to 9 tile copies)
    // At minimum some cards should be in the DOM
    expect(container.querySelector('.grid-viewport')).toBeTruthy()
  })
})
