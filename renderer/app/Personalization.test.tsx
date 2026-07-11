// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Personalization from './Personalization'

vi.mock('./Dictionary', () => ({ default: () => <div data-testid="page-words">dictionary</div> }))
vi.mock('./Replacements', () => ({ default: () => <div data-testid="page-swaps">replacements</div> }))
vi.mock('./Snippets', () => ({ default: () => <div data-testid="page-snippets">snippets</div> }))
vi.mock('./Rules', () => ({ default: () => <div data-testid="page-rules">rules</div> }))

afterEach(() => cleanup())

describe('Personalization', () => {
  it('renders a segmented sub-nav with the plain IA-3 labels', () => {
    render(<Personalization />)
    const nav = screen.getByRole('radiogroup', { name: 'Personalization section' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Words' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Swaps' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Snippets' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'AI Rules' })).toBeInTheDocument()
  })

  it('mounts all four pages up front, defaulting to Words visible', () => {
    render(<Personalization />)
    expect(screen.getByTestId('page-words').closest('section')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('page-swaps').closest('section')).toHaveAttribute('hidden')
    expect(screen.getByTestId('page-snippets').closest('section')).toHaveAttribute('hidden')
    expect(screen.getByTestId('page-rules').closest('section')).toHaveAttribute('hidden')
  })

  it('switches sub-tabs without unmounting siblings (no-remount rule)', async () => {
    render(<Personalization />)

    await userEvent.click(screen.getByRole('radio', { name: 'Swaps' }))
    expect(screen.getByTestId('page-words').closest('section')).toHaveAttribute('hidden')
    expect(screen.getByTestId('page-swaps').closest('section')).not.toHaveAttribute('hidden')
    // Words page is still mounted, just hidden.
    expect(screen.getByTestId('page-words')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'AI Rules' }))
    expect(screen.getByTestId('page-rules').closest('section')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('page-swaps').closest('section')).toHaveAttribute('hidden')
    // All four remain mounted throughout.
    expect(screen.getByTestId('page-words')).toBeInTheDocument()
    expect(screen.getByTestId('page-swaps')).toBeInTheDocument()
    expect(screen.getByTestId('page-snippets')).toBeInTheDocument()
    expect(screen.getByTestId('page-rules')).toBeInTheDocument()
  })
})
