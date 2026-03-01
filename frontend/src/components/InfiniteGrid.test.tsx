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

  it('renders 9 tile copies when permutations are present', () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = renderGrid({
      permutations: perms, ids: ['1','2','3','4'], showFlags: [true],
    })
    // 9 tiles × 1 card each = 9 .perm-card or .perm-card-spacer elements
    const cards = container.querySelectorAll('.perm-card, .perm-card-spacer')
    expect(cards.length).toBe(9)
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

  it('teleports scrollLeft back to center when scrolled past right tile', async () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = renderGrid({
      permutations: perms, ids: ['1','2','3','4'], showFlags: [true],
    })
    const viewport = container.querySelector('.grid-viewport') as HTMLElement
    // tileRef is attached to the center (5th) .infinite-tile in the 3x3 grid
    const tiles = container.querySelectorAll('.infinite-tile')
    const tile = tiles[4] as HTMLElement  // center tile (index 4)

    // Mock tile dimensions on the .infinite-tile element itself
    Object.defineProperty(tile, 'offsetWidth', { value: 1000, configurable: true })
    Object.defineProperty(tile, 'offsetHeight', { value: 800, configurable: true })

    // Simulate scrolled past the right tile boundary (>= 2 * tileWidth)
    viewport.scrollLeft = 2000  // >= 2 * 1000
    viewport.scrollTop = 800    // == tileHeight (in range)
    fireEvent.scroll(viewport)

    // Should teleport back by one tile width
    expect(viewport.scrollLeft).toBe(1000)
    expect(viewport.scrollTop).toBe(800)  // unchanged (in center range)
  })

  it('teleports scrollLeft forward when scrolled before left tile', async () => {
    const perms = [makePermutation('A▸B, C▸D')]
    const { container } = renderGrid({
      permutations: perms, ids: ['1','2','3','4'], showFlags: [true],
    })
    const viewport = container.querySelector('.grid-viewport') as HTMLElement
    // tileRef is attached to the center (5th) .infinite-tile in the 3x3 grid
    const tiles = container.querySelectorAll('.infinite-tile')
    const tile = tiles[4] as HTMLElement  // center tile (index 4)

    Object.defineProperty(tile, 'offsetWidth', { value: 1000, configurable: true })
    Object.defineProperty(tile, 'offsetHeight', { value: 800, configurable: true })

    // Simulate scrolled before the left tile boundary (< tileWidth)
    viewport.scrollLeft = 500  // < 1000
    viewport.scrollTop = 800   // in range
    fireEvent.scroll(viewport)

    expect(viewport.scrollLeft).toBe(1500)  // 500 + 1000
    expect(viewport.scrollTop).toBe(800)
  })
})
