// ════════════════════════════════════════════════════════════════════════
// keys/listener.ts — THE PLATFORM SEAM for global key listening.
//
// Emits the same normalized KeyEvent strings on every platform so
// keys/bindings.ts is completely platform-unaware:
//   'dictation-down' | 'dictation-up' | 'instruction-down' | 'escape-down' | 'escape-up'
//
//  - darwin: mac-helper token protocol (listenerDarwin.ts)
//  - win32/linux: uiohook-napi physical transitions (listenerHook.ts)
//
// Binding resolution (single key vs >=2-modifier combo) lives HERE and is
// shared by both feeds. Escape is only delivered while the session layer has
// called enableEscape(true) — never a globally-registered shortcut while idle
// (v1 bug #11 stole system-wide Escape).
// ════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events'
import type { DictationBinding, DictationKey, ModifierKey } from '../../shared/types'
import { DarwinHelper, HelperCommand } from './listenerDarwin'
import { HookListener } from './listenerHook'

export type KeyEvent = 'dictation-down' | 'dictation-up' | 'instruction-down' | 'escape-down' | 'escape-up'

// Caps LED-pair pairing window: darwin fires BOTH CAPS_DOWN and CAPS_UP for a
// single physical press. Emit instruction-down on the FIRST token and swallow
// its pair only if it arrives within this window — the timer clears the flag,
// so one odd emission self-heals instead of inverting every subsequent press
// until restart (v1 bug #8's permanent latch). Event-pairing heuristic like
// DEBOUNCE_MS, not an ack timeout — deliberately not in TIMEOUTS.
const CAPS_PAIR_MS = 300

const ALL_MODIFIERS: readonly ModifierKey[] = ['fn', 'shift', 'ctrl', 'option', 'cmd']

class KeyListener extends EventEmitter {
  private binding: DictationBinding = {
    type: 'key',
    key: process.platform === 'darwin' ? 'fn' : 'right-ctrl'
  }
  // Combo resolver state (shared by the darwin MODS: feed and the hook feed).
  private heldModifiers = new Set<ModifierKey>()
  private comboActive = false
  // darwin Caps LED-pair self-healing window.
  private capsPairTimer: NodeJS.Timeout | null = null
  // Escape gating — set by the session layer only while a session is active.
  private escapeEnabled = false
  private darwinEscapeRegistered = false

  private darwin: DarwinHelper | null = null
  private hook: HookListener | null = null
  private running = false

  start(): boolean {
    if (process.platform === 'darwin') {
      if (!this.darwin) {
        this.darwin = new DarwinHelper({
          onToken: (token) => this.handleDarwinToken(token),
          onAlive: (alive) => {
            if (!alive) this.resetTransientState()
            this.emit('health', alive)
          }
        })
      }
      this.running = this.darwin.start()
    } else {
      if (!this.hook) {
        this.hook = new HookListener({
          onDictationKey: (key, down) => this.handleSingleKey(key, down),
          onModifiers: (held) => {
            this.heldModifiers = held
            this.evaluateCombo()
          },
          onInstructionDown: () => this.emit('key', 'instruction-down' satisfies KeyEvent),
          onEscape: (down) => {
            if (this.escapeEnabled) this.emit('key', (down ? 'escape-down' : 'escape-up') satisfies KeyEvent)
          }
        })
      }
      this.running = this.hook.start()
      if (!this.running) this.emit('health', false)
    }
    return this.running
  }

  stop(): void {
    this.darwin?.stop()
    this.hook?.stop()
    this.setDarwinEscape(false)
    this.escapeEnabled = false
    this.running = false
    this.resetTransientState()
  }

  isRunning(): boolean {
    if (process.platform === 'darwin') return !!this.darwin?.isRunning()
    return !!this.hook?.isRunning()
  }

  /**
   * Set the dictation trigger: a single physical key OR a >=2-modifier combo.
   * While a combo is configured, the single-key tokens are suppressed (one
   * binding at a time). A combo of <2 modifiers is rejected unchanged —
   * single modifiers are exactly the conflict class that got Right Shift
   * removed in v1.
   */
  setBinding(binding: DictationBinding): void {
    if (binding.type === 'combo') {
      const mods = Array.from(new Set(binding.mods))
      if (mods.length < 2) {
        console.warn('[keys] Ignoring combo binding with <2 modifiers:', JSON.stringify(binding.mods))
        return
      }
      this.binding = { type: 'combo', mods }
      console.log('[keys] Dictation binding set to combo:', mods.join('+'))
    } else {
      this.binding = { type: 'key', key: binding.key }
      console.log('[keys] Dictation binding set to key:', binding.key)
    }
    this.heldModifiers.clear()
    this.comboActive = false
  }

  /**
   * Send a stdin command to mac-helper and resolve with the full reply line
   * (e.g. 'PASTE_OK', 'FRONTAPP:<id>|<name>', 'HEALTH:OK'). Non-darwin:
   * HEALTH resolves 'ok' (no helper to be unhealthy), everything else rejects.
   */
  command(cmd: HelperCommand): Promise<string> {
    if (process.platform !== 'darwin') {
      if (cmd === 'HEALTH') return Promise.resolve('ok')
      return Promise.reject(new Error(`${cmd} is darwin-only (mac-helper)`))
    }
    if (!this.darwin) return Promise.reject(new Error('mac-helper not started'))
    return this.darwin.command(cmd)
  }

  /**
   * Escape delivery gate — the session layer enables this on session start and
   * disables it on session end, so Escape is NEVER intercepted while idle.
   *
   * DOCUMENTED DEVIATION (darwin): the mac-helper protocol has no escape token
   * (it only monitors flagsChanged) and uiohook is not loaded on darwin, so a
   * session-scoped Electron globalShortcut('Escape') is the delivery mechanism.
   * This matches the contract's intent — the prohibition targets v1's
   * always-on registration that stole Escape from every app during idle/
   * processing-adjacent states; here registration exists strictly inside the
   * enableEscape(true)…enableEscape(false) window. win32/linux deliver Escape
   * from the passive uiohook feed (nothing is stolen while idle), gated by
   * the same flag. NOTE: unlike darwin's globalShortcut (which the OS
   * delivers exclusively to us), uiohook-napi cannot consume/suppress the
   * keystroke — so on win32/linux, cancelling a session via Escape still
   * lets that same keypress reach the OS-focused window. See the ESCAPE IS
   * OBSERVATION-ONLY note in keys/listenerHook.ts for why this can't be
   * fixed without a native low-level keyboard hook.
   */
  enableEscape(enabled: boolean): void {
    this.escapeEnabled = enabled
    if (process.platform === 'darwin') this.setDarwinEscape(enabled)
  }

  // ── darwin token translation ─────────────────────────────────────────────

  private handleDarwinToken(token: string): void {
    if (token.startsWith('MODS:')) {
      const csv = token.slice('MODS:'.length)
      this.heldModifiers = new Set(
        csv
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is ModifierKey => (ALL_MODIFIERS as readonly string[]).includes(s))
      )
      this.evaluateCombo()
      return
    }
    switch (token) {
      case 'FN_DOWN':
        this.handleSingleKey('fn', true)
        break
      case 'FN_UP':
        this.handleSingleKey('fn', false)
        break
      case 'RIGHT_OPTION_DOWN':
        this.handleSingleKey('right-option', true)
        break
      case 'RIGHT_OPTION_UP':
        this.handleSingleKey('right-option', false)
        break
      case 'CAPS_DOWN':
      case 'CAPS_UP':
        this.handleCapsToken()
        break
      // Anything else (future tokens) is ignored; command replies never reach
      // here — listenerDarwin routes them to their pending promise.
    }
  }

  /** Single-key dictation path, both platforms. Suppressed in combo mode. */
  private handleSingleKey(key: DictationKey, down: boolean): void {
    if (this.binding.type !== 'key') return // combo configured — single keys off
    if (this.binding.key !== key) return
    this.emit('key', (down ? 'dictation-down' : 'dictation-up') satisfies KeyEvent)
  }

  /** Caps LED-pair collapse with the self-healing pairing window. */
  private handleCapsToken(): void {
    if (this.capsPairTimer) {
      // Second token of the pair, inside the window — swallow it.
      clearTimeout(this.capsPairTimer)
      this.capsPairTimer = null
      return
    }
    this.capsPairTimer = setTimeout(() => {
      this.capsPairTimer = null // window expired — next token is a new press
    }, CAPS_PAIR_MS)
    this.emit('key', 'instruction-down' satisfies KeyEvent)
  }

  // ── combo resolver (shared) ──────────────────────────────────────────────

  /**
   * Edge-triggered superset match: one 'dictation-down' on entry into the
   * superset, one 'dictation-up' on the first combo-member release. An EXTRA
   * held modifier must NOT break push-to-talk.
   */
  private evaluateCombo(): void {
    if (this.binding.type !== 'combo') return
    const isSuperset = this.binding.mods.every((m) => this.heldModifiers.has(m))
    if (isSuperset && !this.comboActive) {
      this.comboActive = true
      this.emit('key', 'dictation-down' satisfies KeyEvent)
    } else if (!isSuperset && this.comboActive) {
      this.comboActive = false
      this.emit('key', 'dictation-up' satisfies KeyEvent)
    }
  }

  // ── housekeeping ─────────────────────────────────────────────────────────

  private setDarwinEscape(register: boolean): void {
    if (register === this.darwinEscapeRegistered) return
    try {
      // Deferred import keeps electron optional for unit tests of this module.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { globalShortcut } = require('electron') as typeof import('electron')
      if (register) {
        const ok = globalShortcut.register('Escape', () => this.emit('key', 'escape-down' satisfies KeyEvent))
        if (!ok) {
          console.warn('[keys] Failed to register session-scoped Escape shortcut')
          return
        }
      } else {
        globalShortcut.unregister('Escape')
      }
      this.darwinEscapeRegistered = register
    } catch (err) {
      console.warn('[keys] Escape shortcut error:', err instanceof Error ? err.message : err)
    }
  }

  private resetTransientState(): void {
    this.heldModifiers.clear()
    this.comboActive = false
    if (this.capsPairTimer) {
      clearTimeout(this.capsPairTimer)
      this.capsPairTimer = null
    }
  }
}

export const keyListener = new KeyListener()
