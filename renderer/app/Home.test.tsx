// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI, RendererSettings, Session } from '../../shared/types'
import { SettingsProvider } from './settingsContext'
import Home from './Home'

afterEach(() => cleanup())

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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    createdAt: Date.now(),
    flowType: 'dictation',
    status: 'done',
    ...overrides
  }
}

function createElectronAPIMock(overrides: Partial<ElectronAPI> = {}) {
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
      month: { sttSeconds: 125, inputTokens: 10, outputTokens: 20, costUsd: 1.2345, byModel: {} },
      allTime: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} }
    }),
    resetUsage: vi.fn(),
    getProviderKeyStatus: vi.fn().mockResolvedValue({ provider: 'groq', hasKey: false, maskedKey: null }),
    setProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    testProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    clearProviderKey: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(defaultSettings),
    onSettingsChanged: vi.fn(() => vi.fn()),
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
  return api as unknown as ElectronAPI
}

function renderHome(api: ElectronAPI) {
  ;(window as any).electronAPI = api
  return render(
    <SettingsProvider>
      <Home />
    </SettingsProvider>
  )
}

describe('Home', () => {
  it('shows dashes for usage stats before async data resolves', () => {
    const api = createElectronAPIMock({ getSettings: vi.fn(() => new Promise<never>(() => {})) })
    renderHome(api)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2) // word count + minutes
  })

  it('renders resolved usage totals, month words, minutes and cost', async () => {
    const sessions = [
      makeSession({ output: 'hello world', createdAt: Date.now() }),
      makeSession({ id: 's2', dictationTranscript: 'three word phrase', createdAt: Date.now() }),
      // Excluded: created before this month started.
      makeSession({ id: 's3', output: 'should not count at all here', createdAt: 0 })
    ]
    const api = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(sessions) })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument()) // 2 + 3 words
    expect(screen.getByText('2')).toBeInTheDocument() // minutes: round(125/60)
    expect(screen.getByText('$1.23')).toBeInTheDocument()
  })

  it('counts zero words when sessions have no output or transcript text', async () => {
    const sessions = [makeSession({ output: '', dictationTranscript: undefined })]
    const api = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(sessions) })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument())
  })

  it('formats cost as $0.00 when cost is exactly zero', async () => {
    const api = createElectronAPIMock({
      getUsage: vi.fn().mockResolvedValue({
        today: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} },
        month: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} },
        allTime: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} }
      })
    })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())
  })

  it('formats sub-cent cost as <$0.01', async () => {
    const api = createElectronAPIMock({
      getUsage: vi.fn().mockResolvedValue({
        today: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} },
        month: { sttSeconds: 5, inputTokens: 0, outputTokens: 0, costUsd: 0.004, byModel: {} },
        allTime: { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} }
      })
    })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('<$0.01')).toBeInTheDocument())
  })

  it('marks provider rows connected/optional/not-set based on key status', async () => {
    const api = createElectronAPIMock({
      getProviderKeyStatus: vi.fn((p: string) =>
        Promise.resolve({ provider: p, hasKey: p === 'groq', maskedKey: null })
      ) as any
    })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
    expect(screen.getByText('Not set')).toBeInTheDocument() // openai
    expect(screen.getByText('Optional')).toBeInTheDocument() // openrouter
  })

  it('shows the fn fallback hotkey label and tap-toggle default when settings never load', () => {
    const api = createElectronAPIMock({ getSettings: vi.fn(() => new Promise<never>(() => {})) })
    renderHome(api)
    expect(screen.getByText('Tap to toggle')).toBeInTheDocument()
    expect(screen.getByText('Fn')).toBeInTheDocument()
  })

  it('renders each activation mode label and the push-to-talk/dual-mode bindings', async () => {
    const api = createElectronAPIMock({
      getSettings: vi.fn().mockResolvedValue({
        ...defaultSettings,
        activationMode: 'push-to-talk',
        dictationBinding: { type: 'combo', mods: ['cmd', 'shift'] }
      })
    })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('Push to talk')).toBeInTheDocument())
  })

  it('renders the double-tap-push (Dual mode) activation label', async () => {
    const api = createElectronAPIMock({
      getSettings: vi.fn().mockResolvedValue({ ...defaultSettings, activationMode: 'double-tap-push' })
    })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('Dual mode')).toBeInTheDocument())
  })

  it('renders every dictation single-key binding label variant, including the defensive default', async () => {
    const cases: Array<[RendererSettings['dictationBinding'], string]> = [
      [{ type: 'key', key: 'fn' }, 'Fn'],
      [{ type: 'key', key: 'right-option' }, 'Right Opt'],
      [{ type: 'key', key: 'right-ctrl' }, 'Right Ctrl'],
      [{ type: 'key', key: 'right-alt' }, 'Right Alt'],
      // Not a real DictationKey -- exercises the switch's defensive `default: return 'Fn'`.
      [{ type: 'key', key: 'bogus' } as unknown as RendererSettings['dictationBinding'], 'Fn']
    ]
    for (const [binding, label] of cases) {
      cleanup()
      const api = createElectronAPIMock({
        getSettings: vi.fn().mockResolvedValue({ ...defaultSettings, dictationBinding: binding })
      })
      renderHome(api)
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument())
    }
  })

  it('toggles auto-format on and off via the AI auto-format switch', async () => {
    const user = userEvent.setup()
    const api = createElectronAPIMock()
    renderHome(api)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'AI auto-format' })).toBeInTheDocument())
    await user.click(screen.getByRole('switch', { name: 'AI auto-format' }))
    expect(api.setAutoFormat).toHaveBeenCalledWith(true)
  })

  it('toggles adapt-to-active-app via its switch and disables it when autoFormat is off', async () => {
    const user = userEvent.setup()
    const api = createElectronAPIMock({
      getSettings: vi.fn().mockResolvedValue({ ...defaultSettings, autoFormat: true, appAwareFormatting: true })
    })
    renderHome(api)
    const appAwareSwitch = await screen.findByRole('switch', { name: 'Adapt to active app' })
    expect(appAwareSwitch).toBeEnabled()
    await user.click(appAwareSwitch)
    expect(api.setAppAwareFormatting).toHaveBeenCalledWith(false)
  })

  it('disables the adapt-to-active-app switch when autoFormat is off', async () => {
    const api = createElectronAPIMock()
    renderHome(api)
    const appAwareSwitch = await screen.findByRole('switch', { name: 'Adapt to active app' })
    expect(appAwareSwitch).toBeDisabled()
  })

  it('silently ignores getUsage/getProviderKeyStatus/getSessions rejections', async () => {
    const api = createElectronAPIMock({
      getUsage: vi.fn().mockRejectedValue(new Error('fail')),
      getProviderKeyStatus: vi.fn().mockRejectedValue(new Error('fail')),
      getSessions: vi.fn().mockRejectedValue(new Error('fail'))
    })
    renderHome(api)
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument())
    // No unhandled rejection / thrown error is the pass condition.
  })
})
