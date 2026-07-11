// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import WidgetApp from './WidgetApp'
import { recorder } from './recorder'
import * as sounds from './sounds'
import type { ElectronAPI, RendererSettings, AppConfig, SessionMode } from '../../shared/types'

type Handler = (...args: any[]) => void

interface Harness {
  api: ElectronAPI
  fire: {
    settingsChanged(partial: Partial<RendererSettings>): void
    recordingStart(mode: SessionMode, sessionId: string, appName?: string): Promise<void> | void
    recordingStop(sessionId: string): void
    outputReady(text: string, sessionId: string): void
    outputFallback(text: string, sessionId: string, message?: string): void
    outputError(error: string, sessionId: string): void
    sessionCancelled(): void
    sessionTooShort(): void
    processingDiscardHint(): void
    hudHide(): void
  }
  getSettingsResolve(s: Partial<RendererSettings>): void
  getAppConfigResolve(c: AppConfig): void
}

function buildHarness(): Harness {
  const handlers: Record<string, Handler> = {}
  let getSettingsResolve: (s: Partial<RendererSettings>) => void = () => {}
  let getAppConfigResolve: (c: AppConfig) => void = () => {}

  const getSettingsPromise = new Promise<RendererSettings>((resolve) => {
    getSettingsResolve = resolve as any
  })
  const getAppConfigPromise = new Promise<AppConfig>((resolve) => {
    getAppConfigResolve = resolve as any
  })

  function on(name: string): (cb: Handler) => () => void {
    return (cb: Handler) => {
      handlers[name] = cb
      return vi.fn()
    }
  }

  const api = {
    onRecordingStart: vi.fn(on('recordingStart')),
    onRecordingStop: vi.fn(on('recordingStop')),
    recordingAck: vi.fn(),
    sendAudioChunk: vi.fn(),
    sendAudioFinal: vi.fn(),
    sendAudioDiscarded: vi.fn(),
    onOutputReady: vi.fn(on('outputReady')),
    onOutputFallback: vi.fn(on('outputFallback')),
    onOutputError: vi.fn(on('outputError')),
    onSessionCancelled: vi.fn(on('sessionCancelled')),
    onSessionTooShort: vi.fn(on('sessionTooShort')),
    onProcessingDiscardHint: vi.fn(on('processingDiscardHint')),
    widgetStop: vi.fn(),
    widgetCancel: vi.fn(),
    widgetUndoCancel: vi.fn(),
    widgetReady: vi.fn(),
    onHudHide: vi.fn(on('hudHide')),
    hudExitDone: vi.fn(),
    getSessions: vi.fn(),
    retrySession: vi.fn(),
    onRetryStatus: vi.fn(),
    deleteSession: vi.fn(),
    clearAllSessions: vi.fn(),
    getUsage: vi.fn(),
    resetUsage: vi.fn(),
    getProviderKeyStatus: vi.fn(),
    setProviderKey: vi.fn(),
    testProviderKey: vi.fn(),
    clearProviderKey: vi.fn(),
    listModels: vi.fn(),
    getSettings: vi.fn().mockReturnValue(getSettingsPromise),
    onSettingsChanged: vi.fn(on('settingsChanged')),
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
    setDictionary: vi.fn(),
    setReplacements: vi.fn(),
    setSnippets: vi.fn(),
    setRules: vi.fn(),
    writeLog: vi.fn(),
    setSTTSettings: vi.fn(),
    setLLMSettings: vi.fn(),
    getTheme: vi.fn(),
    setTheme: vi.fn(),
    permissionsPreflight: vi.fn(),
    openPermissionPane: vi.fn(),
    requestMicPermission: vi.fn(),
    getKeyCapability: vi.fn(),
    getAppConfig: vi.fn().mockReturnValue(getAppConfigPromise),
    openExternal: vi.fn(),
    onDevErrorLog: vi.fn()
  }

  return {
    api,
    fire: {
      settingsChanged: (p) => handlers['settingsChanged']?.(p),
      recordingStart: (mode, sessionId, appName) => handlers['recordingStart']?.(mode, sessionId, appName),
      recordingStop: (sessionId) => handlers['recordingStop']?.(sessionId),
      outputReady: (text, sessionId) => handlers['outputReady']?.(text, sessionId),
      outputFallback: (text, sessionId, message) => handlers['outputFallback']?.(text, sessionId, message),
      outputError: (error, sessionId) => handlers['outputError']?.(error, sessionId),
      sessionCancelled: () => handlers['sessionCancelled']?.(),
      sessionTooShort: () => handlers['sessionTooShort']?.(),
      processingDiscardHint: () => handlers['processingDiscardHint']?.(),
      hudHide: () => handlers['hudHide']?.()
    },
    getSettingsResolve,
    getAppConfigResolve
  }
}

beforeEach(() => {
  vi.spyOn(recorder, 'start').mockResolvedValue(undefined)
  vi.spyOn(recorder, 'stop').mockResolvedValue(undefined)
  vi.spyOn(recorder, 'getAnalyser').mockReturnValue(null)
  vi.spyOn(sounds, 'playClick').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WidgetApp', () => {
  it('calls widgetReady on mount and subscribes to every channel', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    expect(h.api.widgetReady).toHaveBeenCalledTimes(1)
    expect(h.api.onRecordingStart).toHaveBeenCalled()
    expect(h.api.onHudHide).toHaveBeenCalled()
    h.getSettingsResolve({ soundFeedback: true, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })
  })

  it('starts recording on RECORDING_START, plays the start click, and acks', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: true, chunkedTranscription: false, inputDeviceId: 'dev1' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1', 'Notes')
    })

    expect(sounds.playClick).toHaveBeenCalledWith('start')
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dictation', sessionId: 'sess-1', deviceId: 'dev1' })
    )
    expect(h.api.recordingAck).toHaveBeenCalledWith('sess-1')
    expect(screen.getByText('Listening')).toBeTruthy()
    expect(screen.getByText('· Notes')).toBeTruthy()
  })

  it('does not restart the recorder for a duplicate RECORDING_START with the same sessionId (dedup)', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1', 'Notes')
    })
    expect(recorder.start).toHaveBeenCalledTimes(1)

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1', 'Renamed App')
    })
    // Recorder not restarted, but the app-name chip updates.
    expect(recorder.start).toHaveBeenCalledTimes(1)
    expect(screen.getByText('· Renamed App')).toBeTruthy()
  })

  it("invokes handleStop when the recorder's onMaxDuration callback fires", async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1')
    })

    const startArgs = (recorder.start as any).mock.calls[0][0]
    await act(async () => {
      startArgs.onMaxDuration()
      await Promise.resolve()
    })

    expect(h.api.widgetStop).toHaveBeenCalledTimes(1)
  })

  it('shows an error state when recorder.start rejects (mic denied)', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    ;(recorder.start as any).mockRejectedValueOnce(new Error('denied'))
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1')
    })

    expect(screen.getByText("Couldn't access the microphone")).toBeTruthy()
  })

  it('RECORDING_STOP transitions to processing and stops the recorder', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1')
    })
    act(() => {
      h.fire.recordingStop('sess-1')
    })
    expect(screen.getByText('Thinking…')).toBeTruthy()
    expect(recorder.stop).toHaveBeenCalled()
  })

  it('handleStop (clicking the Stop button) flushes the recorder then tells main to stop', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1')
    })

    await act(async () => {
      screen.getByLabelText('Stop recording').click()
      await Promise.resolve()
    })

    expect(recorder.stop).toHaveBeenCalled()
    expect(h.api.widgetStop).toHaveBeenCalledTimes(1)
  })

  it('handleCancel cancels via main first, then stops the recorder', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1')
    })

    await act(async () => {
      screen.getByLabelText('Cancel recording (Escape)').click()
      await Promise.resolve()
    })

    expect(h.api.widgetCancel).toHaveBeenCalledTimes(1)
    expect(recorder.stop).toHaveBeenCalled()
  })

  it('handleUndo sets processing and calls widgetUndoCancel', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.sessionCancelled()
    })
    expect(screen.getByText('Cancelled')).toBeTruthy()

    await act(async () => {
      screen.getByLabelText('Undo cancel').click()
    })
    expect(h.api.widgetUndoCancel).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Thinking…')).toBeTruthy()
  })

  it('onOutputReady plays the stop click and shows the output state', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: true, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.outputReady('hello', 'sess-1')
    })
    expect(sounds.playClick).toHaveBeenCalledWith('stop')
    expect(screen.getByLabelText('Pasted')).toBeTruthy()
  })

  it('onOutputFallback shows the fallback state with the given message', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.outputFallback('text', 'sess-1', 'Needed manual formatting')
    })
    expect(screen.getByText('Needed manual formatting')).toBeTruthy()
  })

  it('onOutputFallback with no message falls back to an empty string', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.outputFallback('text', 'sess-1', undefined)
    })
    // Falls back to the Widget's own default message since fallbackMessage === ''.
    expect(screen.getByText('Pasted without formatting')).toBeTruthy()
  })

  it('onOutputError shows the error state with the given message', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.outputError('boom', 's1')
    })
    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('onSessionTooShort shows the too-short state', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.sessionTooShort()
    })
    expect(screen.getByText("Didn't catch that")).toBeTruthy()
  })

  it('onProcessingDiscardHint shows the discard hint while processing', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1')
    })
    act(() => {
      h.fire.recordingStop('sess-1')
    })
    act(() => {
      h.fire.processingDiscardHint()
    })
    expect(screen.getByText('Esc to discard')).toBeTruthy()
  })

  it('onHudHide sets state to hidden', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    const { container } = render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.hudHide()
    })
    // Widget starts as hidden+not-visible, so hiding again keeps it unrendered.
    expect(container.querySelector('.hud-root')).toBeNull()
  })

  it("Widget's onExited (after the hide animation) calls electronAPI.hudExitDone", async () => {
    vi.useFakeTimers()
    try {
      const h = buildHarness()
      ;(window as any).electronAPI = h.api
      render(<WidgetApp />)
      h.getSettingsResolve({ soundFeedback: false, chunkedTranscription: false, inputDeviceId: '' })
      h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
      await act(async () => {
        await Promise.resolve()
      })

      await act(async () => {
        await h.fire.recordingStart('dictation', 'sess-1')
      })
      act(() => {
        h.fire.hudHide()
      })
      act(() => {
        vi.advanceTimersByTime(200) // Widget's EXIT_MS
      })
      expect(h.api.hudExitDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('onSettingsChanged merges a partial into the live settings ref (used by the next recordingStart)', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    render(<WidgetApp />)
    h.getSettingsResolve({ soundFeedback: true, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      h.fire.settingsChanged({ soundFeedback: false })
    })

    await act(async () => {
      await h.fire.recordingStart('dictation', 'sess-1')
    })
    // soundFeedback is now false -> no click played.
    expect(sounds.playClick).not.toHaveBeenCalled()
  })

  it('falls back to default settings when getSettings/getAppConfig reject', async () => {
    const handlers: Record<string, Handler> = {}
    const api = {
      onRecordingStart: vi.fn((cb: Handler) => {
        handlers['recordingStart'] = cb
        return vi.fn()
      }),
      onRecordingStop: vi.fn().mockReturnValue(vi.fn()),
      recordingAck: vi.fn(),
      sendAudioChunk: vi.fn(),
      sendAudioFinal: vi.fn(),
      sendAudioDiscarded: vi.fn(),
      onOutputReady: vi.fn().mockReturnValue(vi.fn()),
      onOutputFallback: vi.fn().mockReturnValue(vi.fn()),
      onOutputError: vi.fn().mockReturnValue(vi.fn()),
      onSessionCancelled: vi.fn().mockReturnValue(vi.fn()),
      onSessionTooShort: vi.fn().mockReturnValue(vi.fn()),
      onProcessingDiscardHint: vi.fn().mockReturnValue(vi.fn()),
      widgetStop: vi.fn(),
      widgetCancel: vi.fn(),
      widgetUndoCancel: vi.fn(),
      widgetReady: vi.fn(),
      onHudHide: vi.fn().mockReturnValue(vi.fn()),
      hudExitDone: vi.fn(),
      getSessions: vi.fn(),
      retrySession: vi.fn(),
      onRetryStatus: vi.fn(),
      deleteSession: vi.fn(),
      clearAllSessions: vi.fn(),
      getUsage: vi.fn(),
      resetUsage: vi.fn(),
      getProviderKeyStatus: vi.fn(),
      setProviderKey: vi.fn(),
      testProviderKey: vi.fn(),
      clearProviderKey: vi.fn(),
      listModels: vi.fn(),
      getSettings: vi.fn().mockRejectedValue(new Error('no ipc')),
      onSettingsChanged: vi.fn().mockReturnValue(vi.fn()),
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
      setDictionary: vi.fn(),
      setReplacements: vi.fn(),
      setSnippets: vi.fn(),
      setRules: vi.fn(),
      writeLog: vi.fn(),
      setSTTSettings: vi.fn(),
      setLLMSettings: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
      permissionsPreflight: vi.fn(),
      openPermissionPane: vi.fn(),
      requestMicPermission: vi.fn(),
      getKeyCapability: vi.fn(),
      getAppConfig: vi.fn().mockRejectedValue(new Error('no ipc')),
      openExternal: vi.fn(),
      onDevErrorLog: vi.fn()
    }
    ;(window as any).electronAPI = api

    render(<WidgetApp />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await handlers['recordingStart']?.('dictation', 'sess-1')
    })
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: undefined, chunkedTranscription: false, chunking: undefined })
    )
  })

  it('unmount unsubscribes every channel and marks disposed (settings/config resolving after unmount is a no-op)', async () => {
    const h = buildHarness()
    ;(window as any).electronAPI = h.api
    const { unmount } = render(<WidgetApp />)
    unmount()
    h.getSettingsResolve({ soundFeedback: true, chunkedTranscription: false, inputDeviceId: '' })
    h.getAppConfigResolve({ version: '1', chunking: {} as any, junk_detection: {} as any })
    await act(async () => {
      await Promise.resolve()
    })
    // No assertions beyond "doesn't throw" — this exercises the `disposed` guards.
  })
})
