import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CheckCard } from './CheckCard'

describe('CheckCard', () => {
  const attrs = [
    { trait_type: 'Checks', value: '80' },
    { trait_type: 'Color Band', value: 'Sixty' },
  ]

  it('renders the token name', () => {
    render(<CheckCard name="Checks 42" svg="<svg/>" attributes={attrs} />)
    expect(screen.getByText('Checks 42')).toBeInTheDocument()
  })

  it('renders all attribute labels and values', () => {
    render(<CheckCard name="Checks 42" svg="<svg/>" attributes={attrs} />)
    expect(screen.getByText('Checks')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('Color Band')).toBeInTheDocument()
    expect(screen.getByText('Sixty')).toBeInTheDocument()
  })

  it('shows loading state when loading=true', () => {
    render(<CheckCard name="" svg="" attributes={[]} loading />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows error message when error is provided', () => {
    render(<CheckCard name="" svg="" attributes={[]} error="Token not found" />)
    expect(screen.getByText('Token not found')).toBeInTheDocument()
  })

  it('compact: renders only Checks and Color Band attributes', () => {
    const attrs = [
      { trait_type: 'Checks', value: '20' },
      { trait_type: 'Color Band', value: 'Sixty' },
      { trait_type: 'Speed', value: '2x' },
      { trait_type: 'Gradient', value: 'None' },
    ]
    render(<CheckCard name="Token" svg="<svg/>" attributes={attrs} compact />)
    expect(screen.getByText('Checks')).toBeInTheDocument()
    expect(screen.getByText('Color Band')).toBeInTheDocument()
    expect(screen.queryByText('Speed')).toBeNull()
    expect(screen.queryByText('Gradient')).toBeNull()
  })

  it('compact: still renders the token name and svg', () => {
    render(<CheckCard name="Token #42" svg="<svg/>" attributes={[]} compact />)
    expect(screen.getByText('Token #42')).toBeInTheDocument()
  })
})
