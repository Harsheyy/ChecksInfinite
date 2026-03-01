import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TreePanel } from './TreePanel'
import { WagmiWrapper } from '../test-utils'
import type { PermutationResult } from '../useAllPermutations'

function makeResult(): PermutationResult {
  const card = { name: 'Token', svg: '', attributes: [], loading: false, error: '' }
  return {
    def: { indices: [0,1,2,3], label: '#1▸#2, #3▸#4', tokenIds: ['1','2','3','4'] },
    nodeA: card, nodeB: card, nodeC: card, nodeD: card,
    nodeL1a: card, nodeL1b: card, nodeAbcd: card,
  }
}

function renderPanel(onClose = vi.fn()) {
  return render(
    <WagmiWrapper>
      <TreePanel result={makeResult()} ids={[]} onClose={onClose} />
    </WagmiWrapper>
  )
}

describe('TreePanel', () => {
  it('renders the panel (not an overlay)', () => {
    const { container } = renderPanel()
    expect(container.querySelector('.tree-panel')).toBeTruthy()
    expect(container.querySelector('.tree-modal-overlay')).toBeNull()
  })

  it('shows the permutation label in the header', () => {
    renderPanel()
    expect(screen.getByText('#1▸#2, #3▸#4')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    renderPanel(onClose)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderPanel(onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a sticky footer with buy button in dbMode', () => {
    render(
      <WagmiWrapper>
        <TreePanel result={makeResult()} ids={[]} onClose={vi.fn()} dbMode />
      </WagmiWrapper>
    )
    expect(document.querySelector('.tree-panel-footer')).toBeTruthy()
    expect(screen.getByRole('button', { name: /buy/i })).toBeInTheDocument()
  })

  it('does not render the footer outside dbMode', () => {
    renderPanel()
    expect(document.querySelector('.tree-panel-footer')).toBeNull()
  })
})
