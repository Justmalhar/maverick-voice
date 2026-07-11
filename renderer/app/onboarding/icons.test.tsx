// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ICONS } from './icons'

afterEach(() => cleanup())

describe('ICONS', () => {
  it('exposes every expected glyph key', () => {
    expect(Object.keys(ICONS).sort()).toEqual(
      ['check', 'chain', 'gear', 'key', 'keyboard', 'mic', 'shield', 'wand', 'waveform'].sort()
    )
  })

  it.each(Object.entries(ICONS))('renders the %s glyph as an svg with no visible text', (_name, glyph) => {
    const { container } = render(<>{glyph}</>)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
})
