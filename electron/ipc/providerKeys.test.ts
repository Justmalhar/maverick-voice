import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  onHandlers,
  getLLMProvider,
  getTranscriptionProvider,
  clearApiKey,
  getApiKey,
  getMaskedKey,
  hasApiKey,
  setApiKey,
  getSetting
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  onHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  getLLMProvider: vi.fn(),
  getTranscriptionProvider: vi.fn(),
  clearApiKey: vi.fn(),
  getApiKey: vi.fn(),
  getMaskedKey: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
  getSetting: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)),
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => onHandlers.set(channel, fn))
  }
}))
vi.mock('../providers/registry', () => ({ getLLMProvider, getTranscriptionProvider }))
vi.mock('../store/keys', () => ({ clearApiKey, getApiKey, getMaskedKey, hasApiKey, setApiKey }))
vi.mock('../store/settings', () => ({ getSetting }))

import { IPC } from '../../shared/ipc'
import { registerProviderKeysIpc } from './providerKeys'

function makeLlm(testKeyImpl: (...a: unknown[]) => unknown, listModelsImpl?: (...a: unknown[]) => unknown) {
  return { testKey: vi.fn(testKeyImpl), listModels: vi.fn(listModelsImpl ?? (async () => [])), models: [] }
}
function makeStt(testKeyImpl: (...a: unknown[]) => unknown) {
  return { testKey: vi.fn(testKeyImpl), models: [{ id: 'nova-3', label: 'Nova 3' }] }
}

describe('ipc/providerKeys', () => {
  beforeEach(() => {
    handlers.clear()
    onHandlers.clear()
    getLLMProvider.mockReset()
    getTranscriptionProvider.mockReset()
    clearApiKey.mockReset()
    getApiKey.mockReset()
    getMaskedKey.mockReset()
    hasApiKey.mockReset()
    setApiKey.mockReset()
    getSetting.mockReset().mockReturnValue({ baseUrl: '' })
    registerProviderKeysIpc()
  })
  afterEach(() => vi.restoreAllMocks())

  it('KEY_STATUS reports hasKey + maskedKey for a provider', () => {
    hasApiKey.mockReturnValue(true)
    getMaskedKey.mockReturnValue('gsk_••••abcd')
    const result = handlers.get(IPC.KEY_STATUS)!(null, 'groq')
    expect(result).toEqual({ provider: 'groq', hasKey: true, maskedKey: 'gsk_••••abcd' })
  })

  describe('KEY_SET', () => {
    it('stores an unvalidated custom key when no base URL is configured yet', async () => {
      getSetting.mockReturnValue({ baseUrl: '' })
      const result = await handlers.get(IPC.KEY_SET)!(null, 'custom', 'my-key')
      expect(setApiKey).toHaveBeenCalledWith('custom', 'my-key')
      expect(getLLMProvider).not.toHaveBeenCalled()
      expect(result).toEqual({ ok: true })
    })

    it('validates a custom key against the configured base URL before storing', async () => {
      getSetting.mockReturnValue({ baseUrl: 'https://my-endpoint.example.com' })
      const llm = makeLlm(async () => ({ ok: true }))
      getLLMProvider.mockReturnValue(llm)
      const result = await handlers.get(IPC.KEY_SET)!(null, 'custom', 'my-key')
      expect(llm.testKey).toHaveBeenCalledWith('my-key', 'https://my-endpoint.example.com')
      expect(setApiKey).toHaveBeenCalledWith('custom', 'my-key')
      expect(result).toEqual({ ok: true })
    })

    it('routes deepgram/local through the STT provider for validation', async () => {
      const stt = makeStt(async () => ({ ok: true }))
      getTranscriptionProvider.mockReturnValue(stt)
      const result = await handlers.get(IPC.KEY_SET)!(null, 'deepgram', 'dg-key')
      expect(stt.testKey).toHaveBeenCalledWith('dg-key')
      expect(setApiKey).toHaveBeenCalledWith('deepgram', 'dg-key')
      expect(result).toEqual({ ok: true })
    })

    it('routes non-custom, non-STT-only providers through the LLM provider with no base URL', async () => {
      const llm = makeLlm(async () => ({ ok: true }))
      getLLMProvider.mockReturnValue(llm)
      await handlers.get(IPC.KEY_SET)!(null, 'openai', 'oai-key')
      expect(llm.testKey).toHaveBeenCalledWith('oai-key', undefined)
    })

    it('does not store the key when validation fails', async () => {
      const llm = makeLlm(async () => ({ ok: false, error: 'bad key' }))
      getLLMProvider.mockReturnValue(llm)
      const result = await handlers.get(IPC.KEY_SET)!(null, 'openai', 'bad')
      expect(setApiKey).not.toHaveBeenCalled()
      expect(result).toEqual({ ok: false, error: 'bad key' })
    })

    it('catches a thrown Error and returns its message', async () => {
      getLLMProvider.mockImplementation(() => {
        throw new Error('unknown provider')
      })
      const result = await handlers.get(IPC.KEY_SET)!(null, 'openai', 'k')
      expect(result).toEqual({ ok: false, error: 'unknown provider' })
    })

    it('catches a non-Error throw with a generic fallback message', async () => {
      getLLMProvider.mockImplementation(() => {
        throw 'weird'
      })
      const result = await handlers.get(IPC.KEY_SET)!(null, 'openai', 'k')
      expect(result).toEqual({ ok: false, error: 'Failed to save key' })
    })
  })

  describe('KEY_TEST', () => {
    it('tests the renderer-supplied key when non-empty', async () => {
      const llm = makeLlm(async () => ({ ok: true }))
      getLLMProvider.mockReturnValue(llm)
      const result = await handlers.get(IPC.KEY_TEST)!(null, 'openai', ' fresh-key ')
      expect(llm.testKey).toHaveBeenCalledWith('fresh-key', undefined) // effectiveKey is trimmed
      expect(result).toEqual({ ok: true })
    })

    it('falls back to the stored key when the input is blank', async () => {
      getApiKey.mockReturnValue('stored-key')
      const llm = makeLlm(async () => ({ ok: true }))
      getLLMProvider.mockReturnValue(llm)
      await handlers.get(IPC.KEY_TEST)!(null, 'openai', '   ')
      expect(llm.testKey).toHaveBeenCalledWith('stored-key', undefined)
    })

    it('returns an error when neither an input key nor a stored key exists', async () => {
      getApiKey.mockReturnValue(null)
      const result = await handlers.get(IPC.KEY_TEST)!(null, 'openai', '')
      expect(result).toEqual({ ok: false, error: 'No key entered or saved yet' })
    })

    it('tests custom providers against the configured base URL', async () => {
      getSetting.mockReturnValue({ baseUrl: 'https://custom.example.com' })
      const llm = makeLlm(async () => ({ ok: true }))
      getLLMProvider.mockReturnValue(llm)
      await handlers.get(IPC.KEY_TEST)!(null, 'custom', 'k')
      expect(llm.testKey).toHaveBeenCalledWith('k', 'https://custom.example.com')
    })

    it('catches a thrown Error and returns its message', async () => {
      getLLMProvider.mockImplementation(() => {
        throw new Error('boom')
      })
      const result = await handlers.get(IPC.KEY_TEST)!(null, 'openai', 'k')
      expect(result).toEqual({ ok: false, error: 'boom' })
    })

    it('catches a non-Error throw with a generic fallback message', async () => {
      getLLMProvider.mockImplementation(() => {
        throw 'weird'
      })
      const result = await handlers.get(IPC.KEY_TEST)!(null, 'openai', 'k')
      expect(result).toEqual({ ok: false, error: 'Key test failed' })
    })
  })

  it('KEY_CLEAR delegates to clearApiKey(provider)', () => {
    onHandlers.get(IPC.KEY_CLEAR)!(null, 'groq')
    expect(clearApiKey).toHaveBeenCalledWith('groq')
  })

  describe('LIST_MODELS', () => {
    it('kind stt returns the STT provider static models', async () => {
      const stt = makeStt(async () => ({ ok: true }))
      getTranscriptionProvider.mockReturnValue(stt)
      const result = await handlers.get(IPC.LIST_MODELS)!(null, 'deepgram', 'stt')
      expect(result).toEqual([{ id: 'nova-3', label: 'Nova 3' }])
    })

    it('kind llm fetches the live catalog with the caller-injected key', async () => {
      getApiKey.mockReturnValue('a-key')
      const llm = makeLlm(
        async () => ({ ok: true }),
        async () => [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }]
      )
      getLLMProvider.mockReturnValue(llm)
      const result = await handlers.get(IPC.LIST_MODELS)!(null, 'openai', 'llm')
      expect(llm.listModels).toHaveBeenCalledWith('a-key', undefined)
      expect(result).toEqual([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }])
    })

    it('kind llm passes an empty string when getApiKey returns null (nullish-coalescing fallback)', async () => {
      getApiKey.mockReturnValue(null)
      const llm = makeLlm(
        async () => ({ ok: true }),
        async () => []
      )
      getLLMProvider.mockReturnValue(llm)
      await handlers.get(IPC.LIST_MODELS)!(null, 'openai', 'llm')
      expect(llm.listModels).toHaveBeenCalledWith('', undefined)
    })

    it('kind llm passes the custom base URL for the custom provider', async () => {
      getApiKey.mockReturnValue('')
      getSetting.mockReturnValue({ baseUrl: 'https://custom.example.com' })
      const llm = makeLlm(
        async () => ({ ok: true }),
        async () => []
      )
      getLLMProvider.mockReturnValue(llm)
      await handlers.get(IPC.LIST_MODELS)!(null, 'custom', 'llm')
      expect(llm.listModels).toHaveBeenCalledWith('', 'https://custom.example.com')
    })

    it('returns an empty array when the provider lookup throws', async () => {
      getLLMProvider.mockImplementation(() => {
        throw new Error('unknown')
      })
      const result = await handlers.get(IPC.LIST_MODELS)!(null, 'openai', 'llm')
      expect(result).toEqual([])
    })
  })
})
