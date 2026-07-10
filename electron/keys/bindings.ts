// ════════════════════════════════════════════════════════════════════════
// keys/bindings.ts — single owner of binding + activation state.
// The activation/chain/debounce FSM, ported VERBATIM from
// legacy/electron/keyboard.ts. Platform-agnostic: consumes normalized
// KeyEvents from keys/listener.ts, emits 'action' events for the session fsm.
// Modes: tap-toggle | push-to-talk | double-tap-push. Chaining is "direct"
// (other key pressed while a session is active); same-mode re-press expires
// the chain and processes immediately.
// ════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events'
import type { ActivationMode, DictationBinding, SessionMode } from '../../shared/types'
import { keyListener, KeyEvent } from './listener'

export type KeyAction =
  | { type: 'session-start'; mode: SessionMode }
  | { type: 'session-stop'; mode: SessionMode }
  | { type: 'chain-start'; mode: SessionMode }
  | { type: 'chain-expired' }
  | { type: 'cancel' }

// Tuned v1 constants — do not "tidy".
const DEBOUNCE_MS = 300 // gates START only, never STOP
// Ported verbatim; latent in v1's final chain design (chaining is direct-only,
// stop emits chain-expired immediately — nothing arms the timed window).
export const CHAIN_WINDOW_MS = 2_000
const DUAL_HOLD_MS = 400
const DUAL_DOUBLE_TAP_MS = 400

type DualModeState = 'idle' | 'held' | 'awaiting-second' | 'push-recording' | 'hands-free'

class KeyBindings extends EventEmitter {
  private dictationActive = false
  private instructionActive = false
  private chainTimer: NodeJS.Timeout | null = null
  // Separate debounce per logical key so the dictation key and the instruction
  // key can't cross-block each other.
  private lastDictationToggleTime = 0
  private lastInstructionToggleTime = 0

  private binding: DictationBinding = { type: 'key', key: process.platform === 'darwin' ? 'fn' : 'right-ctrl' }
  private activationMode: ActivationMode = 'tap-toggle'

  // Instruction mode is OPT-IN (default OFF). When false, every instruction-
  // derived event is ignored — including the dictation→instruction chain
  // transition. Persisted setting: NOT cleared by resetState().
  private instructionEnabled = false

  // Double-tap-push (dual mode) state
  private dualState: DualModeState = 'idle'
  private dualHoldTimer: NodeJS.Timeout | null = null
  private dualDoubleTapTimer: NodeJS.Timeout | null = null

  // Chain tracking
  private _chainPending = false
  private _chainMode: SessionMode | null = null

  constructor() {
    super()
    keyListener.on('key', (event: KeyEvent) => this.handleKey(event))
  }

  // ── Binding (ONE source of truth; pushes to keyListener) ────────────────

  getBinding(): DictationBinding {
    return this.binding
  }

  setBinding(binding: DictationBinding): void {
    this.binding = binding
    keyListener.setBinding(binding)
  }

  getInstructionEnabled(): boolean {
    return this.instructionEnabled
  }

  /** Persisted — resetState() must NOT clear it. Dropping a live
   *  instructionActive on disable prevents chain misrouting. */
  setInstructionEnabled(enabled: boolean): void {
    console.log('[bindings] Instruction mode enabled:', enabled)
    this.instructionEnabled = enabled
    if (!enabled && this.instructionActive) {
      this.instructionActive = false
    }
  }

  getActivationMode(): ActivationMode {
    return this.activationMode
  }

  setActivationMode(mode: ActivationMode): void {
    console.log('[bindings] Activation mode set to:', mode)
    this.activationMode = mode
    // Reset dual-tap state when switching modes
    this.clearDualTimers()
    this.dualState = 'idle'
  }

  /** Reset ALL per-keystroke routing state (session ended externally).
   *  Everything influencing the next keystroke resets here — EXCEPT the
   *  persisted instructionEnabled/activationMode/binding settings. */
  resetState(): void {
    console.log('[bindings] State RESET (was dictation:', this.dictationActive, 'instruction:', this.instructionActive, ')')
    this.dictationActive = false
    this.instructionActive = false
    this.lastDictationToggleTime = 0
    this.lastInstructionToggleTime = 0
    this.clearChainTimer()
    this._chainPending = false
    this._chainMode = null
    this.clearDualTimers()
    this.dualState = 'idle'
  }

  // ── Normalized key-event entry point ─────────────────────────────────────

  handleKey(event: KeyEvent): void {
    console.log('[bindings] Key event:', event, '| dictation:', this.dictationActive, '| instruction:', this.instructionActive)
    switch (event) {
      case 'dictation-down':
        this.handleDictationKeyDown()
        break
      case 'dictation-up':
        this.handleDictationKeyUp()
        break
      case 'instruction-down':
        // Instruction mode is opt-in — when disabled, ignore ALL instruction
        // key events (dictation + Escape are unaffected).
        if (!this.instructionEnabled) {
          console.log('[bindings] Instruction key ignored — instruction mode disabled')
          break
        }
        // Caps Lock triggers on DOWN only (darwin LED-pair collapsed by the
        // listener; win32/linux auto-repeat swallowed).
        this.handleInstructionToggle()
        break
      case 'escape-down':
        this.emitAction({ type: 'cancel' })
        break
      case 'escape-up':
        // No-op — cancel fires on down.
        break
    }
  }

  // ── Dictation key-down/up dispatchers ────────────────────────────────────

  private handleDictationKeyDown(): void {
    switch (this.activationMode) {
      case 'tap-toggle':
        this.handleTapToggleDown()
        break
      case 'push-to-talk':
        this.handlePushToTalkDown()
        break
      case 'double-tap-push':
        this.handleDualModeDown()
        break
    }
  }

  private handleDictationKeyUp(): void {
    switch (this.activationMode) {
      case 'tap-toggle':
        // Tap-toggle ignores key-up
        break
      case 'push-to-talk':
        this.handlePushToTalkUp()
        break
      case 'double-tap-push':
        this.handleDualModeUp()
        break
    }
  }

  // ── Tap-toggle mode ──────────────────────────────────────────────────────

  private handleTapToggleDown(): void {
    const now = Date.now()
    // Debounce gates START only — a stop must always go through.
    if (!this.dictationActive && now - this.lastDictationToggleTime < DEBOUNCE_MS) {
      console.log('[bindings] Dictation toggle DEBOUNCED (too fast)')
      return
    }
    this.lastDictationToggleTime = now

    if (this.dictationActive) {
      this.stopDictation()
    } else {
      this.startDictation()
    }
  }

  // ── Push-to-talk mode ────────────────────────────────────────────────────

  private handlePushToTalkDown(): void {
    const now = Date.now()
    if (this.dictationActive) return
    if (now - this.lastDictationToggleTime < DEBOUNCE_MS) {
      console.log('[bindings] Push-to-talk DEBOUNCED (too fast)')
      return
    }
    this.lastDictationToggleTime = now
    this.startDictation()
  }

  private handlePushToTalkUp(): void {
    if (this.dictationActive) {
      this.stopDictation()
    }
  }

  // ── Double-tap-push (dual) mode state machine ────────────────────────────

  private handleDualModeDown(): void {
    const now = Date.now()

    switch (this.dualState) {
      case 'idle': {
        if (now - this.lastDictationToggleTime < DEBOUNCE_MS) {
          console.log('[bindings] Dual mode DEBOUNCED (too fast)')
          return
        }
        this.lastDictationToggleTime = now
        this.dualState = 'held'
        console.log('[bindings] Dual mode: idle → held')
        this.dualHoldTimer = setTimeout(() => {
          this.dualHoldTimer = null
          if (this.dualState === 'held') {
            this.dualState = 'push-recording'
            console.log('[bindings] Dual mode: held → push-recording (hold expired, starting dictation)')
            this.startDictation()
          }
        }, DUAL_HOLD_MS)
        break
      }
      case 'awaiting-second': {
        this.clearDualTimers()
        this.dualState = 'hands-free'
        console.log('[bindings] Dual mode: awaiting-second → hands-free (double-tap, starting dictation)')
        this.startDictation()
        break
      }
      case 'hands-free': {
        console.log('[bindings] Dual mode: hands-free → idle (tap to stop)')
        this.dualState = 'idle'
        this.stopDictation()
        break
      }
      default:
        break
    }
  }

  private handleDualModeUp(): void {
    switch (this.dualState) {
      case 'held': {
        this.clearDualTimers()
        this.dualState = 'awaiting-second'
        console.log('[bindings] Dual mode: held → awaiting-second')
        this.dualDoubleTapTimer = setTimeout(() => {
          this.dualDoubleTapTimer = null
          if (this.dualState === 'awaiting-second') {
            console.log('[bindings] Dual mode: awaiting-second → idle (double-tap window expired)')
            this.dualState = 'idle'
          }
        }, DUAL_DOUBLE_TAP_MS)
        break
      }
      case 'push-recording': {
        console.log('[bindings] Dual mode: push-recording → idle (released, stopping dictation)')
        this.dualState = 'idle'
        this.stopDictation()
        break
      }
      case 'hands-free':
        break
      default:
        break
    }
  }

  private clearDualTimers(): void {
    if (this.dualHoldTimer) {
      clearTimeout(this.dualHoldTimer)
      this.dualHoldTimer = null
    }
    if (this.dualDoubleTapTimer) {
      clearTimeout(this.dualDoubleTapTimer)
      this.dualDoubleTapTimer = null
    }
  }

  // ── Shared dictation start/stop helpers ──────────────────────────────────

  private startDictation(): void {
    if (this.instructionActive) {
      this.instructionActive = false
      console.log('[bindings] Instruction STOPPED (direct chain to dictation)')
      this.emitAction({ type: 'session-stop', mode: 'instruction' })

      this.dictationActive = true
      console.log('[bindings] Dictation CHAIN-START (direct)')
      this.emitAction({ type: 'chain-start', mode: 'dictation' })
      return
    }

    this.clearChainTimer()

    const chainResult = this.wasChainPending('dictation')
    if (chainResult === 'chain') {
      this.dictationActive = true
      console.log('[bindings] Dictation CHAIN-START')
      this.emitAction({ type: 'chain-start', mode: 'dictation' })
    } else if (chainResult === 'same-mode-restart') {
      console.log('[bindings] Same-mode re-press — expiring chain immediately (process now)')
      this.emitAction({ type: 'chain-expired' })
    } else {
      this.dictationActive = true
      console.log('[bindings] Dictation SESSION-START')
      this.emitAction({ type: 'session-start', mode: 'dictation' })
    }
  }

  private stopDictation(): void {
    this.dictationActive = false
    console.log('[bindings] Dictation STOPPED')
    this.emitAction({ type: 'session-stop', mode: 'dictation' })
    console.log('[bindings] Dictation done — processing immediately (no chain wait)')
    this.emitAction({ type: 'chain-expired' })
  }

  // ── Instruction toggle (Caps Lock) ───────────────────────────────────────

  private handleInstructionToggle(): void {
    const now = Date.now()
    if (now - this.lastInstructionToggleTime < DEBOUNCE_MS) {
      console.log('[bindings] Instruction toggle DEBOUNCED (too fast)')
      return
    }
    this.lastInstructionToggleTime = now

    if (this.instructionActive) {
      this.instructionActive = false
      console.log('[bindings] Instruction STOPPED')
      this.emitAction({ type: 'session-stop', mode: 'instruction' })
      console.log('[bindings] Instruction done — processing immediately (no chain wait)')
      this.emitAction({ type: 'chain-expired' })
      return
    }

    if (this.dictationActive) {
      this.dictationActive = false
      console.log('[bindings] Dictation STOPPED (direct chain to instruction)')
      this.emitAction({ type: 'session-stop', mode: 'dictation' })

      this.instructionActive = true
      console.log('[bindings] Instruction CHAIN-START (direct)')
      this.emitAction({ type: 'chain-start', mode: 'instruction' })
      return
    }

    this.clearChainTimer()

    const chainResult = this.wasChainPending('instruction')
    if (chainResult === 'chain') {
      this.instructionActive = true
      console.log('[bindings] Instruction CHAIN-START')
      this.emitAction({ type: 'chain-start', mode: 'instruction' })
    } else if (chainResult === 'same-mode-restart') {
      console.log('[bindings] Same-mode re-press — expiring chain immediately (process now)')
      this.emitAction({ type: 'chain-expired' })
    } else {
      this.instructionActive = true
      console.log('[bindings] Instruction SESSION-START')
      this.emitAction({ type: 'session-start', mode: 'instruction' })
    }
  }

  // ── Chain window ─────────────────────────────────────────────────────────

  private clearChainTimer(): void {
    if (this.chainTimer) {
      clearTimeout(this.chainTimer)
      this.chainTimer = null
    }
  }

  /** 'none' = fresh session; 'chain' = cross-mode chain into same session;
   *  'same-mode-restart' = process old, start new. */
  private wasChainPending(newMode: SessionMode): 'none' | 'chain' | 'same-mode-restart' {
    const was = this._chainPending
    const prevMode = this._chainMode
    this._chainPending = false
    this._chainMode = null

    if (!was) return 'none'

    if (prevMode === newMode) {
      console.log('[bindings] Same-mode re-press during chain window (', newMode, '→', newMode, ')')
      return 'same-mode-restart'
    }

    return 'chain'
  }

  private emitAction(action: KeyAction): void {
    this.emit('action', action)
  }
}

export const keyBindings = new KeyBindings()
