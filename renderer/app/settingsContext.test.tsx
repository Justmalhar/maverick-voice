// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectronAPI, RendererSettings } from '../../shared/types'
import { SettingsProvider, useSettings, type SettingsContextValue } from './settingsContext'

const defaultSettings: RendererSettings = {
  theme: 'system',
  widgetPosition: 'center',
  soundFeedback: true,
  chunkedTranscription: false,
  outputMode: 'paste',
  inputDeviceId: '',
  dictationBinding: { type: 'key', key: 'fn' },
  instructionKey: 'caps-lock',
  activationMode: 'tap-toggle',
  instructionEnabled: true,
  autoFormat: false,
  appAwareFormatting: true,
  pauseMediaDuringDictation: true,
  dictionary: [],
  replacements: [],
  snippets: [],
  rules: {
    fixGrammar: true,
    removeFillers: true,
    smartPunctuation: true,
    professionalTone: false,
    custom: []
  },
  sttSettings: { provider: 'groq', model: 'whisper-large-v3', language: 'auto', baseUrl: '' },
  llmSettings: { provider: 'groq', model: 'llama-3.1-70b', baseUrl: '' }
}

function createElectronAPIMock(overrides: Partial<ElectronAPI> = {}) {
  const settingsChangedCbs: Array<(p: Partial<RendererSettings>) => void> = []
  const api = {
    onRecordingStart: vi.fn(() => vi.fn()),
    onRecordingStop: vi.fn(() => vi.fn()),
    recordingAck: vi.fn(),
    sendAudioChunk: vi.fn(),
    sendAudioFinal: vi.fn(),
    sendAudioDiscarded: vi.fn(),
    onOutputReady: vi.fn(() => vi.fn()),
    onOutputFallback: vi.fn(() => vi.fn()),
    onOutputError: vi.fn(() => vi.fn()),
    onSessionCancelled: vi.fn(() => vi.fn()),
    onSessionTooShort: vi.fn(() => vi.fn()),
    onProcessingDiscardHint: vi.fn(() => vi.fn()),
    widgetStop: vi.fn(),
    widgetCancel: vi.fn(),
    widgetUndoCancel: vi.fn(),
    widgetReady: vi.fn(),
    onHudHide: vi.fn(() => vi.fn()),
    hudExitDone: vi.fn(),
    getSessions: vi.fn().mockResolvedValue([]),
    retrySession: vi.fn().mockResolvedValue(undefined),
    onRetryStatus: vi.fn(() => vi.fn()),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    clearAllSessions: vi.fn().mockResolvedValue(undefined),
    getUsage: vi.fn().mockResolvedValue({
      today: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} },
      month: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} },
      allTime: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} }
    }),
    resetUsage: vi.fn(),
    getProviderKeyStatus: vi.fn().mockResolvedValue({ provider: 'groq', hasKey: false, maskedKey: null }),
    setProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    testProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    clearProviderKey: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(defaultSettings),
    onSettingsChanged: vi.fn((cb: (p: Partial<RendererSettings>) => void) => {
      settingsChangedCbs.push(cb)
      return vi.fn()
    }),
    setWidgetPosition: vi.fn(),
    setSoundFeedback: vi.fn(),
    setChunkedTranscription: vi.fn(),
    setOutputMode: vi.fn(),
    setInputDevice: vi.fn(),
    setActivationMode: vi.fn(),
    setAutoFormat: vi.fn(),
    setInstructionEnabled: vi.fn(),
    setAppAwareFormatting: vi.fn(),
    setPauseMediaDuringDictation: vi.fn(),
    setDictationBinding: vi.fn(),
    setDictionary: vi.fn().mockResolvedValue(undefined),
    setReplacements: vi.fn().mockResolvedValue(undefined),
    setSnippets: vi.fn().mockResolvedValue(undefined),
    setRules: vi.fn().mockResolvedValue(undefined),
    writeLog: vi.fn(),
    setSTTSettings: vi.fn(),
    setLLMSettings: vi.fn(),
    getTheme: vi.fn().mockResolvedValue('system'),
    setTheme: vi.fn(),
    permissionsPreflight: vi.fn().mockResolvedValue({
      mic: 'granted',
      accessibility: true,
      inputMonitoring: true,
      automation: 'granted',
      listenerAlive: true
    }),
    openPermissionPane: vi.fn(),
    requestMicPermission: vi.fn().mockResolvedValue(true),
    getKeyCapability: vi.fn().mockResolvedValue({
      fnAvailable: true,
      globeConflict: false,
      defaultBinding: { type: 'key', key: 'fn' }
    }),
    getAppConfig: vi.fn().mockResolvedValue({
      version: '1.0.0',
      chunking: {
        enabled: true,
        min_duration_ms: 0,
        silence_threshold_rms: 0,
        silence_duration_ms: 0,
        hard_cap_ms: 0,
        vad_poll_interval_ms: 0
      },
      junk_detection: { max_length: 0, pattern: '' }
    }),
    openExternal: vi.fn(),
    onDevErrorLog: vi.fn(() => vi.fn()),
    ...overrides
  }
  return { api: api as unknown as ElectronAPI, settingsChangedCbs }
}

afterEach(() => cleanup())

describe('useSettings', () => {
  it('throws when used outside SettingsProvider', () => {
    expect(() => renderHook(() => useSettings())).toThrow(
      'useSettings() must be used within <SettingsProvider>'
    )
  })
})

describe('SettingsProvider', () => {
  let ctxValue: SettingsContextValue

  function Capture() {
    ctxValue = useSettings()
    return null
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads settings once via getSettings and exposes them', async () => {
    const { api } = createElectronAPIMock()
    ;(window as any).electronAPI = api
    render(
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    )
    await waitFor(() => expect(ctxValue.settings).not.toBeNull())
    expect(api.getSettings).toHaveBeenCalledTimes(1)
    expect(ctxValue.settings).toEqual(defaultSettings)
  })

  it('logs an error when getSettings rejects', async () => {
    const { api } = createElectronAPIMock({ getSettings: vi.fn().mockRejectedValue(new Error('boom')) })
    ;(window as any).electronAPI = api
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    )
    await waitFor(() => expect(errSpy).toHaveBeenCalledWith('[settings] failed to load settings'))
    expect(ctxValue.settings).toBeNull()
  })

  it('merges a pushed onSettingsChanged partial into current settings', async () => {
    const { api, settingsChangedCbs } = createElectronAPIMock()
    ;(window as any).electronAPI = api
    render(
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    )
    await waitFor(() => expect(ctxValue.settings).not.toBeNull())
    act(() => {
      settingsChangedCbs[0]({ soundFeedback: false })
    })
    expect(ctxValue.settings?.soundFeedback).toBe(false)
    expect(ctxValue.settings?.theme).toBe('system')
  })

  it('ignores a pushed onSettingsChanged partial while settings are still null', async () => {
    let resolveSettings: (v: RendererSettings) => void = () => {}
    const pending = new Promise<RendererSettings>((res) => {
      resolveSettings = res
    })
    const { api, settingsChangedCbs } = createElectronAPIMock({ getSettings: vi.fn().mockReturnValue(pending) })
    ;(window as any).electronAPI = api
    render(
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    )
    expect(ctxValue.settings).toBeNull()
    act(() => {
      settingsChangedCbs[0]({ soundFeedback: false })
    })
    expect(ctxValue.settings).toBeNull()
    // Resolve so the pending promise doesn't leak into other tests.
    await act(async () => {
      resolveSettings(defaultSettings)
      await pending
    })
  })

  it('unsubscribes onSettingsChanged on unmount', async () => {
    const unsubscribe = vi.fn()
    const { api } = createElectronAPIMock({ onSettingsChanged: vi.fn(() => unsubscribe) })
    ;(window as any).electronAPI = api
    const { unmount } = render(
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    )
    await waitFor(() => expect(ctxValue.settings).not.toBeNull())
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not update state from a getSettings resolution that arrives after unmount', async () => {
    let resolveSettings: (v: RendererSettings) => void = () => {}
    const pending = new Promise<RendererSettings>((res) => {
      resolveSettings = res
    })
    const { api } = createElectronAPIMock({ getSettings: vi.fn().mockReturnValue(pending) })
    ;(window as any).electronAPI = api
    const { unmount } = render(
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    )
    unmount()
    await act(async () => {
      resolveSettings(defaultSettings)
      await pending
    })
    // No assertion failure / no act() warning is the pass condition here.
  })

  describe('update()', () => {
    async function setup() {
      const { api } = createElectronAPIMock()
      ;(window as any).electronAPI = api
      render(
        <SettingsProvider>
          <Capture />
        </SettingsProvider>
      )
      await waitFor(() => expect(ctxValue.settings).not.toBeNull())
      return api
    }

    it('merges state and calls setTheme for theme', async () => {
      const api = await setup()
      act(() => ctxValue.update({ theme: 'dark' }))
      expect(ctxValue.settings?.theme).toBe('dark')
      expect(api.setTheme).toHaveBeenCalledWith('dark')
    })

    it('merges state and calls setWidgetPosition for widgetPosition', async () => {
      const api = await setup()
      act(() => ctxValue.update({ widgetPosition: 'right' }))
      expect(ctxValue.settings?.widgetPosition).toBe('right')
      expect(api.setWidgetPosition).toHaveBeenCalledWith('right')
    })

    it('merges state and calls setSoundFeedback for soundFeedback', async () => {
      const api = await setup()
      act(() => ctxValue.update({ soundFeedback: false }))
      expect(api.setSoundFeedback).toHaveBeenCalledWith(false)
    })

    it('merges state and calls setChunkedTranscription for chunkedTranscription', async () => {
      const api = await setup()
      act(() => ctxValue.update({ chunkedTranscription: true }))
      expect(api.setChunkedTranscription).toHaveBeenCalledWith(true)
    })

    it('merges state and calls setOutputMode for outputMode', async () => {
      const api = await setup()
      act(() => ctxValue.update({ outputMode: 'clipboard' }))
      expect(api.setOutputMode).toHaveBeenCalledWith('clipboard')
    })

    it('merges state and calls setInputDevice for inputDeviceId', async () => {
      const api = await setup()
      act(() => ctxValue.update({ inputDeviceId: 'dev-1' }))
      expect(api.setInputDevice).toHaveBeenCalledWith('dev-1')
    })

    it('merges state and calls setDictationBinding for dictationBinding', async () => {
      const api = await setup()
      const binding = { type: 'key' as const, key: 'right-ctrl' as const }
      act(() => ctxValue.update({ dictationBinding: binding }))
      expect(api.setDictationBinding).toHaveBeenCalledWith(binding)
    })

    it('merges state and calls setActivationMode for activationMode', async () => {
      const api = await setup()
      act(() => ctxValue.update({ activationMode: 'push-to-talk' }))
      expect(api.setActivationMode).toHaveBeenCalledWith('push-to-talk')
    })

    it('merges state and calls setInstructionEnabled for instructionEnabled', async () => {
      const api = await setup()
      act(() => ctxValue.update({ instructionEnabled: false }))
      expect(api.setInstructionEnabled).toHaveBeenCalledWith(false)
    })

    it('merges state and calls setAutoFormat for autoFormat', async () => {
      const api = await setup()
      act(() => ctxValue.update({ autoFormat: true }))
      expect(api.setAutoFormat).toHaveBeenCalledWith(true)
    })

    it('merges state and calls setAppAwareFormatting for appAwareFormatting', async () => {
      const api = await setup()
      act(() => ctxValue.update({ appAwareFormatting: false }))
      expect(api.setAppAwareFormatting).toHaveBeenCalledWith(false)
    })

    it('merges state and calls setPauseMediaDuringDictation for pauseMediaDuringDictation', async () => {
      const api = await setup()
      act(() => ctxValue.update({ pauseMediaDuringDictation: false }))
      expect(api.setPauseMediaDuringDictation).toHaveBeenCalledWith(false)
    })

    it('merges state and calls setDictionary (swallowing rejection) for dictionary', async () => {
      const api = await setup()
      ;(api.setDictionary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))
      const words = [{ id: '1', word: 'foo' }]
      act(() => ctxValue.update({ dictionary: words }))
      expect(api.setDictionary).toHaveBeenCalledWith(words)
      expect(ctxValue.settings?.dictionary).toEqual(words)
    })

    it('merges state and calls setReplacements for replacements', async () => {
      const api = await setup()
      const entries = [{ id: '1', from: 'a', to: 'b' }]
      act(() => ctxValue.update({ replacements: entries }))
      expect(api.setReplacements).toHaveBeenCalledWith(entries)
    })

    it('merges state and calls setSnippets for snippets', async () => {
      const api = await setup()
      const snippets = [{ id: '1', trigger: '/hi', content: 'hello' }]
      act(() => ctxValue.update({ snippets }))
      expect(api.setSnippets).toHaveBeenCalledWith(snippets)
    })

    it('merges state and calls setRules for rules', async () => {
      const api = await setup()
      const rules = {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: true,
        custom: []
      }
      act(() => ctxValue.update({ rules }))
      expect(api.setRules).toHaveBeenCalledWith(rules)
    })

    it('merges state and calls setSTTSettings for sttSettings', async () => {
      const api = await setup()
      const stt = { provider: 'openai' as const, model: 'whisper-1', language: 'en', baseUrl: '' }
      act(() => ctxValue.update({ sttSettings: stt }))
      expect(api.setSTTSettings).toHaveBeenCalledWith(stt)
    })

    it('merges state and calls setLLMSettings for llmSettings', async () => {
      const api = await setup()
      const llm = { provider: 'openai' as const, model: 'gpt-4o', baseUrl: '' }
      act(() => ctxValue.update({ llmSettings: llm }))
      expect(api.setLLMSettings).toHaveBeenCalledWith(llm)
    })

    it('merges an unmapped key (instructionKey) without calling any IPC setter', async () => {
      const api = await setup()
      expect(api.getSettings).toHaveBeenCalledTimes(1) // sanity: setup did exercise the api
      act(() => ctxValue.update({ instructionKey: 'caps-lock' }))
      expect(ctxValue.settings?.instructionKey).toBe('caps-lock')
      // instructionKey has no entry in SETTERS -> merge only, no IPC setter fires.
      expect(api.setTheme).not.toHaveBeenCalled()
      expect(api.setWidgetPosition).not.toHaveBeenCalled()
      expect(api.setSoundFeedback).not.toHaveBeenCalled()
    })

    it('is a no-op setter call when settings have not loaded yet (still calls IPC, state stays null)', async () => {
      let resolveSettings: (v: RendererSettings) => void = () => {}
      const pending = new Promise<RendererSettings>((res) => {
        resolveSettings = res
      })
      const { api } = createElectronAPIMock({ getSettings: vi.fn().mockReturnValue(pending) })
      ;(window as any).electronAPI = api
      render(
        <SettingsProvider>
          <Capture />
        </SettingsProvider>
      )
      expect(ctxValue.settings).toBeNull()
      act(() => ctxValue.update({ soundFeedback: false }))
      expect(ctxValue.settings).toBeNull()
      expect(api.setSoundFeedback).toHaveBeenCalledWith(false)
      await act(async () => {
        resolveSettings(defaultSettings)
        await pending
      })
    })
  })
})
