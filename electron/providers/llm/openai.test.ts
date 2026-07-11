import { describe, expect, it } from 'vitest'
import { openaiProvider } from './openai'

// Thin factory over createOpenAICompatibleProvider (covered in
// ../openaiCompatible.test.ts) — assert only the wired-in config surface.
describe('providers/llm/openai', () => {
  it('exposes the OpenAI config', () => {
    expect(openaiProvider.id).toBe('openai')
    expect(openaiProvider.label).toBe('OpenAI')
    expect(openaiProvider.defaultBaseUrl).toBe('https://api.openai.com/v1')
    expect(openaiProvider.defaultModel).toBe('gpt-4o-mini')
    expect(openaiProvider.models.map((m) => m.id)).toContain('gpt-4o')
  })
})
