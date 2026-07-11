import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, recordSttUsageMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), recordSttUsageMock: vi.fn() }))
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return { ...actual, fetch: (...a: unknown[]) => fetchMock(...a) }
})
vi.mock('../../store/usage', () => ({ recordSttUsage: recordSttUsageMock }))

import { createWhisperCompatibleProvider } from './whisperCompatible'
import { NoApiKeyError } from '../types'

function cfg(overrides: Partial<Parameters<typeof createWhisperCompatibleProvider>[0]> = {}) {
  return createWhisperCompatibleProvider({
    id: 'groq',
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'whisper-large-v3-turbo',
    models: [{ id: 'whisper-large-v3-turbo', label: 'Whisper' }],
    ...overrides
  })
}

describe('providers/stt/whisperCompatible', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    recordSttUsageMock.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('transcribe', () => {
    it('throws NoApiKeyError when a key is required and missing', async () => {
      const provider = cfg()
      await expect(provider.transcribe(Buffer.from('a'), { model: 'm' }, '')).rejects.toBeInstanceOf(NoApiKeyError)
    })

    it('proceeds keyless when requiresKey is false', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'local' }) })
      const provider = cfg({ requiresKey: false })
      const result = await provider.transcribe(Buffer.from('a'), { model: 'm' }, '')
      expect(result.text).toBe('local')
      expect(fetchMock.mock.calls[0][1].headers).toEqual({})
    })

    it('returns text and records duration when the API reports it', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'hi there', duration: 4.2 }) })
      const provider = cfg()
      const result = await provider.transcribe(Buffer.from('a'), { model: 'whisper-large-v3-turbo', language: 'en', prompt: 'hint' }, 'key')
      expect(result).toEqual({ text: 'hi there', durationSeconds: 4.2 })
      expect(recordSttUsageMock).toHaveBeenCalledWith('whisper-large-v3-turbo', 4.2)
    })

    it('omits durationSeconds when duration is absent from the response', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'hi' }) })
      const provider = cfg()
      const result = await provider.transcribe(Buffer.from('a'), { model: 'm' }, 'key')
      expect(result.durationSeconds).toBeUndefined()
      expect(recordSttUsageMock).not.toHaveBeenCalled()
    })

    it('falls back to the config default model when opts.model is empty', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'hi' }) })
      const provider = cfg()
      await provider.transcribe(Buffer.from('a'), { model: '' }, 'key')
      const form = fetchMock.mock.calls[0][1].body as FormData
      expect(form.get('model')).toBe('whisper-large-v3-turbo')
    })

    it('defaults to an empty string transcript when the response omits text', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({}) })
      const provider = cfg()
      const result = await provider.transcribe(Buffer.from('a'), { model: 'm' }, 'key')
      expect(result.text).toBe('')
    })

    it('omits language for "auto" and skips the prompt field when absent', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'x' }) })
      const provider = cfg()
      await provider.transcribe(Buffer.from('a'), { model: 'm', language: 'auto' }, 'key')
      const form = fetchMock.mock.calls[0][1].body as FormData
      expect(form.get('language')).toBeNull()
      expect(form.get('prompt')).toBeNull()
    })

    it('respects a custom verboseJson predicate (json vs verbose_json)', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'x' }) })
      const provider = cfg({ verboseJson: (model) => model.startsWith('whisper') })
      await provider.transcribe(Buffer.from('a'), { model: 'gpt-4o-mini-transcribe' }, 'key')
      const form = fetchMock.mock.calls[0][1].body as FormData
      expect(form.get('response_format')).toBe('json')
    })

    it('throws an httpError on a non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad audio' })
      const provider = cfg()
      await expect(provider.transcribe(Buffer.from('a'), { model: 'm' }, 'key')).rejects.toThrow(/400/)
    })

    it('re-throws AbortError', async () => {
      const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
      fetchMock.mockRejectedValue(abortErr)
      const provider = cfg()
      await expect(provider.transcribe(Buffer.from('a'), { model: 'm' }, 'key')).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('uses opts.baseUrl override when provided, else the config default', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'x' }) })
      const provider = cfg()
      await provider.transcribe(Buffer.from('a'), { model: 'm', baseUrl: 'http://localhost:9000/v1' }, 'key')
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9000/v1/audio/transcriptions')
    })
  })

  describe('testKey', () => {
    it('delegates to the models endpoint at the default base URL', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const provider = cfg()
      const result = await provider.testKey('key')
      expect(result.ok).toBe(true)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/models')
    })
  })

  it('defaults requiresKey to true when unset', () => {
    const provider = cfg()
    expect(provider.requiresKey).toBe(true)
  })

  it('respects an explicit requiresKey: false', () => {
    const provider = cfg({ requiresKey: false })
    expect(provider.requiresKey).toBe(false)
  })
})
