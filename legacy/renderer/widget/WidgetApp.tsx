import { useState, useEffect, useCallback, useRef } from 'react'
import Widget from './Widget'
import { useAudioRecorder } from './useAudioRecorder'
import type { WidgetState, AppProfile } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { WIDGET } from '../../shared/copy'

// ─── Sound Feedback (Web Audio API) ───
let soundEnabled = true // default on; loaded from settings on mount

// Chosen microphone input device id ('' / undefined = system default). Loaded
// from settings on mount and refreshed each time recording starts so a device
// change in Settings takes effect without restarting the widget.
let selectedInputDeviceId = ''

function playClickSound(type: 'start' | 'stop') {
  if (!soundEnabled) return
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.connect(gain)
    gain.connect(ctx.destination)

    // Start: higher pitch pop (880Hz), Stop: lower pitch (660Hz)
    oscillator.frequency.setValueAtTime(type === 'start' ? 880 : 660, ctx.currentTime)
    oscillator.type = 'sine'

    // Subtle vibrato — gentle wobble
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.connect(lfoGain)
    lfoGain.connect(oscillator.frequency)
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(14, ctx.currentTime)
    lfoGain.gain.setValueAtTime(8, ctx.currentTime)
    lfo.start(ctx.currentTime)
    lfo.stop(ctx.currentTime + 0.08)

    // Softer envelope with slight vibration
    gain.gain.setValueAtTime(0.07, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.08)

    // Cleanup
    setTimeout(() => ctx.close(), 200)
  } catch {
    // Silently ignore — sound is non-critical
  }
}

export default function WidgetApp() {
  const [state, setState] = useState<WidgetState>('hidden')
  const [outputPreview, setOutputPreview] = useState('')
  const [fallbackMessage, setFallbackMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showDiscardHint, setShowDiscardHint] = useState(false)
  const [engineNotice, setEngineNotice] = useState<string | null>(null)
  const { analyserNode, maxDurationSeconds, startRecording, stopRecording } = useAudioRecorder()

  // Track auto-hide timer so it can be cancelled when a new recording starts
  const autoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Dedup RECORDING_START re-sends: captureFrontmostApp() re-emits the same
  // sessionId once detection resolves. Guard prevents restarting the recorder
  // (which would flush the partial first fragment and drop opening audio).
  const activeSessionIdRef = useRef<string | null>(null)

  const clearAutoHide = useCallback(() => {
    if (autoHideRef.current) {
      clearTimeout(autoHideRef.current)
      autoHideRef.current = null
    }
  }, [])

  const scheduleAutoHide = useCallback(
    (delayMs: number) => {
      clearAutoHide()
      autoHideRef.current = setTimeout(() => {
        autoHideRef.current = null
        setState('hidden')
      }, delayMs)
    },
    [clearAutoHide]
  )

  useEffect(() => {
    // FORCE the widget window dark. The transparent HUD pill reads best as dark
    // glass over arbitrary screen content, so it must NEVER follow the user's
    // dashboard theme. tokens.css scopes the dark token set to
    // `:root, [data-theme='dark']`, so an explicit data-theme='dark' on this
    // window's <html> resolves every --mv-* (glass, border, shadow) to its dark
    // value; the `[data-theme='light']` block can never match this root. (This
    // is a separate window/document from the dashboard — no theming conflict.)
    document.documentElement.setAttribute('data-theme', 'dark')
    document.body.classList.add('widget-body')
    document.documentElement.style.background = 'transparent'
    return () => {
      document.body.classList.remove('widget-body')
    }
  }, [])

  useEffect(() => {
    const api = window.electronAPI

    // Load sound feedback preference
    api
      .getSoundFeedback()
      .then((enabled: boolean) => {
        soundEnabled = enabled
      })
      .catch(() => {
        /* ignore — default is true */
      })

    // Load the persisted microphone input device.
    api
      .getInputDevice()
      .then((deviceId: string) => {
        selectedInputDeviceId = deviceId || ''
      })
      .catch(() => {
        /* ignore — default is system default */
      })

    api.onRecordingStart(async (mode, sessionId, _appName?: string, _profile?: AppProfile) => {
      // Re-entry guard: same sessionId = captureFrontmostApp() metadata re-send.
      // Skip to avoid restarting the recorder and dropping opening audio.
      if (sessionId && activeSessionIdRef.current === sessionId) return

      // Cancel any pending auto-hide from a previous session
      clearAutoHide()

      activeSessionIdRef.current = sessionId ?? null

      playClickSound('start')
      setEngineNotice(null)
      setState(mode === 'dictation' ? 'dictation-active' : 'instruction-active')
      // Refresh the chosen input device so a Settings change applies without a
      // widget restart. Empty/unknown id => system default (pass undefined).
      try {
        selectedInputDeviceId = (await api.getInputDevice()) || ''
      } catch {
        /* keep the last-known value */
      }
      try {
        await startRecording(selectedInputDeviceId || undefined, mode, sessionId)
      } catch {
        setErrorMessage(WIDGET.MIC_START_FAILED)
        setState('error')
        scheduleAutoHide(3000)
      }
    })

    api.onRecordingStop(async () => {
      // Recording is ending — clear the in-flight id so a late
      // captureFrontmostApp re-send can no longer match (and so the next
      // session is never wrongly deduped against a reused id).
      activeSessionIdRef.current = null
      setState('processing')
      setShowDiscardHint(false)
      await stopRecording()
    })

    api.onOutputReady(() => {
      // Raw-by-default: the text is already at the cursor. No preview — a brief
      // success ack, then get out of the way.
      playClickSound('stop')
      setState('output')
      setShowDiscardHint(false)
      scheduleAutoHide(1200)
    })

    api.onOutputFallback((text, _sessionId, message) => {
      playClickSound('stop')
      const preview = text.length > 50 ? text.slice(0, 50) + '...' : text
      setOutputPreview(preview)
      setFallbackMessage(message || WIDGET.FALLBACK_DEFAULT)
      setState('output-fallback')
      setShowDiscardHint(false)
      scheduleAutoHide(4000)
    })

    api.onOutputError((error) => {
      playClickSound('stop')
      setErrorMessage(error)
      setState('error')
      setShowDiscardHint(false)
      scheduleAutoHide(5000)
    })

    api.onSessionCancelled(() => {
      activeSessionIdRef.current = null
      setState('cancelled')
      setShowDiscardHint(false)
    })

    api.onProcessingDiscardHint(() => {
      setShowDiscardHint(true)
    })

    api.onSessionTooShort(() => {
      setState('too-short')
      setShowDiscardHint(false)
    })

    api.onEngineNotice((reason) => {
      // Provider fallback notice (e.g. LLM offline -> raw transcript pasted)
      setEngineNotice(reason)
    })

    // Tell main the widget is mounted; showHUD() is gated on this so the
    // panel never appears blank on cold start.
    api.widgetReady()

    return () => {
      api.removeAllListeners(IPC.RECORDING_START)
      api.removeAllListeners(IPC.RECORDING_STOP)
      api.removeAllListeners(IPC.OUTPUT_READY)
      api.removeAllListeners(IPC.OUTPUT_FALLBACK)
      api.removeAllListeners(IPC.OUTPUT_ERROR)
      api.removeAllListeners(IPC.SESSION_CANCELLED)
      api.removeAllListeners(IPC.PROCESSING_SHOW_DISCARD_HINT)
      api.removeAllListeners(IPC.SESSION_TOO_SHORT)
      api.removeAllListeners(IPC.SESSION_ENGINE_NOTICE)
    }
  }, [startRecording, stopRecording, clearAutoHide, scheduleAutoHide])

  const handleCancel = useCallback(async () => {
    await stopRecording()
    window.electronAPI.cancelSession()
    setState('hidden')
  }, [stopRecording])

  const handleStop = useCallback(async () => {
    setState('processing')
    setShowDiscardHint(false)
    // Flush the captured audio to main, then tell main to stop + process now.
    // Without this second signal main only stores the buffer (processing is
    // otherwise driven solely by the hotkey 'chain-expired' event), so the HUD
    // would hang on "Thinking" forever. stopSession() routes through the same
    // canonical stop path the hotkey uses.
    await stopRecording()
    window.electronAPI.stopSession()
  }, [stopRecording])

  const handleUndo = useCallback(() => {
    // Undo processes the already-captured audio, so show processing state
    setState('processing')
    window.electronAPI.undoCancel()
  }, [])

  return (
    <div
      // Bottom-anchored: the HUD window sits above the Dock (see
      // windowManager.getHUDBounds); the pill hugs the canvas bottom so its
      // gap to the Dock is exactly the configured margin. Error/multi-line
      // states grow upward into the spare canvas.
      className="w-full h-full flex items-end justify-center"
      style={{ background: 'transparent', paddingBottom: '8px' }}
    >
      <Widget
        state={state}
        analyserNode={analyserNode}
        maxDurationSeconds={maxDurationSeconds}
        outputPreview={outputPreview}
        fallbackMessage={fallbackMessage}
        errorMessage={errorMessage}
        showDiscardHint={showDiscardHint}
        engineNotice={engineNotice}
        onCancel={handleCancel}
        onStop={handleStop}
        onUndo={handleUndo}
      />
    </div>
  )
}
