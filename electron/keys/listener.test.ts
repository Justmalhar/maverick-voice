import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// listenerDarwin.ts / listenerHook.ts are ESM-imported by listener.ts, so
// vi.mock intercepts them cleanly.
const { darwinInstances, hookInstances, DarwinHelperMock, HookListenerMock } = vi.hoisted(() => {
  const darwinInstances: any[] = []
  const hookInstances: any[] = []
  // Regular `function` (not an arrow) — vi.fn() must be constructible since
  // listener.ts calls `new DarwinHelper(...)` / `new HookListener(...)`.
  const DarwinHelperMock = vi.fn().mockImplementation(function (cb: any) {
    const inst = {
      cb,
      start: vi.fn(() => true),
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      command: vi.fn(() => Promise.resolve('ok'))
    }
    darwinInstances.push(inst)
    return inst
  })
  const HookListenerMock = vi.fn().mockImplementation(function (cb: any) {
    const inst = {
      cb,
      start: vi.fn(() => true),
      stop: vi.fn(),
      isRunning: vi.fn(() => true)
    }
    hookInstances.push(inst)
    return inst
  })
  return { darwinInstances, hookInstances, DarwinHelperMock, HookListenerMock }
})

vi.mock('./listenerDarwin', () => ({ DarwinHelper: DarwinHelperMock }))
vi.mock('./listenerHook', () => ({ HookListener: HookListenerMock }))

// `keys/listener.ts` reaches `electron` only via a lazy, session-scoped
// `require('electron')` inside setDarwinEscape (deliberately, per its own
// comment, so electron stays optional for unit tests). Like uiohook-napi in
// listenerHook.ts, this is a raw CJS require that bypasses vi.mock entirely
// (verified empirically) — seed require.cache for its resolved path instead.
const registerMock = vi.fn(() => true)
const unregisterMock = vi.fn()
const resolvedElectron = require.resolve('electron')
let originalElectronCacheEntry: NodeModule | undefined

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}
const REAL_PLATFORM = process.platform

describe('keys/listener.ts', () => {
  beforeEach(() => {
    vi.resetModules()
    darwinInstances.length = 0
    hookInstances.length = 0
    DarwinHelperMock.mockClear()
    HookListenerMock.mockClear()
    registerMock.mockReset().mockReturnValue(true)
    unregisterMock.mockReset()
    originalElectronCacheEntry = require.cache[resolvedElectron]
    require.cache[resolvedElectron] = {
      id: resolvedElectron,
      filename: resolvedElectron,
      loaded: true,
      exports: { globalShortcut: { register: registerMock, unregister: unregisterMock } }
    } as unknown as NodeModule
  })

  afterEach(() => {
    if (originalElectronCacheEntry) require.cache[resolvedElectron] = originalElectronCacheEntry
    else delete require.cache[resolvedElectron]
    setPlatform(REAL_PLATFORM)
  })

  async function loadDarwin() {
    setPlatform('darwin')
    const mod = await import('./listener')
    return mod.keyListener
  }

  async function loadHook(platform: 'win32' | 'linux' = 'win32') {
    setPlatform(platform)
    const mod = await import('./listener')
    return mod.keyListener
  }

  describe('darwin platform', () => {
    it('start() creates one DarwinHelper and reuses it on subsequent start() calls', () => {
      return loadDarwin().then((kl) => {
        expect(kl.start()).toBe(true)
        expect(DarwinHelperMock).toHaveBeenCalledTimes(1)
        expect(kl.start()).toBe(true)
        expect(DarwinHelperMock).toHaveBeenCalledTimes(1) // not recreated
        expect(darwinInstances[0].start).toHaveBeenCalledTimes(2)
      })
    })

    it('isRunning() reflects the darwin helper', async () => {
      const kl = await loadDarwin()
      kl.start()
      expect(kl.isRunning()).toBe(true)
      darwinInstances[0].isRunning.mockReturnValue(false)
      expect(kl.isRunning()).toBe(false)
    })

    it('stop() delegates to darwin.stop(), clears escape registration and resets transient state', async () => {
      const kl = await loadDarwin()
      kl.start()
      kl.enableEscape(true)
      expect(registerMock).toHaveBeenCalledTimes(1)
      kl.stop()
      expect(darwinInstances[0].stop).toHaveBeenCalledTimes(1)
      expect(unregisterMock).toHaveBeenCalledTimes(1)
    })

    it('command(): darwin routes to darwin.command when started', async () => {
      const kl = await loadDarwin()
      kl.start()
      await expect(kl.command('PASTE')).resolves.toBe('ok')
      expect(darwinInstances[0].command).toHaveBeenCalledWith('PASTE')
    })

    it('command(): rejects when darwin helper was never started', async () => {
      const kl = await loadDarwin()
      await expect(kl.command('HEALTH')).rejects.toThrow('mac-helper not started')
    })

    it('onAlive(false) resets transient state and forwards health event', async () => {
      const kl = await loadDarwin()
      kl.start()
      const healthSpy = vi.fn()
      kl.on('health', healthSpy)
      darwinInstances[0].cb.onAlive(false)
      expect(healthSpy).toHaveBeenCalledWith(false)
      darwinInstances[0].cb.onAlive(true)
      expect(healthSpy).toHaveBeenCalledWith(true)
    })

    it('setBinding(): rejects combo with <2 modifiers, keeps prior binding', async () => {
      const kl = await loadDarwin()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      kl.setBinding({ type: 'combo', mods: ['shift'] })
      expect(warnSpy).toHaveBeenCalled()
      // still on single-key default: fn down still triggers dictation-down
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('FN_DOWN')
      expect(onKey).toHaveBeenCalledWith('dictation-down')
      warnSpy.mockRestore()
    })

    it('setBinding(): accepts a >=2 modifier combo, dedupes mods, and clears held state', async () => {
      const kl = await loadDarwin()
      kl.start()
      kl.setBinding({ type: 'combo', mods: ['shift', 'ctrl', 'shift'] })
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('MODS:shift,ctrl')
      expect(onKey).toHaveBeenCalledWith('dictation-down')
    })

    it('setBinding(): switching to a key binding clears combo state', async () => {
      const kl = await loadDarwin()
      kl.start()
      kl.setBinding({ type: 'combo', mods: ['shift', 'ctrl'] })
      kl.setBinding({ type: 'key', key: 'right-option' })
      const onKey = vi.fn()
      kl.on('key', onKey)
      // combo tokens no longer produce dictation events once switched to a key binding
      darwinInstances[0].cb.onToken('MODS:shift,ctrl')
      expect(onKey).not.toHaveBeenCalled()
      darwinInstances[0].cb.onToken('RIGHT_OPTION_DOWN')
      expect(onKey).toHaveBeenCalledWith('dictation-down')
    })

    it('handleDarwinToken: FN_DOWN/FN_UP match default binding; mismatched key binding suppressed', async () => {
      const kl = await loadDarwin()
      kl.start()
      kl.setBinding({ type: 'key', key: 'right-option' })
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('FN_DOWN') // binding is right-option now, fn suppressed
      expect(onKey).not.toHaveBeenCalled()
      darwinInstances[0].cb.onToken('RIGHT_OPTION_DOWN')
      darwinInstances[0].cb.onToken('RIGHT_OPTION_UP')
      expect(onKey).toHaveBeenNthCalledWith(1, 'dictation-down')
      expect(onKey).toHaveBeenNthCalledWith(2, 'dictation-up')
    })

    it('handleDarwinToken: FN_UP matches the default fn binding', async () => {
      const kl = await loadDarwin()
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('FN_UP')
      expect(onKey).toHaveBeenCalledWith('dictation-up')
    })

    it('resetTransientState clears a pending caps-pair timer (onAlive(false) mid-window)', async () => {
      vi.useFakeTimers()
      const kl = await loadDarwin()
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('CAPS_DOWN') // arms the self-heal timer
      darwinInstances[0].cb.onAlive(false) // helper died mid-window — clears the timer
      // Advancing time must not throw or emit anything from a stale timer.
      vi.advanceTimersByTime(1000)
      expect(onKey).toHaveBeenCalledTimes(1) // only the original instruction-down
      vi.useRealTimers()
    })

    it('handleDarwinToken: unknown/future tokens are ignored', async () => {
      const kl = await loadDarwin()
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('SOME_FUTURE_TOKEN')
      expect(onKey).not.toHaveBeenCalled()
    })

    it('caps LED-pair self-heals: second token within the window is swallowed', async () => {
      vi.useFakeTimers()
      const kl = await loadDarwin()
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('CAPS_DOWN')
      expect(onKey).toHaveBeenCalledTimes(1)
      expect(onKey).toHaveBeenCalledWith('instruction-down')
      darwinInstances[0].cb.onToken('CAPS_UP') // paired token inside window — swallowed
      expect(onKey).toHaveBeenCalledTimes(1)
      // window expires; next token is a fresh press
      vi.advanceTimersByTime(300)
      darwinInstances[0].cb.onToken('CAPS_DOWN')
      expect(onKey).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it('caps pair window self-heals even without a second token (timer just clears)', async () => {
      vi.useFakeTimers()
      const kl = await loadDarwin()
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('CAPS_DOWN')
      vi.advanceTimersByTime(300)
      darwinInstances[0].cb.onToken('CAPS_DOWN')
      expect(onKey).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it('combo resolver: extra held modifier does not break an active combo', async () => {
      const kl = await loadDarwin()
      kl.start()
      kl.setBinding({ type: 'combo', mods: ['shift', 'ctrl'] })
      const onKey = vi.fn()
      kl.on('key', onKey)
      darwinInstances[0].cb.onToken('MODS:shift,ctrl')
      expect(onKey).toHaveBeenCalledTimes(1)
      darwinInstances[0].cb.onToken('MODS:shift,ctrl,option') // extra modifier, still superset
      expect(onKey).toHaveBeenCalledTimes(1) // no duplicate down
      darwinInstances[0].cb.onToken('MODS:option') // drops below superset
      expect(onKey).toHaveBeenCalledTimes(2)
      expect(onKey).toHaveBeenLastCalledWith('dictation-up')
    })

    it('setDarwinEscape: enableEscape(false) when never registered is a no-op', async () => {
      const kl = await loadDarwin()
      kl.enableEscape(false)
      expect(unregisterMock).not.toHaveBeenCalled()
    })

    it('setDarwinEscape: repeated enableEscape(true) does not re-register', async () => {
      const kl = await loadDarwin()
      kl.enableEscape(true)
      kl.enableEscape(true)
      expect(registerMock).toHaveBeenCalledTimes(1)
    })

    it('setDarwinEscape: register() returning false logs a warning and does not flip the latch', async () => {
      registerMock.mockReturnValue(false)
      const kl = await loadDarwin()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      kl.enableEscape(true)
      expect(warnSpy).toHaveBeenCalled()
      // Latch stayed false, so a later enableEscape(true) tries to register again.
      registerMock.mockReturnValue(true)
      kl.enableEscape(true)
      expect(registerMock).toHaveBeenCalledTimes(2)
      warnSpy.mockRestore()
    })

    it('setDarwinEscape: a thrown require/register error is caught and logged', async () => {
      require.cache[resolvedElectron] = {
        id: resolvedElectron,
        filename: resolvedElectron,
        loaded: true,
        get exports(): never {
          throw new Error('electron unavailable')
        }
      } as unknown as NodeModule
      const kl = await loadDarwin()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => kl.enableEscape(true)).not.toThrow()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('setDarwinEscape: a thrown non-Error value is still logged', async () => {
      require.cache[resolvedElectron] = {
        id: resolvedElectron,
        filename: resolvedElectron,
        loaded: true,
        get exports(): never {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'electron broke'
        }
      } as unknown as NodeModule
      const kl = await loadDarwin()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      kl.enableEscape(true)
      expect(warnSpy).toHaveBeenCalledWith('[keys] Escape shortcut error:', 'electron broke')
      warnSpy.mockRestore()
    })

    it('registered Escape shortcut callback emits escape-down', async () => {
      const kl = await loadDarwin()
      const onKey = vi.fn()
      kl.on('key', onKey)
      kl.enableEscape(true)
      const registeredCb = (registerMock.mock.calls[0] as unknown[])[1] as () => void
      registeredCb()
      expect(onKey).toHaveBeenCalledWith('escape-down')
    })
  })

  describe('non-darwin (win32/linux) platform', () => {
    it('start(): creates HookListener once, returns its result', async () => {
      const kl = await loadHook('win32')
      expect(kl.start()).toBe(true)
      expect(HookListenerMock).toHaveBeenCalledTimes(1)
      kl.start()
      expect(HookListenerMock).toHaveBeenCalledTimes(1)
    })

    it('start(): hook failing to start emits health=false', async () => {
      const kl = await loadHook('linux')
      hookInstances.length = 0
      HookListenerMock.mockImplementationOnce(function (cb: any) {
        const inst = { cb, start: vi.fn(() => false), stop: vi.fn(), isRunning: vi.fn(() => false) }
        hookInstances.push(inst)
        return inst
      })
      const healthSpy = vi.fn()
      kl.on('health', healthSpy)
      expect(kl.start()).toBe(false)
      expect(healthSpy).toHaveBeenCalledWith(false)
    })

    it('isRunning() reflects the hook listener', async () => {
      const kl = await loadHook()
      kl.start()
      expect(kl.isRunning()).toBe(true)
      hookInstances[0].isRunning.mockReturnValue(false)
      expect(kl.isRunning()).toBe(false)
    })

    it('stop() delegates to hook.stop()', async () => {
      const kl = await loadHook()
      kl.start()
      kl.stop()
      expect(hookInstances[0].stop).toHaveBeenCalledTimes(1)
    })

    it('command(): HEALTH resolves ok without a helper; other commands reject', async () => {
      const kl = await loadHook()
      await expect(kl.command('HEALTH')).resolves.toBe('ok')
      await expect(kl.command('PASTE')).rejects.toThrow('PASTE is darwin-only')
    })

    it('onDictationKey forwards to handleSingleKey honoring the configured binding', async () => {
      const kl = await loadHook('win32')
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      hookInstances[0].cb.onDictationKey('right-ctrl', true) // default win32 binding
      expect(onKey).toHaveBeenCalledWith('dictation-down')
    })

    it('onModifiers feeds the shared combo resolver', async () => {
      const kl = await loadHook('win32')
      kl.start()
      kl.setBinding({ type: 'combo', mods: ['ctrl', 'shift'] })
      const onKey = vi.fn()
      kl.on('key', onKey)
      hookInstances[0].cb.onModifiers(new Set(['ctrl', 'shift']))
      expect(onKey).toHaveBeenCalledWith('dictation-down')
      hookInstances[0].cb.onModifiers(new Set(['ctrl']))
      expect(onKey).toHaveBeenCalledWith('dictation-up')
    })

    it('onInstructionDown emits instruction-down directly (no pairing needed)', async () => {
      const kl = await loadHook('linux')
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      hookInstances[0].cb.onInstructionDown()
      expect(onKey).toHaveBeenCalledWith('instruction-down')
    })

    it('onEscape is gated by enableEscape and uses the passive uiohook feed (not globalShortcut)', async () => {
      const kl = await loadHook('linux')
      kl.start()
      const onKey = vi.fn()
      kl.on('key', onKey)
      hookInstances[0].cb.onEscape(true)
      expect(onKey).not.toHaveBeenCalled() // escape disabled by default
      kl.enableEscape(true)
      expect(registerMock).not.toHaveBeenCalled() // non-darwin never touches globalShortcut
      hookInstances[0].cb.onEscape(true)
      expect(onKey).toHaveBeenCalledWith('escape-down')
      hookInstances[0].cb.onEscape(false)
      expect(onKey).toHaveBeenCalledWith('escape-up')
      kl.enableEscape(false)
      hookInstances[0].cb.onEscape(true)
      expect(onKey).toHaveBeenCalledTimes(2) // no new call once disabled again
    })

    it('single-key handling is suppressed while a combo is configured', async () => {
      const kl = await loadHook('win32')
      kl.start()
      kl.setBinding({ type: 'combo', mods: ['ctrl', 'shift'] })
      const onKey = vi.fn()
      kl.on('key', onKey)
      hookInstances[0].cb.onDictationKey('right-ctrl', true)
      expect(onKey).not.toHaveBeenCalled()
    })
  })
})
