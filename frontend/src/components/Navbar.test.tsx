// frontend/src/components/Navbar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Navbar } from './Navbar'
import { WagmiWrapper } from '../test-utils'

function renderNavbar(props: Parameters<typeof Navbar>[0]) {
  return render(<WagmiWrapper><Navbar {...props} /></WagmiWrapper>)
}

const baseProps = {
  ids: '', loading: false, onIdsChange: vi.fn(), onPreview: vi.fn(), error: '',
}

describe('Navbar', () => {
  it('renders brand text "Checks Infinite"', () => {
    renderNavbar(baseProps)
    expect(screen.getByText('Checks Infinite')).toBeInTheDocument()
  })

  it('renders input and preview button when not dbMode', () => {
    renderNavbar(baseProps)
    expect(screen.getByPlaceholderText(/1234/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview/ })).toBeInTheDocument()
  })

  it('renders wallet button', () => {
    renderNavbar(baseProps)
    expect(screen.getByRole('button', { name: /Connect Wallet/ })).toBeInTheDocument()
  })

  it('shows error message when error prop is set', () => {
    renderNavbar({ ...baseProps, error: 'Enter at least 4 IDs' })
    expect(screen.getByText('Enter at least 4 IDs')).toBeInTheDocument()
  })

  it('disables preview button when loading', () => {
    renderNavbar({ ...baseProps, loading: true })
    expect(screen.getByRole('button', { name: /Loading/ })).toBeDisabled()
  })

  it('calls onPreview on form submit', () => {
    const onPreview = vi.fn()
    renderNavbar({ ...baseProps, ids: '1,2,3,4', onPreview })
    fireEvent.submit(screen.getByRole('form'))
    expect(onPreview).toHaveBeenCalledOnce()
  })

  it('calls onIdsChange when input value changes', () => {
    const onIdsChange = vi.fn()
    renderNavbar({ ...baseProps, onIdsChange })
    fireEvent.change(screen.getByPlaceholderText(/1234/), { target: { value: '1,2,3,4' } })
    expect(onIdsChange).toHaveBeenCalledWith('1,2,3,4')
  })

  it('does not render view toggle when viewMode prop is absent', () => {
    renderNavbar(baseProps)
    expect(screen.queryByRole('button', { name: /Token Works/ })).toBeNull()
  })

  it('renders view toggle buttons when viewMode is provided', () => {
    renderNavbar({ ...baseProps, viewMode: 'token-works', onViewModeChange: vi.fn() })
    expect(screen.getByRole('button', { name: 'Token Works' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My Checks' })).toBeInTheDocument()
  })

  it('calls onViewModeChange with "my-checks" when My Checks is clicked', () => {
    const onViewModeChange = vi.fn()
    renderNavbar({ ...baseProps, viewMode: 'token-works', onViewModeChange })
    fireEvent.click(screen.getByRole('button', { name: 'My Checks' }))
    expect(onViewModeChange).toHaveBeenCalledWith('my-checks')
  })

  it('marks the active mode button', () => {
    renderNavbar({ ...baseProps, viewMode: 'my-checks', onViewModeChange: vi.fn() })
    expect(screen.getByRole('button', { name: 'My Checks' })).toHaveClass('view-toggle-btn--active')
    expect(screen.getByRole('button', { name: 'Token Works' })).not.toHaveClass('view-toggle-btn--active')
  })
})
