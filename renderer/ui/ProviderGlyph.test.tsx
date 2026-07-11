// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ProviderId } from '../../shared/types'
import { ProviderGlyph } from './ProviderGlyph'

afterEach(() => cleanup())

describe('ProviderGlyph', () => {
  const cases: ProviderId[] = ['groq', 'openai', 'openrouter', 'deepgram', 'local', 'custom']

  it.each(cases)('renders an svg for provider=%s', (provider) => {
    const { container } = render(<ProviderGlyph provider={provider} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('applies the custom size to the deepgram (inline svg) glyph', () => {
    const { container } = render(<ProviderGlyph provider="deepgram" size={32} />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '32')
  })

  it('returns null for an unknown provider', () => {
    const { container } = render(<ProviderGlyph provider={'unknown' as ProviderId} />)
    expect(container.innerHTML).toBe('')
  })
})
