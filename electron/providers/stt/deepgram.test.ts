import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, recordSttUsageMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), recordSttUsageMock: vi.fn() }))
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return { ...actual, fetch: (...a: unknown[]) => fetchMock(...a) }
})
vi.mock('../../store/usage', () => ({ recordSttUsage: recordSttUsageMock }))

import { deepgramProvider } from './deepgram'
import { NoApiKeyError } from '../types'

describe('providers/stt/deepgram', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    recordSttUsageMock.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('transcribe', () => {
    it('throws NoApiKeyError when key is empty', async () => {
      await expect(deepgramProvider.transcribe(Buffer.from('a'), { model: 'nova-3' }, '')).rejects.toBeInstanceOf(
        NoApiKeyError
      )
    })

    it('extracts the transcript, records billed duration, and includes the language param when set', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            metadata: { duration: 2.5 },
            results: { channels: [{ alternatives: [{ transcript: 'hello world' }] }] }
          })
      })
      const result = await deepgramProvider.transcribe(Buffer.from('a'), { model: 'nova-3', language: 'en' }, 'key')
      expect(result).toEqual({ text: 'hello world', durationSeconds: 2.5 })
      expect(recordSttUsageMock).toHaveBeenCalledWith('nova-3', 2.5)
      const [url] = fetchMock.mock.calls[0]
      expect(url).toContain('language=en')
    })

    it('omits the language param for "auto"', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ results: {} }) })
      await deepgramProvider.transcribe(Buffer.from('a'), { model: 'nova-3', language: 'auto' }, 'key')
      const [url] = fetchMock.mock.calls[0]
      expect(url).not.toContain('language=')
    })

    it('defaults to an empty transcript and no duration when fields are missing', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({}) })
      const result = await deepgramProvider.transcribe(Buffer.from('a'), { model: 'nova-3' }, 'key')
      expect(result).toEqual({ text: '', durationSeconds: undefined })
      expect(recordSttUsageMock).not.toHaveBeenCalled()
    })

    it('uses the default model when none supplied, and Content-Type from mimeType', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ results: {} }) })
      await deepgramProvider.transcribe(Buffer.from('a'), { model: '', mimeType: 'audio/wav' }, 'key')
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toContain(`model=${deepgramProvider.defaultModel}`)
      expect(init.headers['Content-Type']).toBe('audio/wav')
    })

    it('throws an httpError on a non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' })
      await expect(deepgramProvider.transcribe(Buffer.from('a'), { model: 'nova-3' }, 'key')).rejects.toThrow(/401/)
    })

    it('re-throws AbortError', async () => {
      const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
      fetchMock.mockRejectedValue(abortErr)
      await expect(deepgramProvider.transcribe(Buffer.from('a'), { model: 'nova-3' }, 'key')).rejects.toMatchObject({
        name: 'AbortError'
      })
    })
  })

  describe('testKey', () => {
    it('rejects an empty key without a network call', async () => {
      const result = await deepgramProvider.testKey('  ')
      expect(result).toEqual({ ok: false, error: 'API key is empty' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('also rejects a plain empty-string key', async () => {
      const result = await deepgramProvider.testKey('')
      expect(result).toEqual({ ok: false, error: 'API key is empty' })
    })

    it('returns ok on a successful auth check', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const result = await deepgramProvider.testKey('key')
      expect(result).toEqual({ ok: true })
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepgram.com/v1/auth/token')
    })

    it('returns the failure body on a non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' })
      const result = await deepgramProvider.testKey('key')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('403')
    })

    it('handles a body-read failure on a non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => { throw new Error('boom') } })
      const result = await deepgramProvider.testKey('key')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('500')
    })

    it('returns the error message on a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('offline'))
      const result = await deepgramProvider.testKey('key')
      expect(result).toEqual({ ok: false, error: 'offline' })
    })

    it('falls back to a generic message for a non-Error rejection', async () => {
      fetchMock.mockRejectedValue('weird')
      const result = await deepgramProvider.testKey('key')
      expect(result).toEqual({ ok: false, error: 'Network error' })
    })
  })

  it('exposes id/label/models/requiresKey/defaultModel', () => {
    expect(deepgramProvider.id).toBe('deepgram')
    expect(deepgramProvider.label).toBe('Deepgram')
    expect(deepgramProvider.requiresKey).toBe(true)
    expect(deepgramProvider.defaultModel).toBe('nova-3')
    expect(deepgramProvider.models.length).toBeGreaterThan(0)
  })
})
