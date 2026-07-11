import { describe, expect, it } from 'vitest'
import { customLlmProvider } from './custom'

describe('providers/llm/custom', () => {
  it('has no default base URL or model (user supplies both) and an empty model list', () => {
    expect(customLlmProvider.id).toBe('custom')
    expect(customLlmProvider.label).toBe('Custom')
    expect(customLlmProvider.defaultBaseUrl).toBe('')
    expect(customLlmProvider.defaultModel).toBe('')
    expect(customLlmProvider.models).toEqual([])
  })
})
