// ════════════════════════════════════════════════════════════════════════
// electron/keyboard.ts — the activation-mode + chaining + debounce state
// machine. PLATFORM-AGNOSTIC: it consumes the normalized KeyEvent strings
// emitted by keyListener.ts ('dictation-down/up', 'instruction-down/up') and
// is completely unaware of the physical key behind them.
//
// Activation modes: tap-toggle | push-to-talk | double-tap-push.
// Chaining: dictation ↔ instruction within a chain window; same-mode re-press
// expires the chain and processes immediately.
// ════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events'
import type { SessionMode, ActivationMode, DictationKey, InstructionKey } from '../shared/types'
import { keyListener, KeyEvent } from './keyListener'

export type KeyboardEvent =
  | { type: 'session-start'; mode: SessionMode }
  | { type: 'session-stop'; mode: SessionMode }
  | { type: 'chain-start'; mode: SessionMode }
  | { type: 'chain-expired' }

// Double-tap-push state machine states
type DualModeState = 'idle' | 'held' | 'awaiting-second' | 'push-recording' | 'hands-free'

class KeyboardManager extends EventEmitter {
  private dictationActive = false
  private instructionActive = false
  private chainTimer: NodeJS.Timeout | null = null
  private chainWindowMs = 2000
  // Separate debounce per logical key so the dictation key and the instruction
  // key can't cross-block each other.
  private lastDictationToggleTime = 0
  private lastInstructionToggleTime = 0
  private readonly DEBOUNCE_MS = 300

  // ─── Configurable keys + activation mode ───
  private dictationKey: DictationKey = process.platform === 'darwin' ? 'fn' : 'right-ctrl'
  private instructionKey: InstructionKey = 'caps-lock'
  private activationMode: ActivationMode = 'tap-toggle'

  // Instruction mode is OPT-IN (default OFF). When false, every instruction-key
  // event is ignored — including a dictation→instruction chain transition — so
  // the user never accidentally enters edit-selected-text mode. Persisted
  // setting: NOT cleared by resetState() (which only clears per-keystroke
  // routing state). main.ts applies it at boot and on the live IPC setter.
  private instructionEnabled = false

  // Double-tap-push (dual mode) state
  private dualState: DualModeState = 'idle'
  private dualHoldTimer: NodeJS.Timeout | null = null
  private dualDoubleTapTimer: NodeJS.Timeout | null = null
  private readonly DUAL_HOLD_MS = 400
  private readonly DUAL_DOUBLE_TAP_MS = 400

  // Chain tracking
  private _chainPending = false
  private _chainMode: SessionMode | null = null

  start(): void {
    keyListener.on('key', (event: KeyEvent) => this.handleKey(event))
    const started = keyListener.start()
    if (started) {
      console.log('[keyboard] Key listener started')
    } else {
      console.warn('[keyboard] Key listener failed to start — hotkeys will not work')
    }
  }

  stop(): void {
    this.clearChainTimer()
    this.clearDualTimers()
    keyListener.stop()
  }

  /** Reset ALL routing state — call when session ends externally (cancel, processing complete, etc.).
   *  Every mutable variable that influences the next keystroke MUST be reset here. */
  resetState(): void {
    console.log(
      '[keyboard] State RESET (was dictationActive:',
      this.dictationActive,
      'instructionActive:',
      this.instructionActive,
      ')'
    )
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

  setChainWindow(ms: number): void {
    this.chainWindowMs = ms
  }

  setDictationKey(key: DictationKey): void {
    console.log('[keyboard] Dictation key set to:', key)
    this.dictationKey = key
  }

  getDictationKey(): DictationKey {
    return this.dictationKey
  }

  setInstructionKey(key: InstructionKey): void {
    console.log('[keyboard] Instruction key set to:', key)
    this.instructionKey = key
  }

  getInstructionKey(): InstructionKey {
    return this.instructionKey
  }

  /**
   * Toggle whether instruction (edit-selected-text) key events are honored.
   * When false, handleKey ignores ALL instruction-derived events and the
   * dictation→instruction chain transition is suppressed (dictation and Escape
   * are unaffected). This is a persisted setting — resetState() must NOT clear
   * it. Reset routing state on change so a half-formed instruction transition
   * can't survive the toggle flip.
   */
  setInstructionEnabled(enabled: boolean): void {
    console.log('[keyboard] Instruction mode enabled:', enabled)
    this.instructionEnabled = enabled
    if (!enabled && this.instructionActive) {
      // Flipped off mid-instruction (edge case) — drop the active flag so the
      // next dictation press isn't misrouted as a chain.
      this.instructionActive = false
    }
  }

  getInstructionEnabled(): boolean {
    return this.instructionEnabled
  }

  setActivationMode(mode: ActivationMode): void {
    console.log('[keyboard] Activation mode set to:', mode)
    this.activationMode = mode
    // Reset dual-mode state when switching modes
    this.clearDualTimers()
    this.dualState = 'idle'
  }

  getActivationMode(): ActivationMode {
    return this.activationMode
  }

  /**
   * Stop the currently-active recording the same way a hotkey release/re-press
   * would — used by the HUD Stop button so a manual click drives the identical
   * canonical path (session-stop → chain-expired → processSession) AND leaves
   * the toggle state consistent. No-op when nothing is recording.
   *
   * Routes through the existing private stop helpers so the state machine stays
   * authoritative; it does not introduce a parallel stop path. Returns true if
   * an active session was stopped, false if there was nothing recording (the
   * caller can then fall back to driving sessionManager directly).
   */
  stopActiveSession(): boolean {
    if (this.dictationActive) {
      console.log('[keyboard] HUD Stop — stopping active DICTATION')
      this.clearChainTimer()
      this.clearDualTimers()
      this.dualState = 'idle'
      this.stopDictation()
      return true
    }
    if (this.instructionActive) {
      console.log('[keyboard] HUD Stop — stopping active INSTRUCTION')
      this.clearChainTimer()
      this.instructionActive = false
      this.emit('keyboard', { type: 'session-stop', mode: 'instruction' } as KeyboardEvent)
      this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
      return true
    }
    console.log('[keyboard] HUD Stop — no active keyboard session to stop')
    return false
  }

  handleKey(event: KeyEvent): void {
    console.log(
      '[keyboard] Key event:',
      event,
      '| dictationActive:',
      this.dictationActive,
      '| instructionActive:',
      this.instructionActive
    )
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
          console.log('[keyboard] Instruction key ignored — instruction mode disabled')
          break
        }
        // The instruction key (Right Shift = momentary; Caps Lock LED-toggle
        // collapsed to a single 'instruction-down' by keyListener) triggers on
        // DOWN only.
        this.handleInstructionToggle()
        break
      case 'instruction-up':
        // Right Shift is momentary — ignore the release; the toggle already
        // happened on 'instruction-down'. (Also ignored when instruction mode
        // is disabled.)
        break
    }
  }

  // ─── Dictation key-down/up dispatchers ───

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

  // ─── Tap-toggle mode ───

  private handleTapToggleDown(): void {
    const now = Date.now()
    if (!this.dictationActive && now - this.lastDictationToggleTime < this.DEBOUNCE_MS) {
      console.log('[keyboard] Dictation toggle DEBOUNCED (too fast)')
      return
    }
    this.lastDictationToggleTime = now

    if (this.dictationActive) {
      this.stopDictation()
    } else {
      this.startDictation()
    }
  }

  // ─── Push-to-talk mode ───

  private handlePushToTalkDown(): void {
    const now = Date.now()
    if (this.dictationActive) return
    if (now - this.lastDictationToggleTime < this.DEBOUNCE_MS) {
      console.log('[keyboard] Push-to-talk DEBOUNCED (too fast)')
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

  // ─── Double-tap-push (dual) mode state machine ───

  private handleDualModeDown(): void {
    const now = Date.now()

    switch (this.dualState) {
      case 'idle': {
        if (now - this.lastDictationToggleTime < this.DEBOUNCE_MS) {
          console.log('[keyboard] Dual mode DEBOUNCED (too fast)')
          return
        }
        this.lastDictationToggleTime = now
        this.dualState = 'held'
        console.log('[keyboard] Dual mode: idle → held')
        this.dualHoldTimer = setTimeout(() => {
          this.dualHoldTimer = null
          if (this.dualState === 'held') {
            this.dualState = 'push-recording'
            console.log('[keyboard] Dual mode: held → push-recording (hold expired, starting dictation)')
            this.startDictation()
          }
        }, this.DUAL_HOLD_MS)
        break
      }
      case 'awaiting-second': {
        this.clearDualTimers()
        this.dualState = 'hands-free'
        console.log('[keyboard] Dual mode: awaiting-second → hands-free (double-tap, starting dictation)')
        this.startDictation()
        break
      }
      case 'hands-free': {
        console.log('[keyboard] Dual mode: hands-free → idle (tap to stop)')
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
        console.log('[keyboard] Dual mode: held → awaiting-second')
        this.dualDoubleTapTimer = setTimeout(() => {
          this.dualDoubleTapTimer = null
          if (this.dualState === 'awaiting-second') {
            console.log('[keyboard] Dual mode: awaiting-second → idle (double-tap window expired)')
            this.dualState = 'idle'
          }
        }, this.DUAL_DOUBLE_TAP_MS)
        break
      }
      case 'push-recording': {
        console.log('[keyboard] Dual mode: push-recording → idle (released, stopping dictation)')
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

  // ─── Shared dictation start/stop helpers ───

  private startDictation(): void {
    if (this.instructionActive) {
      this.instructionActive = false
      console.log('[keyboard] Instruction STOPPED (direct chain to dictation)')
      this.emit('keyboard', { type: 'session-stop', mode: 'instruction' } as KeyboardEvent)

      this.dictationActive = true
      console.log('[keyboard] Dictation CHAIN-START (direct)')
      this.emit('keyboard', { type: 'chain-start', mode: 'dictation' } as KeyboardEvent)
      return
    }

    this.clearChainTimer()

    const chainResult = this.wasChainPending('dictation')
    if (chainResult === 'chain') {
      this.dictationActive = true
      console.log('[keyboard] Dictation CHAIN-START')
      this.emit('keyboard', { type: 'chain-start', mode: 'dictation' } as KeyboardEvent)
    } else if (chainResult === 'same-mode-restart') {
      console.log('[keyboard] Same-mode re-press — expiring chain immediately (process now)')
      this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
    } else {
      this.dictationActive = true
      console.log('[keyboard] Dictation SESSION-START')
      this.emit('keyboard', { type: 'session-start', mode: 'dictation' } as KeyboardEvent)
    }
  }

  private stopDictation(): void {
    this.dictationActive = false
    console.log('[keyboard] Dictation STOPPED')
    this.emit('keyboard', { type: 'session-stop', mode: 'dictation' } as KeyboardEvent)
    console.log('[keyboard] Dictation done — processing immediately (no chain wait)')
    this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
  }

  // ─── Instruction toggle (Right Shift / Caps Lock) ───

  private handleInstructionToggle(): void {
    const now = Date.now()
    if (now - this.lastInstructionToggleTime < this.DEBOUNCE_MS) {
      console.log('[keyboard] Instruction toggle DEBOUNCED (too fast)')
      return
    }
    this.lastInstructionToggleTime = now

    if (this.instructionActive) {
      this.instructionActive = false
      console.log('[keyboard] Instruction STOPPED')
      this.emit('keyboard', { type: 'session-stop', mode: 'instruction' } as KeyboardEvent)
      console.log('[keyboard] Instruction done — processing immediately (no chain wait)')
      this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
      return
    }

    if (this.dictationActive) {
      this.dictationActive = false
      console.log('[keyboard] Dictation STOPPED (direct chain to instruction)')
      this.emit('keyboard', { type: 'session-stop', mode: 'dictation' } as KeyboardEvent)

      this.instructionActive = true
      console.log('[keyboard] Instruction CHAIN-START (direct)')
      this.emit('keyboard', { type: 'chain-start', mode: 'instruction' } as KeyboardEvent)
      return
    }

    this.clearChainTimer()

    const chainResult = this.wasChainPending('instruction')
    if (chainResult === 'chain') {
      this.instructionActive = true
      console.log('[keyboard] Instruction CHAIN-START')
      this.emit('keyboard', { type: 'chain-start', mode: 'instruction' } as KeyboardEvent)
    } else if (chainResult === 'same-mode-restart') {
      console.log('[keyboard] Same-mode re-press — expiring chain immediately (process now)')
      this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
    } else {
      this.instructionActive = true
      console.log('[keyboard] Instruction SESSION-START')
      this.emit('keyboard', { type: 'session-start', mode: 'instruction' } as KeyboardEvent)
    }
  }

  // ─── Chain timer ───

  private clearChainTimer(): void {
    if (this.chainTimer) {
      clearTimeout(this.chainTimer)
      this.chainTimer = null
    }
  }

  /**
   * Check if a chain was pending and what kind of transition this is.
   *  - 'none': no chain was pending — start fresh session
   *  - 'chain': cross-mode chain (e.g. dictation → instruction) — chain into same session
   *  - 'same-mode-restart': same-mode re-press — process old, start new
   */
  private wasChainPending(newMode: SessionMode): 'none' | 'chain' | 'same-mode-restart' {
    const was = this._chainPending
    const prevMode = this._chainMode
    this._chainPending = false
    this._chainMode = null

    if (!was) return 'none'

    if (prevMode === newMode) {
      console.log('[keyboard] Same-mode re-press during chain window (', newMode, '→', newMode, ')')
      return 'same-mode-restart'
    }

    return 'chain'
  }
}

export const keyboardManager = new KeyboardManager()
