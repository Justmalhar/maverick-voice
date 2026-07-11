import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return { ...actual, fetch: (...a: unknown[]) => fetchMock(...a) }
})

import { httpError, normalizeBaseUrl, testKeyViaModels, withTimeout } from './http'

describe('providers/http', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
  })

  describe('normalizeBaseUrl', () => {
    it('strips trailing slashes', () => {
      expect(normalizeBaseUrl('https://api.example.com/v1///')).toBe('https://api.example.com/v1')
    })
    it('prefixes https:// when no protocol is present', () => {
      expect(normalizeBaseUrl('api.example.com/v1')).toBe('https://api.example.com/v1')
    })
    it('leaves an existing http:// protocol alone', () => {
      expect(normalizeBaseUrl('http://localhost:8000/v1')).toBe('http://localhost:8000/v1')
    })
  })

  describe('httpError', () => {
    it('builds a message with status and truncated body', () => {
      const err = httpError('Test call', 500, 'x'.repeat(300))
      expect(err.message).toContain('Test call failed (500)')
      expect(err.message.length).toBeLessThan(350)
    })
  })

  describe('withTimeout', () => {
    it('aborts after the timeout elapses', async () => {
      vi.useFakeTimers()
      const { signal, dispose } = withTimeout(undefined, 100)
      expect(signal.aborted).toBe(false)
      vi.advanceTimersByTime(100)
      expect(signal.aborted).toBe(true)
      dispose()
      vi.useRealTimers()
    })

    it('propagates an already-aborted caller signal immediately', () => {
      const controller = new AbortController()
      controller.abort()
      const { signal, dispose } = withTimeout(controller.signal, 5_000)
      expect(signal.aborted).toBe(true)
      dispose()
    })

    it('propagates a caller abort that fires later', () => {
      const controller = new AbortController()
      const { signal, dispose } = withTimeout(controller.signal, 5_000)
      expect(signal.aborted).toBe(false)
      controller.abort()
      expect(signal.aborted).toBe(true)
      dispose()
    })

    it('dispose removes the caller abort listener (no leak)', () => {
      const controller = new AbortController()
      const { dispose } = withTimeout(controller.signal, 5_000)
      dispose()
      // no assertion beyond "does not throw" — removeEventListener path covered
      controller.abort()
    })
  })

  describe('testKeyViaModels', () => {
    it('rejects an empty/whitespace key without a network call', async () => {
      const result = await testKeyViaModels('https://x/models', '   ')
      expect(result).toEqual({ ok: false, error: 'API key is empty' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('also rejects a plain empty-string key (the `key || \'\'` fallback path)', async () => {
      const result = await testKeyViaModels('https://x/models', '')
      expect(result).toEqual({ ok: false, error: 'API key is empty' })
    })

    it('returns ok on a 2xx response', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const result = await testKeyViaModels('https://x/models', 'key123', { 'X-Extra': '1' })
      expect(result).toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://x/models',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer key123', 'X-Extra': '1' }) })
      )
    })

    it('returns the error body on a non-2xx response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
      const result = await testKeyViaModels('https://x/models', 'bad-key')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('401')
      expect(result.error).toContain('unauthorized')
    })

    it('handles a response whose .text() itself rejects', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => { throw new Error('body read fail') } })
      const result = await testKeyViaModels('https://x/models', 'key')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('500')
    })

    it('returns a network-error message when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'))
      const result = await testKeyViaModels('https://x/models', 'key')
      expect(result).toEqual({ ok: false, error: 'ECONNRESET' })
    })

    it('falls back to a generic message for a non-Error rejection', async () => {
      fetchMock.mockRejectedValue('weird failure')
      const result = await testKeyViaModels('https://x/models', 'key')
      expect(result).toEqual({ ok: false, error: 'Network error' })
    })
  })
})
