// ════════════════════════════════════════════════════════════════════════
// keys/listenerHook.ts — uiohook-napi wiring (win32 + linux).
//
// Reports PHYSICAL key transitions to the KeyListener core; the core decides
// what they mean under the configured binding. Keycodes are resolved by
// UiohookKey NAME only (never numeric literals). Typematic auto-repeat is
// suppressed with per-key down flags so each physical press emits exactly one
// down — matching darwin's flagsChanged semantics. No instruction-up is ever
// reported (parity with the darwin LED-pair collapse).
// ════════════════════════════════════════════════════════════════════════

import type { DictationKey, ModifierKey } from '../../shared/types'

export interface HookCallbacks {
  onDictationKey(key: Extract<DictationKey, 'right-ctrl' | 'right-alt'>, down: boolean): void
  onModifiers(held: Set<ModifierKey>): void
  onInstructionDown(): void
  onEscape(down: boolean): void
}

interface UiohookModule {
  uIOhook: {
    on(event: 'keydown' | 'keyup', cb: (e: { keycode: number }) => void): void
    removeListener(event: 'keydown' | 'keyup', cb: (e: { keycode: number }) => void): void
    start(): void
    stop(): void
  }
  UiohookKey: {
    CtrlRight: number
    AltRight: number
    CapsLock: number
    Escape: number
    Ctrl: number
    Alt: number
    Shift: number
    ShiftRight: number
    Meta: number
    MetaRight: number
  }
}

export class HookListener {
  private started = false
  // Physical keycodes currently down — auto-repeat suppression (Set re-add is
  // a no-op) AND the source for the derived logical held-modifier set, so
  // left/right siblings of one logical modifier release independently.
  private heldModifierCodes = new Set<number>()
  private dictationDown = new Set<number>()
  private instructionDown = false
  private escapeDown = false
  private keydownHandler: ((e: { keycode: number }) => void) | null = null
  private keyupHandler: ((e: { keycode: number }) => void) | null = null

  constructor(private readonly cb: HookCallbacks) {}

  start(): boolean {
    if (this.started) return true
    try {
      // Lazy require: the native module must never load on darwin, and a
      // Wayland compositor block must degrade (health false), not crash boot.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { uIOhook, UiohookKey } = require('uiohook-napi') as UiohookModule

      const modifierFor = (keycode: number): ModifierKey | null => {
        if (keycode === UiohookKey.Ctrl || keycode === UiohookKey.CtrlRight) return 'ctrl'
        if (keycode === UiohookKey.Alt || keycode === UiohookKey.AltRight) return 'option'
        if (keycode === UiohookKey.Shift || keycode === UiohookKey.ShiftRight) return 'shift'
        if (keycode === UiohookKey.Meta || keycode === UiohookKey.MetaRight) return 'cmd'
        return null
      }
      const dictationFor = (keycode: number): 'right-ctrl' | 'right-alt' | null => {
        if (keycode === UiohookKey.CtrlRight) return 'right-ctrl'
        if (keycode === UiohookKey.AltRight) return 'right-alt'
        return null
      }
      const emitModifiers = (): void => {
        const logical = new Set<ModifierKey>()
        for (const code of this.heldModifierCodes) {
          const m = modifierFor(code)
          if (m) logical.add(m)
        }
        this.cb.onModifiers(logical)
      }

      this.keydownHandler = (e) => {
        if (modifierFor(e.keycode) !== null && !this.heldModifierCodes.has(e.keycode)) {
          this.heldModifierCodes.add(e.keycode)
          emitModifiers()
        }
        const dictation = dictationFor(e.keycode)
        if (dictation) {
          if (this.dictationDown.has(e.keycode)) return // auto-repeat — swallow
          this.dictationDown.add(e.keycode)
          this.cb.onDictationKey(dictation, true)
        } else if (e.keycode === UiohookKey.CapsLock) {
          if (this.instructionDown) return // auto-repeat — swallow
          this.instructionDown = true
          this.cb.onInstructionDown()
        } else if (e.keycode === UiohookKey.Escape) {
          if (this.escapeDown) return // auto-repeat — swallow
          this.escapeDown = true
          this.cb.onEscape(true)
        }
      }
      this.keyupHandler = (e) => {
        if (this.heldModifierCodes.delete(e.keycode)) {
          emitModifiers()
        }
        const dictation = dictationFor(e.keycode)
        if (dictation) {
          this.dictationDown.delete(e.keycode)
          this.cb.onDictationKey(dictation, false)
        } else if (e.keycode === UiohookKey.CapsLock) {
          this.instructionDown = false
          // No instruction-up — keyBindings toggles on down exclusively.
        } else if (e.keycode === UiohookKey.Escape) {
          this.escapeDown = false
          this.cb.onEscape(false)
        }
      }

      uIOhook.on('keydown', this.keydownHandler)
      uIOhook.on('keyup', this.keyupHandler)
      uIOhook.start() // throws on Wayland compositor block → caught below
      this.started = true
      console.log('[keys] uiohook-napi started')
      return true
    } catch (err) {
      console.error('[keys] uiohook-napi failed to start:', err instanceof Error ? err.message : err)
      this.keydownHandler = null
      this.keyupHandler = null
      return false
    }
  }

  stop(): void {
    if (!this.started) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { uIOhook } = require('uiohook-napi') as UiohookModule
      if (this.keydownHandler) uIOhook.removeListener('keydown', this.keydownHandler)
      if (this.keyupHandler) uIOhook.removeListener('keyup', this.keyupHandler)
      uIOhook.stop()
    } catch (err) {
      console.error('[keys] Error stopping uiohook-napi:', err instanceof Error ? err.message : err)
    }
    // Keys may still be physically held at stop time — clear all trackers.
    this.heldModifierCodes.clear()
    this.dictationDown.clear()
    this.instructionDown = false
    this.escapeDown = false
    this.started = false
    this.keydownHandler = null
    this.keyupHandler = null
  }

  isRunning(): boolean {
    return this.started
  }
}
