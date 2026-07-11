import { describe, expect, it } from 'vitest'
import { groqLlmProvider } from './groq'

describe('providers/llm/groq', () => {
  it('exposes the Groq config', () => {
    expect(groqLlmProvider.id).toBe('groq')
    expect(groqLlmProvider.label).toBe('Groq')
    expect(groqLlmProvider.defaultBaseUrl).toBe('https://api.groq.com/openai/v1')
    expect(groqLlmProvider.defaultModel).toBe('llama-3.3-70b-versatile')
    expect(groqLlmProvider.models.map((m) => m.id)).toContain('llama-3.1-8b-instant')
  })
})
