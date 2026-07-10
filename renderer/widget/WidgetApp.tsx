import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppConfig, RendererSettings, SessionMode, WidgetState } from '../../shared/types'
import Widget from './Widget'
import { recorder } from './recorder'
import { playClick } from './sounds'

type LiveSettings = Pick<RendererSettings, 'soundFeedback' | 'chunkedTranscription' | 'inputDeviceId'>

/**
 * HUD IPC controller — binds every widget channel to state, drives the
 * recorder engine, plays sound feedback. Renderer only RENDERS states;
 * visibility timing (auto-hide, undo window) is main's job via HUD_HIDE.
 *
 * Live settings (soundFeedback / chunkedTranscription / inputDeviceId) come
 * from the batched SETTINGS_GET and are kept fresh via SETTINGS_CHANGED —
 * no restart required (v1 bug #14). All subscriptions clean up via their
 * returned unsubscribers, so StrictMode double-mounts never double-bind.
 */
export default function WidgetApp(): ReactNode {
  const [state, setState] = useState<WidgetState>('hidden')
  const [mode, setMode] = useState<SessionMode>('dictation')
  const [appName, setAppName] = useState<string | undefined>(undefined)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [fallbackMessage, setFallbackMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showDiscardHint, setShowDiscardHint] = useState(false)

  const settingsRef = useRef<LiveSettings>({
    soundFeedback: true,
    chunkedTranscription: false,
    inputDeviceId: ''
  })
  const chunkingRef = useRef<AppConfig['chunking'] | undefined>(undefined)
  // Dedup guard: RECORDING_START may re-emit the same sessionId once
  // frontmost-app detection resolves — never restart the recorder for it.
  const activeSessionIdRef = useRef<string | null>(null)

  const click = useCallback((type: 'start' | 'stop') => {
    if (settingsRef.current.soundFeedback) playClick(type)
  }, [])

  const handleStop = useCallback(async () => {
    setState('processing')
    setShowDiscardHint(false)
    // Flush the audio (AUDIO_FINAL / AUDIO_DISCARDED) before telling main to
    // stop-and-process, matching the hotkey's canonical stop path.
    await recorder.stop()
    window.electronAPI.widgetStop()
  }, [])

  const handleCancel = useCallback(async () => {
    // Cancel first so main drops the recorder's late buffer by session id.
    window.electronAPI.widgetCancel()
    await recorder.stop()
  }, [])

  const handleUndo = useCallback(() => {
    // Undo re-processes the already-captured audio — show processing now.
    setState('processing')
    window.electronAPI.widgetUndoCancel()
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    let disposed = false

    api
      .getSettings()
      .then((s) => {
        if (disposed) return
        settingsRef.current = {
          soundFeedback: s.soundFeedback,
          chunkedTranscription: s.chunkedTranscription,
          inputDeviceId: s.inputDeviceId
        }
      })
      .catch(() => {
        /* keep defaults */
      })
    api
      .getAppConfig()
      .then((c) => {
        if (!disposed) chunkingRef.current = c.chunking
      })
      .catch(() => {
        /* recorder falls back to its tuned defaults */
      })

    const unsubs = [
      api.onSettingsChanged((partial) => {
        const merged = { ...settingsRef.current, ...partial }
        settingsRef.current = {
          soundFeedback: merged.soundFeedback,
          chunkedTranscription: merged.chunkedTranscription,
          inputDeviceId: merged.inputDeviceId
        }
      }),

      api.onRecordingStart(async (sessionMode, sessionId, sessionAppName) => {
        if (activeSessionIdRef.current === sessionId) {
          // Frontmost-app metadata re-send — update the chip only.
          setAppName(sessionAppName)
          return
        }
        activeSessionIdRef.current = sessionId
        setMode(sessionMode)
        setAppName(sessionAppName)
        setShowDiscardHint(false)
        setState('recording')
        click('start')
        try {
          await recorder.start({
            mode: sessionMode,
            sessionId,
            deviceId: settingsRef.current.inputDeviceId || undefined,
            chunkedTranscription: settingsRef.current.chunkedTranscription,
            chunking: chunkingRef.current,
            onMaxDuration: () => void handleStop()
          })
          setAnalyser(recorder.getAnalyser())
          api.recordingAck(sessionId) // recorder rolling
        } catch (err) {
          console.log('[widget] recorder start failed:', err)
          setErrorMessage("Couldn't access the microphone")
          setState('error')
        }
      }),

      api.onRecordingStop(() => {
        activeSessionIdRef.current = null
        setState('processing')
        setShowDiscardHint(false)
        void recorder.stop()
      }),

      api.onOutputReady(() => {
        click('stop')
        setShowDiscardHint(false)
        setState('output')
      }),

      api.onOutputFallback((_text, _sessionId, message) => {
        click('stop')
        setFallbackMessage(message ?? '')
        setShowDiscardHint(false)
        setState('fallback')
      }),

      api.onOutputError((error) => {
        click('stop')
        setErrorMessage(error)
        setShowDiscardHint(false)
        setState('error')
      }),

      api.onSessionCancelled(() => {
        activeSessionIdRef.current = null
        setShowDiscardHint(false)
        setState('cancelled')
      }),

      api.onSessionTooShort(() => {
        setShowDiscardHint(false)
        setState('too-short')
      }),

      api.onProcessingDiscardHint(() => setShowDiscardHint(true)),

      api.onHudHide(() => setState('hidden'))
    ]

    // Readiness handshake — showHUD() is gated on this so the pill never
    // flashes empty on cold start.
    api.widgetReady()

    return () => {
      disposed = true
      unsubs.forEach((u) => u())
    }
  }, [click, handleStop])

  return (
    <Widget
      state={state}
      mode={mode}
      appName={appName}
      analyserNode={analyser}
      fallbackMessage={fallbackMessage}
      errorMessage={errorMessage}
      showDiscardHint={showDiscardHint}
      onStop={() => void handleStop()}
      onCancel={() => void handleCancel()}
      onUndo={handleUndo}
      onExited={() => window.electronAPI.hudExitDone()}
    />
  )
}
