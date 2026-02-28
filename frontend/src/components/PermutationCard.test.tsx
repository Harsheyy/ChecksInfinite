import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PermutationCard } from './PermutationCard'
import type { PermutationResult } from '../useAllPermutations'

// Mock IntersectionObserver (not available in jsdom)
const observeMock = vi.fn()
const disconnectMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', vi.fn().mockImplementation(function (_cb) {
    return {
      observe: observeMock,
      disconnect: disconnectMock,
    }
  }))
})

function makeResult(overrides: Partial<PermutationResult['nodeAbcd']> = {}): PermutationResult {
  const card = { name: 'Test', svg: '', attributes: [], loading: false, error: '', ...overrides }
  return {
    def: { indices: [0, 1, 2, 3], label: '#1▸#2, #3▸#4' },
    nodeA: card, nodeB: card, nodeC: card, nodeD: card,
    nodeL1a: card, nodeL1b: card,
    nodeAbcd: card,
  }
}

describe('PermutationCard', () => {
  it('renders spacer div when not visible', () => {
    const { container } = render(
      <PermutationCard result={makeResult()} visible={false} onClick={vi.fn()} />
    )
    expect(container.querySelector('.perm-card-spacer')).toBeInTheDocument()
    expect(container.querySelector('.perm-card')).toBeNull()
  })

  it('renders pulse div when loading', () => {
    const { container } = render(
      <PermutationCard result={makeResult({ loading: true })} visible={true} onClick={vi.fn()} />
    )
    expect(container.querySelector('.perm-card-pulse')).toBeInTheDocument()
  })

  it('renders error div when error is set', () => {
    const { container } = render(
      <PermutationCard result={makeResult({ error: 'oops' })} visible={true} onClick={vi.fn()} />
    )
    expect(container.querySelector('.perm-card-error')).toBeInTheDocument()
    expect(container.querySelector('.perm-card-error')?.textContent).toBe('✕')
  })

  it('does not render SVG when inView is false (IntersectionObserver not fired)', () => {
    const { container } = render(
      <PermutationCard result={makeResult({ svg: '<svg/>' })} visible={true} onClick={vi.fn()} />
    )
    // IntersectionObserver was set up but never fired — inView stays false
    expect(container.querySelector('.perm-card-svg')).toBeNull()
  })

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(
      <PermutationCard result={makeResult()} visible={true} onClick={onClick} />
    )
    const card = container.querySelector('.perm-card') as HTMLElement
    card?.click()
    expect(onClick).toHaveBeenCalledOnce()
  })
})
