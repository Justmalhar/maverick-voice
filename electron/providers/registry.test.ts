import { describe, expect, it } from 'vitest'
import {
  getLLMProvider,
  getTranscriptionProvider,
  listLLMProviders,
  listTranscriptionProviders
} from './registry'

describe('providers/registry', () => {
  describe('getTranscriptionProvider', () => {
    it('resolves every registered STT provider id with expected shape', () => {
      expect(getTranscriptionProvider('deepgram').label).toBe('Deepgram')
      expect(getTranscriptionProvider('openai').defaultModel).toBe('gpt-4o-mini-transcribe')
      expect(getTranscriptionProvider('groq').defaultModel).toBe('whisper-large-v3-turbo')
      const local = getTranscriptionProvider('local')
      expect(local.requiresKey).toBe(false)
      expect(local.models).toEqual([])
    })

    it('throws a clear error for an unknown id', () => {
      expect(() => getTranscriptionProvider('bogus' as never)).toThrow('Unknown transcription provider: "bogus"')
    })
  })

  describe('getLLMProvider', () => {
    it('resolves every registered LLM provider id with expected shape', () => {
      expect(getLLMProvider('openai').defaultModel).toBe('gpt-4o-mini')
      expect(getLLMProvider('groq').defaultBaseUrl).toBe('https://api.groq.com/openai/v1')
      const openrouter = getLLMProvider('openrouter')
      expect(openrouter.defaultModel).toBe('openai/gpt-4o-mini')
      const custom = getLLMProvider('custom')
      expect(custom.defaultBaseUrl).toBe('')
      expect(custom.models).toEqual([])
    })

    it('throws a clear error for an unknown id', () => {
      expect(() => getLLMProvider('bogus' as never)).toThrow('Unknown LLM provider: "bogus"')
    })
  })

  it('listTranscriptionProviders returns all 4 registered providers', () => {
    const list = listTranscriptionProviders()
    expect(list.map((p) => p.id).sort()).toEqual(['deepgram', 'groq', 'local', 'openai'])
  })

  it('listLLMProviders returns all 4 registered providers', () => {
    const list = listLLMProviders()
    expect(list.map((p) => p.id).sort()).toEqual(['custom', 'groq', 'openai', 'openrouter'])
  })
})
