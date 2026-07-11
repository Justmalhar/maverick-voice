import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookListener, type HookCallbacks } from './listenerHook'

// `uiohook-napi` is loaded inside listenerHook.ts via a lazy, plain CJS
// `require(...)` (deliberately — it must never load on darwin). Vitest's
// vi.mock only intercepts Vite's ESM module graph, NOT raw `require()` calls,
// so a real, actually-installed native module bypasses vi.mock entirely here
// (verified empirically — vi.mock('uiohook-napi', ...) silently never fires
// and the real native addon loads instead). The supported way to stub a
// module reached only via `require()` is to seed Node's own CJS
// `require.cache` for its resolved path before the code runs.
const UiohookKey = {
  CtrlRight: 1,
  AltRight: 2,
  CapsLock: 3,
  Escape: 4,
  Ctrl: 5,
  Alt: 6,
  Shift: 7,
  ShiftRight: 8,
  Meta: 9,
  MetaRight: 10
}
const onMock = vi.fn()
const removeListenerMock = vi.fn()
const startMock = vi.fn()
const stopMock = vi.fn()

const resolvedUiohook = require.resolve('uiohook-napi')
let originalCacheEntry: NodeModule | undefined

beforeEach(() => {
  originalCacheEntry = require.cache[resolvedUiohook]
  require.cache[resolvedUiohook] = {
    id: resolvedUiohook,
    filename: resolvedUiohook,
    loaded: true,
    exports: {
      uIOhook: {
        on: (...a: unknown[]) => onMock(...a),
        removeListener: (...a: unknown[]) => removeListenerMock(...a),
        start: (...a: unknown[]) => startMock(...a),
        stop: (...a: unknown[]) => stopMock(...a)
      },
      UiohookKey
    }
  } as unknown as NodeModule
})

afterEach(() => {
  if (originalCacheEntry) require.cache[resolvedUiohook] = originalCacheEntry
  else delete require.cache[resolvedUiohook]
})

function getHandlers() {
  const keydown = onMock.mock.calls.find((c) => c[0] === 'keydown')?.[1]
  const keyup = onMock.mock.calls.find((c) => c[0] === 'keyup')?.[1]
  return { keydown, keyup }
}

describe('listenerHook.HookListener', () => {
  let cb: {
    onDictationKey: ReturnType<typeof vi.fn>
    onModifiers: ReturnType<typeof vi.fn>
    onInstructionDown: ReturnType<typeof vi.fn>
    onEscape: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    onMock.mockReset()
    removeListenerMock.mockReset()
    startMock.mockReset()
    stopMock.mockReset()
    cb = {
      onDictationKey: vi.fn(),
      onModifiers: vi.fn(),
      onInstructionDown: vi.fn(),
      onEscape: vi.fn()
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // vi.fn()'s type carries a construct signature that TS won't narrow to the
  // plain callback shape HookCallbacks wants — cast once here instead of at 20
  // construction sites.
  const newHook = (): HookListener => new HookListener(cb as unknown as HookCallbacks)

  it('start(): registers handlers and starts uIOhook', () => {
    const l = newHook()
    const errSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(l.start()).toBe(true)
    expect(onMock).toHaveBeenCalledTimes(2)
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(l.isRunning()).toBe(true)
    errSpy.mockRestore()
  })

  it('start(): second call is a no-op (already started)', () => {
    const l = newHook()
    l.start()
    onMock.mockClear()
    expect(l.start()).toBe(true)
    expect(onMock).not.toHaveBeenCalled()
  })

  it('start(): uIOhook.start() throwing (Wayland block) degrades gracefully', () => {
    startMock.mockImplementationOnce(() => {
      throw new Error('wayland blocked')
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const l = newHook()
    expect(l.start()).toBe(false)
    expect(l.isRunning()).toBe(false)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('start(): a thrown non-Error value is still logged (falls to the `: err` branch)', () => {
    startMock.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'not an Error instance'
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const l = newHook()
    expect(l.start()).toBe(false)
    expect(errSpy).toHaveBeenCalledWith('[keys] uiohook-napi failed to start:', 'not an Error instance')
    errSpy.mockRestore()
  })

  describe('keydown', () => {
    it('modifier key down emits onModifiers once; auto-repeat suppressed', () => {
      const l = newHook()
      l.start()
      const { keydown } = getHandlers()
      keydown!({ keycode: UiohookKey.Ctrl })
      expect(cb.onModifiers).toHaveBeenCalledTimes(1)
      expect(cb.onModifiers).toHaveBeenLastCalledWith(new Set(['ctrl']))
      keydown!({ keycode: UiohookKey.Ctrl }) // auto-repeat
      expect(cb.onModifiers).toHaveBeenCalledTimes(1)
    })

    it('left/right sibling modifiers collapse to one logical modifier and release independently', () => {
      const l = newHook()
      l.start()
      const { keydown, keyup } = getHandlers()
      keydown!({ keycode: UiohookKey.Ctrl })
      keydown!({ keycode: UiohookKey.CtrlRight })
      // CtrlRight is also a dictation key, so onModifiers fires from the modifier
      // branch even though CtrlRight independently triggers onDictationKey too.
      expect(cb.onModifiers).toHaveBeenLastCalledWith(new Set(['ctrl']))
      keyup!({ keycode: UiohookKey.Ctrl })
      expect(cb.onModifiers).toHaveBeenLastCalledWith(new Set(['ctrl'])) // CtrlRight sibling still held
      keyup!({ keycode: UiohookKey.CtrlRight })
      expect(cb.onModifiers).toHaveBeenLastCalledWith(new Set())
    })

    it('CtrlRight down fires both onModifiers(ctrl) and onDictationKey(right-ctrl, true)', () => {
      const l = newHook()
      l.start()
      const { keydown } = getHandlers()
      keydown!({ keycode: UiohookKey.CtrlRight })
      expect(cb.onModifiers).toHaveBeenCalledWith(new Set(['ctrl']))
      expect(cb.onDictationKey).toHaveBeenCalledWith('right-ctrl', true)
    })

    it('AltRight dictation key down/auto-repeat suppression/up', () => {
      const l = newHook()
      l.start()
      const { keydown, keyup } = getHandlers()
      keydown!({ keycode: UiohookKey.AltRight })
      expect(cb.onDictationKey).toHaveBeenCalledWith('right-alt', true)
      cb.onDictationKey.mockClear()
      keydown!({ keycode: UiohookKey.AltRight }) // auto-repeat swallowed
      expect(cb.onDictationKey).not.toHaveBeenCalled()
      keyup!({ keycode: UiohookKey.AltRight })
      expect(cb.onDictationKey).toHaveBeenCalledWith('right-alt', false)
    })

    it('CapsLock down triggers onInstructionDown once per physical press, no instruction-up', () => {
      const l = newHook()
      l.start()
      const { keydown, keyup } = getHandlers()
      keydown!({ keycode: UiohookKey.CapsLock })
      expect(cb.onInstructionDown).toHaveBeenCalledTimes(1)
      keydown!({ keycode: UiohookKey.CapsLock }) // auto-repeat
      expect(cb.onInstructionDown).toHaveBeenCalledTimes(1)
      keyup!({ keycode: UiohookKey.CapsLock })
      expect(cb.onInstructionDown).toHaveBeenCalledTimes(1)
      keydown!({ keycode: UiohookKey.CapsLock }) // fresh press after release
      expect(cb.onInstructionDown).toHaveBeenCalledTimes(2)
    })

    it('Escape down/up with auto-repeat suppression', () => {
      const l = newHook()
      l.start()
      const { keydown, keyup } = getHandlers()
      keydown!({ keycode: UiohookKey.Escape })
      expect(cb.onEscape).toHaveBeenCalledWith(true)
      cb.onEscape.mockClear()
      keydown!({ keycode: UiohookKey.Escape }) // auto-repeat
      expect(cb.onEscape).not.toHaveBeenCalled()
      keyup!({ keycode: UiohookKey.Escape })
      expect(cb.onEscape).toHaveBeenCalledWith(false)
    })

    it('unrelated keycode triggers nothing', () => {
      const l = newHook()
      l.start()
      const { keydown } = getHandlers()
      keydown!({ keycode: 999 })
      expect(cb.onDictationKey).not.toHaveBeenCalled()
      expect(cb.onInstructionDown).not.toHaveBeenCalled()
      expect(cb.onEscape).not.toHaveBeenCalled()
      expect(cb.onModifiers).not.toHaveBeenCalled()
    })

    it('Shift/ShiftRight and Meta/MetaRight also resolve to a logical modifier', () => {
      const l = newHook()
      l.start()
      const { keydown } = getHandlers()
      keydown!({ keycode: UiohookKey.Shift })
      expect(cb.onModifiers).toHaveBeenLastCalledWith(new Set(['shift']))
      keydown!({ keycode: UiohookKey.MetaRight })
      expect(cb.onModifiers).toHaveBeenLastCalledWith(new Set(['shift', 'cmd']))
    })

    it('emitModifiers skips a held code that maps to no logical modifier (contrived)', () => {
      const l = newHook()
      l.start()
      const { keydown } = getHandlers()
      // Contrived: heldModifierCodes only ever gains entries that already
      // passed modifierFor() !== null (see the keydown guard), so the `if (m)`
      // false branch inside emitModifiers is otherwise unreachable through
      // the public API.
      ;(l as any).heldModifierCodes.add(12345)
      keydown!({ keycode: UiohookKey.Ctrl })
      expect(cb.onModifiers).toHaveBeenLastCalledWith(new Set(['ctrl']))
    })
  })

  describe('keyup', () => {
    it('releasing a modifier that was never pressed does not emit onModifiers', () => {
      const l = newHook()
      l.start()
      const { keyup } = getHandlers()
      keyup!({ keycode: UiohookKey.Shift })
      expect(cb.onModifiers).not.toHaveBeenCalled()
    })

    it('unrelated keyup triggers nothing', () => {
      const l = newHook()
      l.start()
      const { keyup } = getHandlers()
      keyup!({ keycode: 999 })
      expect(cb.onDictationKey).not.toHaveBeenCalled()
      expect(cb.onEscape).not.toHaveBeenCalled()
    })
  })

  describe('stop()', () => {
    it('no-op when never started', () => {
      const l = newHook()
      l.stop()
      expect(removeListenerMock).not.toHaveBeenCalled()
      expect(stopMock).not.toHaveBeenCalled()
    })

    it('removes listeners, stops uIOhook, clears trackers', () => {
      const l = newHook()
      l.start()
      const { keydown } = getHandlers()
      keydown!({ keycode: UiohookKey.Ctrl }) // leave some held state to be cleared
      l.stop()
      expect(removeListenerMock).toHaveBeenCalledTimes(2)
      expect(stopMock).toHaveBeenCalledTimes(1)
      expect(l.isRunning()).toBe(false)
    })

    it('errors from uIOhook.stop() are caught and logged', () => {
      const l = newHook()
      l.start()
      stopMock.mockImplementationOnce(() => {
        throw new Error('stop failed')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => l.stop()).not.toThrow()
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })

    it('a thrown non-Error value from uIOhook.stop() is still logged', () => {
      const l = newHook()
      l.start()
      stopMock.mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'stop broke'
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      l.stop()
      expect(errSpy).toHaveBeenCalledWith('[keys] Error stopping uiohook-napi:', 'stop broke')
      errSpy.mockRestore()
    })

    it('removeListener guards are skipped when handler refs are already null (contrived)', () => {
      const l = newHook()
      l.start()
      // Contrived: null the private handler refs directly — unreachable via
      // the public API while `started` is true, since a successful start()
      // always assigns both handlers.
      ;(l as any).keydownHandler = null
      ;(l as any).keyupHandler = null
      l.stop()
      expect(removeListenerMock).not.toHaveBeenCalled()
      expect(stopMock).toHaveBeenCalledTimes(1)
    })
  })
})
