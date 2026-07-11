// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from './Toggle'

afterEach(() => cleanup())

describe('Toggle', () => {
  it('reflects checked state via aria-checked and default md size class', () => {
    render(<Toggle checked={true} onChange={() => {}} aria-label="Sound" />)
    const el = screen.getByRole('switch', { name: 'Sound' })
    expect(el).toHaveAttribute('aria-checked', 'true')
    expect(el.className).toBe('ui-toggle')
  })

  it('applies sm size modifier class', () => {
    render(<Toggle checked={false} onChange={() => {}} size="sm" aria-label="Sound" />)
    expect(screen.getByRole('switch').className).toBe('ui-toggle ui-toggle--sm')
  })

  it('calls onChange with inverted value on click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle checked={false} onChange={onChange} aria-label="Sound" />)
    await user.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('disables the button and does not fire onChange when clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle checked={false} onChange={onChange} disabled aria-label="Sound" />)
    const el = screen.getByRole('switch')
    expect(el).toBeDisabled()
    await user.click(el)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('supports aria-labelledby instead of aria-label', () => {
    render(
      <>
        <span id="lbl">Label</span>
        <Toggle checked={false} onChange={() => {}} aria-labelledby="lbl" />
      </>
    )
    expect(screen.getByRole('switch', { name: 'Label' })).toBeInTheDocument()
  })
})
