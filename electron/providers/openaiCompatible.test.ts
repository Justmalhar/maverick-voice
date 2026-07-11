import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, recordLlmUsageMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), recordLlmUsageMock: vi.fn() }))
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return { ...actual, fetch: (...a: unknown[]) => fetchMock(...a) }
})
vi.mock('../store/usage', () => ({ recordLlmUsage: recordLlmUsageMock }))

import { createOpenAICompatibleProvider } from './openaiCompatible'
import { NoApiKeyError } from './types'

function cfg(overrides: Partial<Parameters<typeof createOpenAICompatibleProvider>[0]> = {}) {
  return createOpenAICompatibleProvider({
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }],
    ...overrides
  })
}

describe('providers/openaiCompatible', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    recordLlmUsageMock.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('complete', () => {
    it('throws NoApiKeyError when key is empty', async () => {
      const provider = cfg()
      await expect(provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u' }, '')).rejects.toBeInstanceOf(
        NoApiKeyError
      )
    })

    it('posts the canonical body and returns text + usage on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: 'hello' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 }
          })
      })
      const provider = cfg()
      const result = await provider.complete({ model: 'gpt-4o-mini', system: 'sys', user: 'usr', temperature: 0.2, maxTokens: 100 }, 'key')
      expect(result.text).toBe('hello')
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
      expect(recordLlmUsageMock).toHaveBeenCalledWith('gpt-4o-mini', 10, 5)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.openai.com/v1/chat/completions')
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 100 })
    })

    it('defaults temperature/maxTokens/model when unset', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }] }) })
      const provider = cfg()
      await provider.complete({ model: '', system: 's', user: 'u' }, 'key')
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.model).toBe('gpt-4o-mini')
      expect(body.temperature).toBe(0.1)
      expect(body.max_tokens).toBe(4096)
    })

    it('defaults missing prompt_tokens/completion_tokens to 0 when usage is present but partial', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }], usage: {} })
      })
      const provider = cfg()
      const result = await provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u' }, 'key')
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
      expect(recordLlmUsageMock).toHaveBeenCalledWith('gpt-4o-mini', 0, 0)
    })

    it('does not record usage when the API omits usage', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }] }) })
      const provider = cfg()
      const result = await provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u' }, 'key')
      expect(result.usage).toBeUndefined()
      expect(recordLlmUsageMock).not.toHaveBeenCalled()
    })

    it('handles a missing choices[0].message.content as empty text', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [] }) })
      const provider = cfg()
      const result = await provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u' }, 'key')
      expect(result.text).toBe('')
    })

    it('throws an httpError on a non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })
      const provider = cfg()
      await expect(provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u' }, 'key')).rejects.toThrow(
        /429/
      )
    })

    it('re-throws AbortError instead of swallowing it', async () => {
      const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
      fetchMock.mockRejectedValue(abortErr)
      const provider = cfg()
      await expect(provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u' }, 'key')).rejects.toMatchObject({
        name: 'AbortError'
      })
    })

    it('rejects with a clear error when the Custom provider has no base URL configured', async () => {
      const provider = cfg({ id: 'custom', label: 'Custom', defaultBaseUrl: '', defaultModel: '', models: [] })
      await expect(provider.complete({ model: 'm', system: 's', user: 'u' }, 'key')).rejects.toThrow(
        'enter a base URL first'
      )
    })

    it('uses a caller-supplied baseUrl override, normalized', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }] }) })
      const provider = cfg()
      await provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u', baseUrl: 'https://custom.example.com/v1/' }, 'key')
      expect(fetchMock.mock.calls[0][0]).toBe('https://custom.example.com/v1/chat/completions')
    })

    it('merges extraHeaders (e.g. OpenRouter attribution) into the request', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }] }) })
      const provider = cfg({ extraHeaders: { 'X-Title': 'Maverick Voice' } })
      await provider.complete({ model: 'gpt-4o-mini', system: 's', user: 'u' }, 'key')
      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-Title': 'Maverick Voice' })
    })
  })

  describe('testKey', () => {
    it('delegates to testKeyViaModels against {base}/models', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const provider = cfg()
      const result = await provider.testKey('key')
      expect(result.ok).toBe(true)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
    })
  })

  describe('listModels', () => {
    it('returns filtered, sorted chat-capable ids on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'gpt-4o' }, { id: 'whisper-1' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-mini' }]
        })
      })
      const provider = cfg()
      const models = await provider.listModels('key')
      expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini'])
    })

    it('falls back to the static list on a non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false })
      const provider = cfg()
      const models = await provider.listModels('key')
      expect(models).toEqual([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }])
    })

    it('falls back to the static list on a network error (never rejects)', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))
      const provider = cfg()
      await expect(provider.listModels('key')).resolves.toEqual([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }])
    })

    it('falls back to the static list when the filtered id list is empty', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'whisper-1' }] }) })
      const provider = cfg()
      const models = await provider.listModels('key')
      expect(models).toEqual([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }])
    })

    it('omits the Authorization header when no key is supplied', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
      const provider = cfg()
      await provider.listModels('')
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
    })

    it('tolerates a response body missing the data array', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
      const provider = cfg()
      const models = await provider.listModels('key')
      expect(models).toEqual([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }])
    })
  })

  it('exposes the static config fields on the returned provider', () => {
    const provider = cfg()
    expect(provider.id).toBe('openai')
    expect(provider.label).toBe('OpenAI')
    expect(provider.defaultBaseUrl).toBe('https://api.openai.com/v1')
    expect(provider.defaultModel).toBe('gpt-4o-mini')
    expect(provider.models).toEqual([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }])
  })
})
