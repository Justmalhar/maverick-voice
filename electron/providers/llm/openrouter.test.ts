import { describe, expect, it } from 'vitest'
import { openrouterProvider } from './openrouter'

describe('providers/llm/openrouter', () => {
  it('exposes the OpenRouter config with attribution headers', () => {
    expect(openrouterProvider.id).toBe('openrouter')
    expect(openrouterProvider.label).toBe('OpenRouter')
    expect(openrouterProvider.defaultBaseUrl).toBe('https://openrouter.ai/api/v1')
    expect(openrouterProvider.defaultModel).toBe('openai/gpt-4o-mini')
    expect(openrouterProvider.models.map((m) => m.id)).toContain('anthropic/claude-3.5-sonnet')
  })
})
