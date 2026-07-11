// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LoadingDots } from './LoadingDots'

afterEach(() => cleanup())

describe('LoadingDots', () => {
  it('defaults label to Loading', () => {
    render(<LoadingDots />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading')
  })

  it('accepts a custom label', () => {
    render(<LoadingDots label="Loading history" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading history')
  })
})
