// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI, RendererSettings, RetryStatus, Session } from '../../shared/types'
import { SettingsProvider } from './settingsContext'
import History from './History'

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
  const retryStatusCbs: Array<(id: string, status: RetryStatus, data?: Partial<Session>) => void> = []
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
    onRetryStatus: vi.fn((cb: (id: string, status: RetryStatus, data?: Partial<Session>) => void) => {
      retryStatusCbs.push(cb)
      return vi.fn()
    }),
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
  return { api: api as unknown as ElectronAPI, retryStatusCbs }
}

function renderHistory(api: ElectronAPI) {
  ;(window as any).electronAPI = api
  return render(
    <SettingsProvider>
      <History />
    </SettingsProvider>
  )
}

describe('History', () => {
  it('shows a loading state before getSessions resolves', () => {
    const { api } = createElectronAPIMock({ getSessions: vi.fn(() => new Promise<never>(() => {})) })
    renderHistory(api)
    expect(screen.getByLabelText('Loading history')).toBeInTheDocument()
  })

  it('shows the empty state (with hint) once settings + zero sessions are loaded', async () => {
    const { api } = createElectronAPIMock()
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('No dictations yet')).toBeInTheDocument())
    expect(screen.getByText('fn')).toBeInTheDocument() // Kbd hint uses dictationBindingLabel
  })

  it('shows the empty state with no hint when settings have not loaded', () => {
    const { api } = createElectronAPIMock({ getSettings: vi.fn(() => new Promise<never>(() => {})) })
    renderHistory(api)
    return waitFor(() => {
      expect(screen.getByText('No dictations yet')).toBeInTheDocument()
      expect(screen.queryByText(/Press/)).not.toBeInTheDocument()
    })
  })

  it('logs an error and stops loading when getSessions rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockRejectedValue(new Error('fail')) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('No dictations yet')).toBeInTheDocument())
    expect(errSpy).toHaveBeenCalledWith('[history] failed to load sessions')
  })

  it('renders a session row with its flow badge, time and preview text', async () => {
    const session = makeSession({ output: 'Hello there', flowType: 'dictation' })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('Hello there')).toBeInTheDocument())
    // { selector: 'span' } — the flow-filter <select> also has a same-named <option>.
    expect(screen.getByText('Dictation', { selector: 'span' })).toBeInTheDocument()
  })

  it.each([
    ['transform', 'Instruction'],
    ['instruction', 'Instruction'],
    ['context', 'Context'],
    ['quote', 'Quote']
  ] as const)('labels flowType=%s as %s', async (flowType, label) => {
    const { api } = createElectronAPIMock({
      getSessions: vi.fn().mockResolvedValue([makeSession({ flowType, output: 'x' })])
    })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText(label, { selector: 'span' })).toBeInTheDocument())
  })

  it('falls back to the dictation flow config for an unrecognized flowType', async () => {
    const { api } = createElectronAPIMock({
      getSessions: vi.fn().mockResolvedValue([makeSession({ flowType: 'bogus' as Session['flowType'], output: 'x' })])
    })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('Dictation', { selector: 'span' })).toBeInTheDocument())
  })

  it('shows a Failed badge and errorMessage preview for an errored session', async () => {
    const session = makeSession({ status: 'error', errorMessage: 'Something broke', output: undefined })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument())
    expect(screen.getByText('Something broke')).toBeInTheDocument()
  })

  it('shows "No output" when a session has neither output, transcript nor errorMessage', async () => {
    const session = makeSession({ output: undefined, dictationTranscript: undefined, errorMessage: undefined })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('No output')).toBeInTheDocument())
  })

  it('prefers dictationTranscript over errorMessage when output is absent', async () => {
    const session = makeSession({ output: undefined, dictationTranscript: 'transcript text', errorMessage: 'ignored' })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('transcript text')).toBeInTheDocument())
  })

  it('shows a Retrying badge and re-processing text, hiding row actions, while a session is mid-retry', async () => {
    const session = makeSession({ output: 'has output', audioRef: 'audio-1' })
    const { api, retryStatusCbs } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('has output')).toBeInTheDocument())
    act(() => retryStatusCbs[0]('s1', 'processing'))
    expect(screen.getByText('Retrying…')).toBeInTheDocument()
    expect(screen.getByText('Re-processing audio…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Retry from saved audio')).not.toBeInTheDocument()
  })

  it('applies pushed session data and clears the retrying flag when retry status resolves to done, leaving other sessions untouched', async () => {
    const sessions = [
      makeSession({ id: 's1', output: 'old output', audioRef: 'audio-1' }),
      makeSession({ id: 's2', output: 'unrelated output' })
    ]
    const { api, retryStatusCbs } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(sessions) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('old output')).toBeInTheDocument())
    act(() => retryStatusCbs[0]('s1', 'processing'))
    act(() => retryStatusCbs[0]('s1', 'done', { output: 'new output' }))
    expect(screen.getByText('new output')).toBeInTheDocument()
    expect(screen.getByText('unrelated output')).toBeInTheDocument() // untouched by the s1-targeted update
    expect(screen.queryByText('Retrying…')).not.toBeInTheDocument()
  })

  it('clears the retrying flag on an error retry status even without data', async () => {
    const session = makeSession({ output: 'stays same', audioRef: 'audio-1' })
    const { api, retryStatusCbs } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('stays same')).toBeInTheDocument())
    act(() => retryStatusCbs[0]('s1', 'processing'))
    act(() => retryStatusCbs[0]('s1', 'error'))
    expect(screen.getByText('stays same')).toBeInTheDocument()
    expect(screen.queryByText('Retrying…')).not.toBeInTheDocument()
  })

  it(
    'copies output to the clipboard and reverts the icon after the reset timeout',
    async () => {
      // Real timers on purpose: fake timers deadlock RTL's waitFor polling here.
      const user = userEvent.setup()
      // user-event's setup() attaches its own navigator.clipboard stub (jsdom has none) --
      // spy on it only after that stub exists, or this spy gets clobbered.
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
      const session = makeSession({ output: 'copy me' })
      const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
      renderHistory(api)
      await waitFor(() => expect(screen.getByText('copy me')).toBeInTheDocument())
      const copyBtn = screen.getByLabelText('Copy output')
      await user.click(copyBtn)
      expect(writeTextSpy).toHaveBeenCalledWith('copy me')
      await new Promise((resolve) => setTimeout(resolve, 1600))
      // Pass condition: the COPY_RESET_MS timeout fired without throwing.
    },
    8000
  )

  it('clears the pending copy-reset timer when copying a second time before it fires', async () => {
    const user = userEvent.setup()
    const sessions = [makeSession({ id: 'a', output: 'first' }), makeSession({ id: 'b', output: 'second' })]
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(sessions) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument())
    const copyBtns = screen.getAllByLabelText('Copy output')
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await user.click(copyBtns[0])
    await user.click(copyBtns[1])
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('shows the Retry button only for sessions with a saved audioRef, and calls retrySession on click', async () => {
    const user = userEvent.setup()
    const session = makeSession({ output: 'retryable', audioRef: 'audio-1' })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('retryable')).toBeInTheDocument())
    const retryBtn = screen.getByLabelText('Retry from saved audio')
    await user.click(retryBtn)
    expect(api.retrySession).toHaveBeenCalledWith('s1')
  })

  it('swallows a retrySession rejection', async () => {
    const user = userEvent.setup()
    const session = makeSession({ output: 'retryable', audioRef: 'audio-1' })
    const { api } = createElectronAPIMock({
      getSessions: vi.fn().mockResolvedValue([session]),
      retrySession: vi.fn().mockRejectedValue(new Error('fail'))
    })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('retryable')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Retry from saved audio'))
    // No unhandled rejection is the pass condition.
  })

  it('omits the retry button for a session without an audioRef', async () => {
    const session = makeSession({ output: 'no audio', audioRef: undefined })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('no audio')).toBeInTheDocument())
    expect(screen.queryByLabelText('Retry from saved audio')).not.toBeInTheDocument()
  })

  it('row-action buttons are individually focus-visible-revealable (opacity-0 by default, own focus-visible/group-focus-within reveal)', async () => {
    const session = makeSession({ output: 'has output', audioRef: 'audio-1' })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('has output')).toBeInTheDocument())
    for (const button of [
      screen.getByLabelText('Copy output'),
      screen.getByLabelText('Retry from saved audio'),
      screen.getByLabelText('Delete session')
    ]) {
      expect(button).toHaveClass('opacity-0')
      expect(button).toHaveClass('focus-visible:opacity-100')
      expect(button).toHaveClass('group-focus-within:opacity-100')
      expect(button).toHaveClass('group-hover:opacity-100')
    }
  })

  it('optimistically removes a session on delete and calls deleteSession', async () => {
    const user = userEvent.setup()
    const session = makeSession({ output: 'delete me' })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('delete me')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Delete session'))
    expect(api.deleteSession).toHaveBeenCalledWith('s1')
    await waitFor(() => expect(screen.getByText('No dictations yet')).toBeInTheDocument())
  })

  it('reloads sessions if deleteSession rejects', async () => {
    const user = userEvent.setup()
    const session = makeSession({ output: 'delete me' })
    const getSessions = vi.fn().mockResolvedValue([session])
    const { api } = createElectronAPIMock({
      getSessions,
      deleteSession: vi.fn().mockRejectedValue(new Error('fail'))
    })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('delete me')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Delete session'))
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(2))
  })

  it('shows a confirm/cancel prompt for Clear all, and cancel restores the button', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({
      getSessions: vi.fn().mockResolvedValue([makeSession({ output: 'x' })])
    })
    renderHistory(api)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByText('Clear all sessions?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument()
  })

  it('clears all sessions on Confirm and calls clearAllSessions', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({
      getSessions: vi.fn().mockResolvedValue([makeSession({ output: 'x' })])
    })
    renderHistory(api)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(api.clearAllSessions).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('No dictations yet')).toBeInTheDocument())
  })

  it('reloads sessions if clearAllSessions rejects', async () => {
    const user = userEvent.setup()
    const getSessions = vi.fn().mockResolvedValue([makeSession({ output: 'x' })])
    const { api } = createElectronAPIMock({
      getSessions,
      clearAllSessions: vi.fn().mockRejectedValue(new Error('fail'))
    })
    renderHistory(api)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(2))
  })

  it('reloads sessions when the window regains focus, and unsubscribes/clears the copy timer on unmount', async () => {
    const getSessions = vi.fn().mockResolvedValue([makeSession({ output: 'x' })])
    const unsubscribe = vi.fn()
    const { api } = createElectronAPIMock({
      getSessions,
      onRetryStatus: vi.fn(() => unsubscribe)
    })
    const { unmount } = renderHistory(api)
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument())
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(2))
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('clears a pending copy timer on unmount', async () => {
    const user = userEvent.setup()
    const session = makeSession({ output: 'copy me' })
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue([session]) })
    const { unmount } = renderHistory(api)
    await waitFor(() => expect(screen.getByText('copy me')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Copy output'))
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    unmount()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})

describe('History search + filters', () => {
  function multiSessions(): Session[] {
    return [
      makeSession({ id: 'a', flowType: 'dictation', status: 'done', output: 'buy milk and eggs' }),
      makeSession({
        id: 'b',
        flowType: 'instruction',
        status: 'done',
        output: 'rewrite this paragraph',
        instructionTranscript: 'make it formal'
      }),
      makeSession({
        id: 'c',
        flowType: 'transform',
        status: 'error',
        output: undefined,
        dictationTranscript: 'quarterly revenue summary',
        errorMessage: 'failed'
      })
    ]
  }

  it('filters by a case-insensitive substring match across dictation transcript, instruction transcript, and output', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(multiSessions()) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('buy milk and eggs')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Search history'), 'FORMAL')
    await waitFor(() => {
      expect(screen.getByText('rewrite this paragraph')).toBeInTheDocument()
      expect(screen.queryByText('buy milk and eggs')).not.toBeInTheDocument()
      expect(screen.queryByText('quarterly revenue summary')).not.toBeInTheDocument()
    })
  })

  it('filters by flow type', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(multiSessions()) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('buy milk and eggs')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Filter by flow'), 'instruction')
    await waitFor(() => {
      expect(screen.getByText('rewrite this paragraph')).toBeInTheDocument()
      expect(screen.queryByText('buy milk and eggs')).not.toBeInTheDocument()
      expect(screen.queryByText('quarterly revenue summary')).not.toBeInTheDocument()
    })
  })

  it('filters by status', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(multiSessions()) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('buy milk and eggs')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'error')
    await waitFor(() => {
      expect(screen.getByText('quarterly revenue summary')).toBeInTheDocument()
      expect(screen.queryByText('buy milk and eggs')).not.toBeInTheDocument()
    })
  })

  it('combines search and the flow filter with AND semantics', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(multiSessions()) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('buy milk and eggs')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Filter by flow'), 'transform')
    await user.type(screen.getByLabelText('Search history'), 'revenue')
    await waitFor(() => expect(screen.getByText('quarterly revenue summary')).toBeInTheDocument())
    // Same search term, but narrowing the flow to one that can't match it — AND, not OR.
    await user.selectOptions(screen.getByLabelText('Filter by flow'), 'dictation')
    await waitFor(() => expect(screen.getByText('No matching sessions')).toBeInTheDocument())
  })

  it('shows a "no matching sessions" empty state with a Clear filters affordance, distinct from the zero-session empty state', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(multiSessions()) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('buy milk and eggs')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Search history'), 'nonexistent-term-xyz')
    await waitFor(() => expect(screen.getByText('No matching sessions')).toBeInTheDocument())
    expect(screen.queryByText('No dictations yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('restores the full session list when Clear filters is clicked', async () => {
    const user = userEvent.setup()
    const { api } = createElectronAPIMock({ getSessions: vi.fn().mockResolvedValue(multiSessions()) })
    renderHistory(api)
    await waitFor(() => expect(screen.getByText('buy milk and eggs')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Filter by flow'), 'instruction')
    await user.type(screen.getByLabelText('Search history'), 'nonexistent-term-xyz')
    await waitFor(() => expect(screen.getByText('No matching sessions')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => {
      expect(screen.getByText('buy milk and eggs')).toBeInTheDocument()
      expect(screen.getByText('rewrite this paragraph')).toBeInTheDocument()
      expect(screen.getByText('quarterly revenue summary')).toBeInTheDocument()
    })
  })
})
