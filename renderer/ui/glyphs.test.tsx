// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import {
  CheckGlyph,
  ChevronRightGlyph,
  CopyGlyph,
  EyeGlyph,
  EyeOffGlyph,
  GearGlyph,
  MicGlyph,
  PlusGlyph,
  TrashGlyph
} from './glyphs'

const glyphs = {
  TrashGlyph,
  CopyGlyph,
  CheckGlyph,
  PlusGlyph,
  ChevronRightGlyph,
  MicGlyph,
  GearGlyph,
  EyeGlyph,
  EyeOffGlyph
}

afterEach(() => cleanup())

describe('glyphs', () => {
  it.each(Object.entries(glyphs))('%s renders an svg with default props', (_name, Glyph) => {
    const { container } = render(<Glyph />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
    expect(svg).toHaveAttribute('stroke-width', '2')
    expect(svg).not.toHaveAttribute('class')
  })

  it('applies custom size, strokeWidth and className overrides', () => {
    const { container } = render(<CheckGlyph size={24} strokeWidth={4} className="my-class" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')
    expect(svg).toHaveAttribute('stroke-width', '4')
    expect(svg).toHaveClass('my-class')
  })
})
