import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// electron-store mock: an in-memory "disk" shared across constructions so we
// can seed pre-existing data (simulating a store that already had legacy
// data on disk before the module loads), and reset it between tests.
vi.mock('electron-store', () => {
  let disk: Record<string, unknown> = {}
  class MockStore<T extends Record<string, unknown>> {
    private data: Record<string, unknown>
    constructor(opts: { defaults: T }) {
      this.data = { ...opts.defaults, ...disk }
    }
    get(key: string): unknown {
      return this.data[key]
    }
    set(key: string, value: unknown): void {
      this.data[key] = value
    }
  }
  return {
    default: MockStore,
    __setDisk: (d: Record<string, unknown>) => {
      disk = d
    }
  }
})

async function freshSettings(platform: string, disk: Record<string, unknown> = {}) {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform })
  const storeMock = (await import('electron-store')) as unknown as {
    __setDisk: (d: Record<string, unknown>) => void
  }
  storeMock.__setDisk(disk)
  return import('./settings')
}

const REAL_PLATFORM = process.platform

describe('store/settings', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM })
    vi.restoreAllMocks()
  })

  it('defaults to fn binding on darwin', async () => {
    const mod = await freshSettings('darwin')
    expect(mod.getSetting('dictationBinding')).toEqual({ type: 'key', key: 'fn' })
  })

  it('defaults to right-ctrl binding off darwin', async () => {
    const mod = await freshSettings('win32')
    expect(mod.getSetting('dictationBinding')).toEqual({ type: 'key', key: 'right-ctrl' })
  })

  it('getSetting/setSetting pass through to the store', async () => {
    const mod = await freshSettings('darwin')
    expect(mod.getSetting('theme')).toBe('system')
    mod.setSetting('theme', 'dark')
    expect(mod.getSetting('theme')).toBe('dark')
  })

  it('getRendererSettings returns the full batched snapshot', async () => {
    const mod = await freshSettings('darwin')
    const snap = mod.getRendererSettings()
    expect(snap).toMatchObject({
      theme: 'system',
      widgetPosition: 'center',
      soundFeedback: true,
      chunkedTranscription: true,
      outputMode: 'paste',
      inputDeviceId: '',
      instructionKey: 'caps-lock',
      activationMode: 'tap-toggle',
      instructionEnabled: false,
      autoFormat: false,
      appAwareFormatting: true,
      pauseMediaDuringDictation: false,
      dictionary: [],
      replacements: [],
      snippets: []
    })
    expect(snap.rules).toEqual({
      fixGrammar: false,
      removeFillers: false,
      smartPunctuation: false,
      professionalTone: false,
      custom: []
    })
    expect(snap.sttSettings).toEqual({ provider: 'groq', model: 'whisper-large-v3-turbo', language: 'en', baseUrl: '' })
    expect(snap.llmSettings).toEqual({ provider: 'openai', model: 'gpt-4o-mini', baseUrl: '' })
  })

  it('migrates legacy {from,to} dictionary entries into replacements, dropping malformed ones', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const legacy = [
      { id: '1', from: 'teh', to: 'the' },
      { id: '2', from: 'recieve', to: 'receive' },
      { id: '3', from: 'onlyfrom' } // malformed: no `to` — must be filtered out
    ]
    const mod = await freshSettings('darwin', { dictionary: legacy, replacements: [{ id: 'existing', from: 'x', to: 'y' }] })
    expect(mod.getSetting('dictionary')).toEqual([])
    expect(mod.getSetting('replacements')).toEqual([
      { id: '1', from: 'teh', to: 'the' },
      { id: '2', from: 'recieve', to: 'receive' },
      { id: 'existing', from: 'x', to: 'y' }
    ])
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('migrated 2 dictionary entries'))
  })

  it('does not migrate when dictionary already holds new-format vocabulary words', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const words = [{ id: '1', word: 'Kubernetes' }]
    const mod = await freshSettings('darwin', { dictionary: words })
    expect(mod.getSetting('dictionary')).toEqual(words)
    expect(logSpy).not.toHaveBeenCalled()
  })
})
