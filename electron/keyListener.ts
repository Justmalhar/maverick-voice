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
import type { DictationKey, InstructionKey } from '../shared/types'

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

  // ─── Configurable physical-key mapping (platform default applied by main) ───
  private dictationKey: DictationKey = process.platform === 'darwin' ? 'fn' : 'right-ctrl'
  private instructionKey: InstructionKey = 'caps-lock'

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
    switch (token) {
      case 'FN_DOWN':
        if (this.dictationKey === 'fn') this.emit('key', 'dictation-down' as KeyEvent)
        break
      case 'FN_UP':
        if (this.dictationKey === 'fn') this.emit('key', 'dictation-up' as KeyEvent)
        break
      case 'RIGHT_OPTION_DOWN':
        if (this.dictationKey === 'right-option') this.emit('key', 'dictation-down' as KeyEvent)
        break
      case 'RIGHT_OPTION_UP':
        if (this.dictationKey === 'right-option') this.emit('key', 'dictation-up' as KeyEvent)
        break
      case 'CAPS_DOWN':
      case 'CAPS_UP':
        // Caps Lock fires on LED toggle: BOTH CAPS_DOWN and CAPS_UP arrive for a
        // single physical press. Collapse the pair into ONE 'instruction-down'
        // (keyboard.ts triggers on down only).
        if (this.instructionKey === 'caps-lock') this.handleCapsToggle()
        break
      // PASTE_OK / COPY_OK are handled by sendCommand() listeners — ignore here
      case 'PASTE_OK':
      case 'COPY_OK':
        break
    }
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
        UiohookKey: { CtrlRight: number; AltRight: number; CapsLock: number }
      }

      // Resolve the uiohook keycode for the currently-configured dictation key.
      const dictationKeycode = (): number =>
        this.dictationKey === 'right-alt' ? UiohookKey.AltRight : UiohookKey.CtrlRight
      // Instruction is Caps Lock (Right Shift was removed — it conflicted with
      // system shortcuts and fired during Shift+Enter).
      const instructionKeycode = (): number => UiohookKey.CapsLock

      // Windows typematic auto-repeat fires keydown REPEATEDLY while a key is
      // held (first repeat ~500ms, past keyboard.ts's 300ms debounce), which
      // would toggle sessions on and off mid-hold. Track physical down state
      // and emit exactly ONE down per press — matching darwin's flagsChanged
      // semantics (single transition events, never repeats).
      this.uiohookKeydownHandler = (e: { keycode: number }) => {
        if (e.keycode === dictationKeycode()) {
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
        if (e.keycode === dictationKeycode()) {
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
   * Send a command to the globe-listener process via stdin (darwin only).
   * Used for fast keystroke simulation (PASTE, COPY) without spawning
   * a new osascript process (~180ms → ~5ms).
   *
   * Returns a promise that resolves when the command is acknowledged
   * (PASTE_OK / COPY_OK) or rejects on timeout/error. On win32 this rejects
   * (no helper process) — clipboard.ts uses PowerShell SendKeys instead.
   */
  sendCommand(command: 'PASTE' | 'COPY'): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'darwin') {
        reject(new Error('sendCommand is darwin-only'))
        return
      }
      if (!this.process || !this.process.stdin || this.process.killed) {
        reject(new Error('Globe listener process not running'))
        return
      }

      const expectedResponse = `${command}_OK`
      const timeoutMs = 500

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`${command} command timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const onData = (data: Buffer) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (line.trim() === expectedResponse) {
            cleanup()
            resolve()
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
