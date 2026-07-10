// ════════════════════════════════════════════════════════════════════════
// electron/keyListener.ts — THE PLATFORM SEAM for global key listening.
//
// Emits the SAME normalized KeyEvent strings on BOTH platforms so keyboard.ts
// is completely platform-unaware:
//   'dictation-down' | 'dictation-up' | 'instruction-down' | 'instruction-up'
//
//  - darwin: spawns resources/bin/globe-listener (Swift helper) and translates
//    its raw stdout token protocol (FN_*, RIGHT_OPTION_*, CAPS_*) into the
//    normalized events based on the configured dictation/instruction keys.
//  - win32: uiohook-napi (uIOhook, UiohookKey) maps RightCtrl/RightAlt as the
//    dictation key and CapsLock as the instruction key (typematic auto-repeat
//    keydowns are swallowed so each physical press emits exactly one down).
//
// The physical-key → logical-event normalization lives HERE, never in
// keyboard.ts. See INTERFACES.md "Key vocabulary".
// ════════════════════════════════════════════════════════════════════════

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { DictationKey, InstructionKey, ModifierKey, DictationBinding } from '../shared/types'

/** Normalized, platform-invariant key events consumed by keyboard.ts. */
export type KeyEvent = 'dictation-down' | 'dictation-up' | 'instruction-down' | 'instruction-up'

class KeyListener extends EventEmitter {
  // ─── darwin: spawned globe-listener helper ───
  private process: ChildProcess | null = null
  private restarting = false

  // ─── win32: uiohook-napi state ───
  private uiohookStarted = false
  private uiohookKeydownHandler: ((e: { keycode: number }) => void) | null = null
  private uiohookKeyupHandler: ((e: { keycode: number }) => void) | null = null
  // Physical-down trackers to swallow Windows typematic auto-repeat keydowns.
  private win32DictationDown = false
  private win32InstructionDown = false
  // Held modifier KEYCODES (win32 combo feed). Tracked per physical keycode so
  // left/right siblings of the same logical modifier are released independently;
  // the logical held set is derived from this. Doubles as auto-repeat
  // suppression (re-adding an already-present keycode is a no-op).
  private win32HeldModifierCodes = new Set<number>()

  // ─── Configurable physical-key mapping (platform default applied by main) ───
  private dictationKey: DictationKey = process.platform === 'darwin' ? 'fn' : 'right-ctrl'
  private instructionKey: InstructionKey = 'caps-lock'

  // ─── Dictation binding (single key OR a >=2-modifier combo) ───
  // Defaults to the single-key binding so legacy behavior is unchanged until
  // main.ts pushes the migrated binding at boot. While a combo is active, the
  // single-key dictation tokens (FN_*/RIGHT_OPTION_*, win32 dictation keys) are
  // GUARDED off — one binding triggers dictation at a time.
  private dictationBinding: DictationBinding = { type: 'key', key: this.dictationKey }
  // The set of modifiers currently held (fed by darwin MODS: lines and win32
  // uiohook modifier keydown/keyup). Drives combo superset matching.
  private heldModifiers = new Set<ModifierKey>()
  // Whether the held set last satisfied the configured combo (debounces a single
  // 'dictation-down' on entry and a single 'dictation-up' on exit).
  private comboActive = false

  // ─── darwin Caps Lock dedupe: the LED toggle fires BOTH CAPS_DOWN and
  // CAPS_UP for a single physical press. keyboard.ts triggers on
  // 'instruction-down' ONLY, so we emit one 'instruction-down' per physical
  // press and swallow the paired token. ───
  private capsExpectingSecondToken = false

  /**
   * Resolve the globe-listener binary path (darwin only). Returns null when not
   * found / not darwin. KEEPS the 3-candidate dev-vs-packaged resolution.
   */
  getBinaryPath(): string | null {
    if (process.platform !== 'darwin') return null

    // Check multiple locations (dev vs packaged)
    // In packaged app: binaries are in extraResources → Contents/Resources/bin/
    // In dev: binaries are in project root → resources/bin/
    const candidates = [
      // Packaged app: process.resourcesPath = .app/Contents/Resources
      path.join(process.resourcesPath || '', 'bin', 'globe-listener'),
      // Dev mode: relative to project root
      path.join(app.getAppPath(), 'resources', 'bin', 'globe-listener'),
      path.join(__dirname, '..', '..', 'resources', 'bin', 'globe-listener')
    ]

    for (const candidate of candidates) {
      console.log('[keyListener] Checking binary path:', candidate, '→', fs.existsSync(candidate) ? 'FOUND' : 'not found')
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  /** Remap which physical key produces dictation events. */
  setDictationKey(key: DictationKey): void {
    console.log('[keyListener] Dictation key set to:', key)
    this.dictationKey = key
    // Keep the binding in sync with the legacy single-key accessor so a caller
    // using either API gets consistent behavior.
    this.dictationBinding = { type: 'key', key }
    this.resetComboState()
  }

  /**
   * Set the dictation trigger as a single physical key OR a >=2-modifier combo
   * (Discord-style push-to-talk). Augments/replaces setDictationKey: a
   * { type:'key' } binding restores the legacy single-key path; a
   * { type:'combo' } binding (>=2 modifiers) switches to superset matching and
   * GUARDS the single-key tokens off. A combo of <2 modifiers is rejected
   * (single modifiers are exactly the conflict class that got Right Shift
   * removed) and the binding is left unchanged.
   */
  setDictationBinding(binding: DictationBinding): void {
    if (binding.type === 'combo') {
      const mods = Array.from(new Set(binding.mods))
      if (mods.length < 2) {
        console.warn('[keyListener] Ignoring combo binding with <2 modifiers:', JSON.stringify(binding.mods))
        return
      }
      this.dictationBinding = { type: 'combo', mods }
      console.log('[keyListener] Dictation binding set to combo:', mods.join('+'))
    } else {
      this.dictationKey = binding.key
      this.dictationBinding = { type: 'key', key: binding.key }
      console.log('[keyListener] Dictation binding set to key:', binding.key)
    }
    this.resetComboState()
  }

  /** True while a >=2-modifier combo is the active dictation trigger. */
  private isComboMode(): boolean {
    return this.dictationBinding.type === 'combo'
  }

  /** Clear the per-press combo tracking (held set + active latch). */
  private resetComboState(): void {
    this.heldModifiers.clear()
    this.comboActive = false
  }

  /**
   * Recompute combo state from the current held-modifier set and emit a single
   * 'dictation-down' on entry into the superset / 'dictation-up' on the first
   * combo member release. Exact-or-superset matching: an EXTRA held modifier
   * must NOT break PTT. No-op when not in combo mode.
   */
  private evaluateCombo(): void {
    if (!this.isComboMode() || this.dictationBinding.type !== 'combo') return
    const mods = this.dictationBinding.mods
    const isSuperset = mods.every((m) => this.heldModifiers.has(m))
    if (isSuperset && !this.comboActive) {
      this.comboActive = true
      this.emit('key', 'dictation-down' as KeyEvent)
    } else if (!isSuperset && this.comboActive) {
      this.comboActive = false
      this.emit('key', 'dictation-up' as KeyEvent)
    }
  }

  /**
   * Remap which physical key produces instruction events. Caps Lock is the
   * only binding (Right Shift was removed — system-shortcut conflicts).
   */
  setInstructionKey(key: InstructionKey): void {
    console.log('[keyListener] Instruction key set to:', key)
    this.instructionKey = key
  }

  start(): boolean {
    if (process.platform === 'darwin') {
      return this.startDarwin()
    }
    if (process.platform === 'win32') {
      return this.startWin32()
    }
    console.log('[keyListener] Unsupported platform, skipping native key listener')
    return false
  }

  // ════════════════════════════════════════════════════════════════════════
  // darwin: globe-listener helper
  // ════════════════════════════════════════════════════════════════════════

  private startDarwin(): boolean {
    const binaryPath = this.getBinaryPath()
    if (!binaryPath) {
      console.error('[keyListener] Globe listener binary not found. Run: npm run compile:native')
      return false
    }

    // Ensure executable
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // Ignore chmod errors in packaged app
    }

    console.log('[keyListener] Starting globe listener:', binaryPath)

    this.process = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let buffer = ''

    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        this.handleRawToken(trimmed)
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('[keyListener] stderr:', data.toString())
    })

    this.process.on('error', (err) => {
      console.error('[keyListener] Process error:', err.message)
      this.emit('error', err)
    })

    this.process.on('exit', (code) => {
      console.log('[keyListener] Process exited with code:', code)
      this.process = null
      // Auto-restart on unexpected exit (code null = killed, 0 = clean)
      if (!this.restarting && code !== 0 && code !== null) {
        this.restarting = true
        console.log('[keyListener] Will auto-restart in 2s...')
        setTimeout(() => {
          this.restarting = false
          this.start()
        }, 2000)
      }
    })

    // Handle EPIPE errors gracefully (happens when process is killed during write)
    this.process.stdout?.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
      console.error('[keyListener] stdout error:', err.message)
    })
    this.process.stderr?.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
      console.error('[keyListener] stderr error:', err.message)
    })

    return true
  }

  /**
   * Translate a single raw globe-listener token into the normalized KeyEvent
   * based on the configured dictation/instruction keys. Unknown tokens and the
   * sendCommand acks (PASTE_OK/COPY_OK) are ignored here.
   */
  private handleRawToken(token: string): void {
    // MODS:<csv> arrives on EVERY flagsChanged — it drives the combo resolver's
    // held-modifier set. Prefix-matched (the CSV payload varies), so handle it
    // before the exact-match switch. The FN_*/RIGHT_OPTION_*/CAPS_* tokens are
    // unchanged and continue to drive single-key/instruction events.
    if (token.startsWith('MODS:')) {
      this.applyModsLine(token.slice('MODS:'.length))
      return
    }

    switch (token) {
      case 'FN_DOWN':
        // GUARD: while a combo is the active trigger, the single-key dictation
        // tokens must NOT also fire (one binding at a time).
        if (!this.isComboMode() && this.dictationKey === 'fn') this.emit('key', 'dictation-down' as KeyEvent)
        break
      case 'FN_UP':
        if (!this.isComboMode() && this.dictationKey === 'fn') this.emit('key', 'dictation-up' as KeyEvent)
        break
      case 'RIGHT_OPTION_DOWN':
        if (!this.isComboMode() && this.dictationKey === 'right-option')
          this.emit('key', 'dictation-down' as KeyEvent)
        break
      case 'RIGHT_OPTION_UP':
        if (!this.isComboMode() && this.dictationKey === 'right-option')
          this.emit('key', 'dictation-up' as KeyEvent)
        break
      case 'CAPS_DOWN':
      case 'CAPS_UP':
        // Caps Lock fires on LED toggle: BOTH CAPS_DOWN and CAPS_UP arrive for a
        // single physical press. Collapse the pair into ONE 'instruction-down'
        // (keyboard.ts triggers on down only). Instruction is independent of the
        // dictation binding, so it is NOT guarded by combo mode.
        if (this.instructionKey === 'caps-lock') this.handleCapsToggle()
        break
      // PASTE_OK / COPY_OK / FRONTAPP: are handled by sendCommand() listeners —
      // ignore here.
      case 'PASTE_OK':
      case 'COPY_OK':
        break
    }
  }

  /**
   * Apply a darwin MODS: CSV payload (e.g. "cmd,shift" or "" when none held) to
   * the held-modifier set and re-evaluate the combo. The Swift helper emits the
   * full currently-held set on every flagsChanged, so we replace wholesale.
   */
  private applyModsLine(csv: string): void {
    const ALL: readonly ModifierKey[] = ['cmd', 'ctrl', 'option', 'shift', 'fn']
    const next = csv
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is ModifierKey => (ALL as readonly string[]).includes(s))
    this.heldModifiers = new Set(next)
    this.evaluateCombo()
  }

  private handleCapsToggle(): void {
    if (this.capsExpectingSecondToken) {
      // Second token of the LED pair — swallow it.
      this.capsExpectingSecondToken = false
      return
    }
    this.capsExpectingSecondToken = true
    this.emit('key', 'instruction-down' as KeyEvent)
  }

  // ════════════════════════════════════════════════════════════════════════
  // win32: uiohook-napi
  // ════════════════════════════════════════════════════════════════════════

  private startWin32(): boolean {
    try {
      // Lazy require so the native module is only loaded on win32.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { uIOhook, UiohookKey } = require('uiohook-napi') as {
        uIOhook: {
          on: (event: 'keydown' | 'keyup', cb: (e: { keycode: number }) => void) => void
          start: () => void
          stop: () => void
          removeListener: (event: 'keydown' | 'keyup', cb: (e: { keycode: number }) => void) => void
        }
        UiohookKey: {
          CtrlRight: number
          AltRight: number
          CapsLock: number
          Ctrl: number
          Alt: number
          Shift: number
          ShiftRight: number
          Meta: number
          MetaRight: number
        }
      }

      // Resolve the uiohook keycode for the currently-configured dictation key.
      const dictationKeycode = (): number =>
        this.dictationKey === 'right-alt' ? UiohookKey.AltRight : UiohookKey.CtrlRight
      // Instruction is Caps Lock (Right Shift was removed — it conflicted with
      // system shortcuts and fired during Shift+Enter).
      const instructionKeycode = (): number => UiohookKey.CapsLock

      // Modifier-combo feed (win32): map each modifier keycode to its logical
      // ModifierKey. Left/right are equivalent; on Windows there is no fn
      // modifier and 'cmd'/'option' are the cross-platform names for Win(Meta)
      // and Alt.
      const modifierFor = (keycode: number): ModifierKey | null => {
        if (keycode === UiohookKey.Ctrl || keycode === UiohookKey.CtrlRight) return 'ctrl'
        if (keycode === UiohookKey.Alt || keycode === UiohookKey.AltRight) return 'option'
        if (keycode === UiohookKey.Shift || keycode === UiohookKey.ShiftRight) return 'shift'
        if (keycode === UiohookKey.Meta || keycode === UiohookKey.MetaRight) return 'cmd'
        return null
      }

      // Recompute the logical held-modifier set from the currently-held physical
      // modifier keycodes and re-evaluate the combo. A logical modifier (e.g.
      // 'shift') stays held while EITHER physical sibling is down.
      const refreshWin32Modifiers = (): void => {
        const logical = new Set<ModifierKey>()
        for (const code of this.win32HeldModifierCodes) {
          const m = modifierFor(code)
          if (m) logical.add(m)
        }
        this.heldModifiers = logical
        this.evaluateCombo()
      }

      // Windows typematic auto-repeat fires keydown REPEATEDLY while a key is
      // held (first repeat ~500ms, past keyboard.ts's 300ms debounce), which
      // would toggle sessions on and off mid-hold. Track physical down state
      // and emit exactly ONE down per press — matching darwin's flagsChanged
      // semantics (single transition events, never repeats).
      this.uiohookKeydownHandler = (e: { keycode: number }) => {
        // ── Modifier-combo feed: track held modifier keycodes (auto-repeat
        //    safe — Set re-add is a no-op) and re-evaluate the combo. ──
        if (modifierFor(e.keycode) !== null) {
          if (!this.win32HeldModifierCodes.has(e.keycode)) {
            this.win32HeldModifierCodes.add(e.keycode)
            refreshWin32Modifiers()
          }
          // A modifier keycode is never ALSO the single-key dictation trigger
          // (RightCtrl/RightAlt are dictation keys, but in combo mode they only
          // feed the combo; in key mode they fall through below). Continue so
          // RightCtrl/RightAlt still drive the single-key path when configured.
        }
        // ── Single-key dictation path. GUARD: suppressed while a combo is the
        //    active trigger (one binding at a time). ──
        if (!this.isComboMode() && e.keycode === dictationKeycode()) {
          if (this.win32DictationDown) return // auto-repeat — swallow
          this.win32DictationDown = true
          this.emit('key', 'dictation-down' as KeyEvent)
        } else if (e.keycode === instructionKeycode()) {
          if (this.win32InstructionDown) return // auto-repeat — swallow
          this.win32InstructionDown = true
          this.emit('key', 'instruction-down' as KeyEvent)
        }
      }
      this.uiohookKeyupHandler = (e: { keycode: number }) => {
        if (modifierFor(e.keycode) !== null) {
          if (this.win32HeldModifierCodes.delete(e.keycode)) {
            refreshWin32Modifiers()
          }
        }
        if (!this.isComboMode() && e.keycode === dictationKeycode()) {
          this.win32DictationDown = false
          this.emit('key', 'dictation-up' as KeyEvent)
        } else if (e.keycode === instructionKeycode()) {
          this.win32InstructionDown = false
          // No 'instruction-up' emit — parity with darwin, where the LED-pair
          // collapse produces only instruction-down. keyboard.ts toggles on
          // down exclusively; emitting up here invites platform divergence.
        }
      }

      uIOhook.on('keydown', this.uiohookKeydownHandler)
      uIOhook.on('keyup', this.uiohookKeyupHandler)
      uIOhook.start()
      this.uiohookStarted = true
      console.log('[keyListener] uiohook-napi started (win32)')
      return true
    } catch (err) {
      console.error('[keyListener] Failed to start uiohook-napi:', err instanceof Error ? err.message : err)
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return false
    }
  }

  /**
   * Send a command to the globe-listener process via stdin (darwin only) and
   * resolve with the FIRST reply line that satisfies `matches`, returning that
   * line. The shared plumbing behind sendCommand() and requestFrontApp():
   *  - PASTE/COPY ack with `PASTE_OK`/`COPY_OK`
   *  - FRONTAPP replies with `FRONTAPP:<bundleId>|<localizedName>`
   * Rejects on timeout / write error / not-darwin / process-not-running. KEEPS
   * the 500ms timeout + listener cleanup discipline.
   */
  private sendStdinCommand(
    command: 'PASTE' | 'COPY' | 'FRONTAPP',
    matches: (line: string) => boolean,
    timeoutMs = 500
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'darwin') {
        reject(new Error('sendCommand is darwin-only'))
        return
      }
      if (!this.process || !this.process.stdin || this.process.killed) {
        reject(new Error('Globe listener process not running'))
        return
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`${command} command timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const onData = (data: Buffer) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (matches(trimmed)) {
            cleanup()
            resolve(trimmed)
            return
          }
        }
      }

      const cleanup = () => {
        clearTimeout(timeout)
        this.process?.stdout?.removeListener('data', onData)
      }

      // Listen for the response
      this.process.stdout?.on('data', onData)

      // Send the command
      this.process.stdin.write(command + '\n', (err) => {
        if (err) {
          cleanup()
          reject(err)
        }
      })
    })
  }

  /**
   * Send a command to the globe-listener process via stdin (darwin only).
   * Used for fast keystroke simulation (PASTE, COPY) without spawning
   * a new osascript process (~180ms → ~5ms), and for FRONTAPP front-app
   * detection.
   *
   * Returns a promise that resolves when the command is acknowledged
   * (PASTE_OK / COPY_OK, or a FRONTAPP: reply line) or rejects on timeout/error.
   * On win32 this rejects (no helper process) — clipboard.ts uses PowerShell
   * SendKeys instead, and frontmostApp.ts uses its win32 PowerShell path.
   */
  sendCommand(command: 'PASTE' | 'COPY' | 'FRONTAPP'): Promise<void> {
    if (command === 'FRONTAPP') {
      return this.sendStdinCommand(command, (line) => line.startsWith('FRONTAPP:')).then(() => undefined)
    }
    return this.sendStdinCommand(command, (line) => line === `${command}_OK`).then(() => undefined)
  }

  /**
   * Ask the globe-listener for the frontmost application (darwin only). Resolves
   * with the raw reply payload `<bundleId>|<localizedName>` (the `FRONTAPP:`
   * prefix stripped). Rejects on timeout / not-running / non-darwin — the caller
   * (frontmostApp.ts) maps a rejection to its osascript fallback / null.
   */
  requestFrontApp(): Promise<string> {
    return this.sendStdinCommand('FRONTAPP', (line) => line.startsWith('FRONTAPP:')).then((line) =>
      line.slice('FRONTAPP:'.length)
    )
  }

  /** Check if the listener is running. */
  isRunning(): boolean {
    if (process.platform === 'darwin') {
      return !!(this.process && !this.process.killed && this.process.stdin)
    }
    if (process.platform === 'win32') {
      return this.uiohookStarted
    }
    return false
  }

  stop(): void {
    if (process.platform === 'darwin') {
      this.restarting = true
      if (this.process) {
        this.process.kill()
        this.process = null
      }
      return
    }

    if (process.platform === 'win32' && this.uiohookStarted) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { uIOhook } = require('uiohook-napi') as {
          uIOhook: {
            stop: () => void
            removeListener: (event: 'keydown' | 'keyup', cb: (e: { keycode: number }) => void) => void
          }
        }
        if (this.uiohookKeydownHandler) uIOhook.removeListener('keydown', this.uiohookKeydownHandler)
        if (this.uiohookKeyupHandler) uIOhook.removeListener('keyup', this.uiohookKeyupHandler)
        uIOhook.stop()
        // Clear physical-down trackers — a key may still be held at stop time.
        this.win32DictationDown = false
        this.win32InstructionDown = false
        this.win32HeldModifierCodes.clear()
        this.resetComboState()
      } catch (err) {
        console.error('[keyListener] Error stopping uiohook-napi:', err instanceof Error ? err.message : err)
      }
      this.uiohookStarted = false
      this.uiohookKeydownHandler = null
      this.uiohookKeyupHandler = null
    }
  }
}

export const keyListener = new KeyListener()
