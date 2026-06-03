import { useState, useEffect, useRef } from 'react'
import type { WidgetState } from '../../shared/types'
import Waveform from './Waveform'

interface WidgetProps {
  state: WidgetState
  analyserNode: AnalyserNode | null
  maxDurationSeconds?: number
  outputPreview?: string
  fallbackMessage?: string
  errorMessage?: string
  showDiscardHint?: boolean
  engineNotice?: string | null
  onCancel: () => void
  onStop: () => void
  onUndo: () => void
}

/**
 * Maverick Voice HUD — liquid-glass pill, pure black glass, monochrome.
 *
 * Presentational only. WidgetApp drives the WidgetState machine; this component
 * renders every case and owns the elapsed timer + entry/exit animation. The
 * 200ms exit matches windowManager.hideHUD's 220ms setTimeout so the panel is
 * gone before it is hidden at the OS level.
 *
 * State -> visual:
 *   dictation-active   -> "Listening"   (dim radiate, live waveform)
 *   instruction-active -> "Instructing" (bright radiate, live waveform)
 *   chained            -> "Instructing" (bright radiate, live waveform)
 *   processing         -> "Thinking"    (shimmer sweep + bouncing dots)
 *   output             -> near-white success check (output flash)
 *   output-fallback    -> success pop + raw-paste notice + preview
 *   error              -> shake + monochrome error glyph
 *   too-short          -> muted "Didn't catch that"
 *   cancelled          -> "Cancelled" + Undo
 */
export default function Widget({
  state,
  analyserNode,
  maxDurationSeconds = 300,
  outputPreview,
  fallbackMessage,
  errorMessage,
  showDiscardHint = false,
  engineNotice = null,
  onStop,
  onUndo
}: WidgetProps) {
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [exiting, setExiting] = useState(false)
  const prevStateRef = useRef<WidgetState>('hidden')

  const isRecording =
    state === 'dictation-active' || state === 'instruction-active' || state === 'chained'

  const isDictation = state === 'dictation-active'
  const isInstruction = state === 'instruction-active' || state === 'chained'

  // Entry/Exit animation — track the hidden<->visible edge so we can play the
  // 200ms exit before unmounting.
  useEffect(() => {
    const wasHidden = prevStateRef.current === 'hidden'
    const isNowHidden = state === 'hidden'

    if (!wasHidden && isNowHidden) {
      setExiting(true)
      const timeout = setTimeout(() => setExiting(false), 200)
      prevStateRef.current = state
      return () => clearTimeout(timeout)
    }
    prevStateRef.current = state
  }, [state])

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRecording])

  function formatTime(s: number): string {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  if (state === 'hidden' && !exiting) return null

  const MAX_DURATION = maxDurationSeconds
  const WARN_THRESHOLD = 30
  const timeRemaining = MAX_DURATION - elapsed
  const isNearLimit = isRecording && timeRemaining <= WARN_THRESHOLD

  const modeLabel = isDictation ? 'Listening' : 'Instructing'
  const recordGlowClass = isDictation ? 'animate-radiate-dim' : 'animate-radiate-bright'
  // Dictation dot dim, instruction dot bright (white-alpha intensities only).
  const dotOpacity = isDictation ? 0.55 : 0.95
  // Waveform brightness mirrors the mode (instruction louder/brighter).
  const waveColor = isDictation ? 'rgba(255, 255, 255, 0.62)' : 'rgba(255, 255, 255, 0.92)'

  return (
    <div className={exiting ? 'animate-hud-exit' : 'animate-hud-enter'}>
      {/* Component-scoped structural + motion styles. tokens.css owns the shared
          materials/keyframes; these are HUD-pill-only layout rules plus the
          error shake + shimmer sweep that the shared sheet does not define.
          All values are monochrome white/black-alpha. */}
      <style>{mvWidgetCss}</style>

      {/* ══════ RECORDING (pill) — live waveform + mode label ══════ */}
      {isRecording && (
        <div className={`mv-glass-widget mv-pill ${recordGlowClass}`} data-mode={isInstruction ? 'instruction' : 'dictation'}>
          <span className="mv-pill-dot animate-dot-pulse" style={{ opacity: dotOpacity }} />
          <span className="mv-pill-label">{modeLabel}</span>
          <span className="mv-pill-wave">
            <Waveform analyserNode={analyserNode} color={waveColor} width={84} height={22} />
          </span>
          <span className={`mv-pill-timer ${isNearLimit ? 'mv-pill-timer--warn' : ''}`}>
            {isNearLimit ? `-${formatTime(timeRemaining)}` : formatTime(elapsed)}
          </span>
          <button className="mv-pill-stop" onClick={onStop} aria-label="Stop recording" type="button">
            <span className="mv-pill-stop-icon" />
          </button>
        </div>
      )}

      {/* ══════ PROCESSING (pill) — "Thinking" shimmer sweep ══════ */}
      {state === 'processing' && (
        <div className="mv-glass-widget mv-pill mv-pill--processing animate-radiate-processing">
          <span className="mv-pill-shimmer" aria-hidden="true">
            <span className="mv-pill-shimmer-sweep animate-shimmer-bar" />
          </span>
          <span className="mv-pill-label">Thinking</span>
          <span className="mv-pill-dots">
            <span className="animate-dot-bounce" />
            <span className="animate-dot-bounce" style={{ animationDelay: '0.18s' }} />
            <span className="animate-dot-bounce" style={{ animationDelay: '0.36s' }} />
          </span>
          {engineNotice ? (
            <span className="mv-pill-helper animate-fade-up-in">{engineNotice}</span>
          ) : (
            showDiscardHint && <span className="mv-pill-helper animate-fade-up-in">Esc to discard</span>
          )}
        </div>
      )}

      {/* ══════ OUTPUT — silent success ack (text already at the cursor) ══════ */}
      {state === 'output' && (
        <div className="mv-glass-widget mv-pill mv-pill--ack animate-success-pop animate-output-flash">
          <span className="mv-pill-check">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--mv-success)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        </div>
      )}

      {/* ══════ OUTPUT FALLBACK (pill) — raw transcript pasted ══════ */}
      {state === 'output-fallback' && (
        <div className="mv-glass-widget mv-pill mv-pill--fallback animate-success-pop">
          <span className="mv-pill-glyph">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--mv-warning)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <span className="mv-pill-fallback-text">{fallbackMessage || 'Formatting unavailable — pasted raw'}</span>
          <span className="mv-pill-output-text">{outputPreview}</span>
        </div>
      )}

      {/* ══════ ERROR (pill) — shake ══════ */}
      {state === 'error' && (
        <div className="mv-glass-widget mv-pill mv-pill--error mv-shake">
          <span className="mv-pill-glyph">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--mv-error)"
              strokeWidth="2.6"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
          <span className="mv-pill-error-content">
            <span className="mv-pill-error-text">{errorMessage || 'Something went wrong'}</span>
            {!errorMessage?.includes('limit reached') && (
              <span className="mv-pill-error-hint">Retry from History to regenerate</span>
            )}
          </span>
        </div>
      )}

      {/* ══════ NOTHING CAPTURED — too short or silent (no API call) ══════ */}
      {state === 'too-short' && (
        <div className="mv-glass-widget mv-pill mv-pill--muted animate-fade-up-in">
          <span className="mv-pill-muted-text">Didn&apos;t catch that</span>
        </div>
      )}

      {/* ══════ CANCELLED (pill) ══════ */}
      {state === 'cancelled' && (
        <div className="mv-glass-widget mv-pill animate-fade-up-in">
          <span className="mv-pill-cancel-text">Cancelled</span>
          <button className="mv-pill-undo animate-undo-appear" onClick={onUndo} type="button">
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   HUD-pill-only CSS. Scoped to the widget so it never depends on the (separately
   owned) renderer/styles.css. Materials + shared keyframes come from tokens.css;
   only pill layout + the error-shake/shimmer-sweep specifics live here.
   Strictly monochrome: white-alpha + black-alpha only.
──────────────────────────────────────────────────────────────────────────── */
const mvWidgetCss = `
.mv-pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 8px 0 16px;
  max-width: 460px;
  font-family: var(--mv-font-primary);
  color: var(--mv-text-primary);
  overflow: hidden;
  white-space: nowrap;
}

/* status dot */
.mv-pill-dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 9999px;
  background: var(--mv-white);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.35);
}

/* mode label — "Listening" / "Instructing" / "Thinking" */
.mv-pill-label {
  flex: none;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--mv-text-primary);
}

/* live waveform slot */
.mv-pill-wave {
  display: inline-flex;
  align-items: center;
  height: 22px;
  margin: 0 2px;
}

/* elapsed / countdown timer */
.mv-pill-timer {
  flex: none;
  min-width: 38px;
  font-family: var(--mv-font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--mv-text-secondary);
  text-align: right;
}
.mv-pill-timer--warn {
  color: var(--mv-text-primary);
  animation: mv-blink-cursor 1s step-end infinite;
}

/* 3D stop button — square glass cap */
.mv-pill-stop {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-left: 2px;
  border: 1px solid var(--mv-border);
  border-radius: 9px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 100%),
    rgba(0, 0, 0, 0.4);
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.45),
    0 1px 0 rgba(255, 255, 255, 0.15) inset,
    0 -1px 0 rgba(0, 0, 0, 0.40) inset;
  cursor: pointer;
  transition:
    transform var(--mv-dur-fast) var(--mv-ease-out),
    box-shadow var(--mv-dur-fast) var(--mv-ease-out),
    background var(--mv-dur-fast) var(--mv-ease-out);
}
.mv-pill-stop:hover {
  transform: translateY(-1px);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.04) 100%),
    rgba(0, 0, 0, 0.4);
}
.mv-pill-stop:active {
  transform: translateY(1px);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.45),
    0 1px 0 rgba(255, 255, 255, 0.10) inset;
}
.mv-pill-stop-icon {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--mv-white);
}

/* ── processing ── */
.mv-pill--processing {
  padding-right: 18px;
  position: relative;
}
/* shimmer sweep — white-alpha gradient gliding across the pill */
.mv-pill-shimmer {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}
.mv-pill-shimmer-sweep {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0) 30%,
    rgba(255, 255, 255, 0.10) 50%,
    rgba(255, 255, 255, 0) 70%
  );
  background-size: 200% 100%;
}
.mv-pill-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mv-pill-dots > span {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--mv-text-secondary);
}
.mv-pill-helper {
  font-size: 11px;
  color: var(--mv-text-muted);
  margin-left: 4px;
}

/* ── output ack ── */
.mv-pill--ack {
  padding: 0 16px;
  gap: 0;
}
.mv-pill-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.10) inset;
}

/* ── fallback ── */
.mv-pill--fallback {
  gap: 8px;
}
.mv-pill-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mv-pill-fallback-text {
  flex: none;
  font-size: 12px;
  color: var(--mv-text-secondary);
}
.mv-pill-output-text {
  font-size: 12px;
  color: var(--mv-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── error ── */
.mv-pill--error {
  gap: 9px;
  border-color: var(--mv-border-focus);
}
.mv-pill-error-content {
  display: inline-flex;
  flex-direction: column;
  line-height: 1.25;
  overflow: hidden;
}
.mv-pill-error-text {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--mv-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}
.mv-pill-error-hint {
  font-size: 10.5px;
  color: var(--mv-text-muted);
}

/* ── too-short / muted ── */
.mv-pill--muted {
  padding: 0 18px;
}
.mv-pill-muted-text {
  font-size: 12.5px;
  color: var(--mv-text-muted);
}

/* ── cancelled ── */
.mv-pill-cancel-text {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--mv-text-secondary);
  padding-left: 4px;
}
.mv-pill-undo {
  flex: none;
  padding: 5px 14px;
  margin-left: 2px;
  font-family: var(--mv-font-primary);
  font-size: 12px;
  font-weight: 600;
  color: var(--mv-black);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.82) 100%);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 9999px;
  box-shadow:
    0 3px 10px rgba(0, 0, 0, 0.45),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
  cursor: pointer;
  transition:
    transform var(--mv-dur-fast) var(--mv-ease-out),
    background var(--mv-dur-fast) var(--mv-ease-out);
}
.mv-pill-undo:hover {
  transform: translateY(-1px);
  background: linear-gradient(180deg, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.88) 100%);
}
.mv-pill-undo:active {
  transform: translateY(1px);
}

/* ── error shake (tokens.css does not define this) ── */
@keyframes mv-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-5px); }
  30% { transform: translateX(4px); }
  45% { transform: translateX(-3px); }
  60% { transform: translateX(2px); }
  75% { transform: translateX(-1px); }
}
.mv-shake {
  animation: mv-shake 420ms var(--mv-ease-out) 1;
}
`
