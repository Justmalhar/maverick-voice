// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Kbd } from './Kbd'

afterEach(() => cleanup())

describe('Kbd', () => {
  it('renders children with base kbd class when no className given', () => {
    render(<Kbd>Enter</Kbd>)
    const el = screen.getByText('Enter')
    expect(el.tagName).toBe('KBD')
    expect(el.className).toBe('kbd')
  })

  it('appends className when provided', () => {
    render(<Kbd className="extra">Esc</Kbd>)
    const el = screen.getByText('Esc')
    expect(el.className).toBe('kbd extra')
  })
})
