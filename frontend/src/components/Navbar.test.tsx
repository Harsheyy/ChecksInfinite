import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Navbar } from './Navbar'
import { WagmiWrapper } from '../test-utils'

function renderNavbar(props: Parameters<typeof Navbar>[0]) {
  return render(<WagmiWrapper><Navbar {...props} /></WagmiWrapper>)
}

describe('Navbar', () => {
  it('renders brand, input, preview button, wallet button', () => {
    renderNavbar({ ids: '', loading: false, onIdsChange: vi.fn(), onPreview: vi.fn(), error: '' })
    expect(screen.getByText('◆ Checks Infinite')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/1234/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Connect Wallet/ })).toBeInTheDocument()
  })

  it('shows error message when error prop is set', () => {
    renderNavbar({ ids: '', loading: false, onIdsChange: vi.fn(), onPreview: vi.fn(), error: 'Enter at least 4 IDs' })
    expect(screen.getByText('Enter at least 4 IDs')).toBeInTheDocument()
  })

  it('disables preview button when loading', () => {
    renderNavbar({ ids: '', loading: true, onIdsChange: vi.fn(), onPreview: vi.fn(), error: '' })
    expect(screen.getByRole('button', { name: /Loading/ })).toBeDisabled()
  })

  it('calls onPreview on form submit', () => {
    const onPreview = vi.fn()
    renderNavbar({ ids: '1,2,3,4', loading: false, onIdsChange: vi.fn(), onPreview, error: '' })
    fireEvent.submit(screen.getByRole('form'))
    expect(onPreview).toHaveBeenCalledOnce()
  })

  it('calls onIdsChange when input value changes', () => {
    const onIdsChange = vi.fn()
    renderNavbar({ ids: '', loading: false, onIdsChange, onPreview: vi.fn(), error: '' })
    fireEvent.change(screen.getByPlaceholderText(/1234/), { target: { value: '1,2,3,4' } })
    expect(onIdsChange).toHaveBeenCalledWith('1,2,3,4')
  })
})
