import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SessionMode, WidgetState } from '../../shared/types'
import Waveform from './Waveform'
import { MAX_DURATION_MS } from './recorder'
import './widget.css'

// Must match the hud-enter/hud-exit durations in widget.css (same module).
const EXIT_MS = 200
const WARN_THRESHOLD_S = 30
const MAX_DURATION_S = Math.round(MAX_DURATION_MS / 1000)

type ShownState = Exclude<WidgetState, 'hidden'>

interface WidgetProps {
  state: WidgetState
  mode: SessionMode
  appName?: string
  analyserNode: AnalyserNode | null
  fallbackMessage?: string
  errorMessage?: string
  showDiscardHint?: boolean
  onStop: () => void
  onCancel: () => void
  onUndo: () => void
  onExited: () => void
}

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

/**
 * Elapsed-recording timer, isolated in a memoized leaf so its 1s interval
 * re-renders ONLY this text node — never the pill subtree (v1 bug C4).
 * Mounted fresh for each recording, so it always starts at 0:00.
 */
const ElapsedTimer = memo(function ElapsedTimer(): ReactNode {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const remaining = MAX_DURATION_S - elapsed
  const warn = remaining <= WARN_THRESHOLD_S
  return (
    <span
      role="timer"
      aria-label="Recording time"
      className={`hud-timer ${warn ? 'hud-timer--warn' : ''}`}
    >
      {warn ? `-${formatTime(remaining)}` : formatTime(elapsed)}
    </span>
  )
})

/**
 * Maverick Voice HUD — ONE persistent liquid-glass pill (DESIGN.md §4) that
 * morphs through recording/processing/output/fallback/error/too-short/
 * cancelled on the same DOM node. Presentational only; WidgetApp drives the
 * state machine, main owns visibility timing (auto-hide) via HUD_HIDE.
 *
 * Exit FSM: the exit flag is cleared on re-entry, so v1's stuck-exit flicker
 * (C3) cannot recur; onExited → HUD_EXIT_DONE replaces the 220ms magic timer.
 */
export default function Widget({
  state,
  mode,
  appName,
  analyserNode,
  fallbackMessage,
  errorMessage,
  showDiscardHint = false,
  onStop,
  onCancel,
  onUndo,
  onExited
}: WidgetProps): ReactNode {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last non-hidden state — the pill keeps rendering it during the exit anim.
  const lastShownRef = useRef<ShownState>('recording')
  if (state !== 'hidden') lastShownRef.current = state

  useEffect(() => {
    if (state === 'hidden') {
      if (!visible) return
      setExiting(true)
      exitTimer.current = setTimeout(() => {
        setVisible(false)
        setExiting(false)
        onExited()
      }, EXIT_MS)
    } else {
      // Re-entry always clears any in-flight exit.
      if (exitTimer.current) clearTimeout(exitTimer.current)
      exitTimer.current = null
      setExiting(false)
      setVisible(true)
    }
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!visible) return null

  const shown = lastShownRef.current
  const isInstruction = mode === 'instruction'
  const chip = appName ? (appName.length > 18 ? `${appName.slice(0, 18)}…` : appName) : null

  return (
    <div className="hud-root">
      <div
        role="status"
        aria-live="polite"
        className={`glass-pill hud-pill hud-pill--${shown} ${exiting ? 'hud-pill--exit' : 'hud-pill--enter'}`}
      >
        {/* Content wrapper is keyed so the crossfade/shake restarts per state;
            the PILL node itself persists — no per-state pill swaps (v1 C4). */}
        <div className={`hud-content hud-content--${shown}`} key={shown}>
          {shown === 'recording' && (
            <>
              <span className="hud-dot-wrap" aria-hidden="true">
                <span className={`hud-ring ${isInstruction ? 'hud-ring--bright' : ''}`} />
                <span className="hud-dot" />
              </span>
              <span className="hud-label">
                {isInstruction ? 'Instructing' : 'Listening'}
                {chip && <span className="hud-chip"> · {chip}</span>}
              </span>
              <Waveform analyserNode={analyserNode} width={84} height={22} />
              <ElapsedTimer />
              <button type="button" className="hud-stop" onClick={onStop} aria-label="Stop recording">
                <span className="hud-stop-icon" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="hud-esc"
                onClick={onCancel}
                aria-label="Cancel recording (Escape)"
                title="Cancel (Esc)"
              >
                esc
              </button>
            </>
          )}

          {shown === 'processing' && (
            <>
              <span className="hud-shimmer" aria-hidden="true">
                <span className="hud-shimmer-sweep" />
              </span>
              <span className="hud-label">Thinking…</span>
              {showDiscardHint && <span className="hud-hint">Esc to discard</span>}
            </>
          )}

          {shown === 'output' && (
            <span className="hud-check" aria-label="Pasted">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--ink-strong)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}

          {shown === 'fallback' && (
            <>
              <span className="hud-glyph" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <span className="hud-notice">
                <span className="hud-notice-text">{fallbackMessage || 'Pasted without formatting'}</span>
                <span className="hud-notice-sub">Retry from History</span>
              </span>
            </>
          )}

          {shown === 'error' && (
            <>
              <span className="hud-glyph" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
              <span className="hud-notice">
                <span className="hud-notice-text">{errorMessage || 'Something went wrong'}</span>
                <span className="hud-notice-sub">Retry from History</span>
              </span>
            </>
          )}

          {shown === 'too-short' && <span className="hud-muted">Didn&apos;t catch that</span>}

          {shown === 'cancelled' && (
            <>
              <span className="hud-muted">Cancelled</span>
              <button type="button" className="hud-undo" onClick={onUndo} aria-label="Undo cancel">
                Undo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
