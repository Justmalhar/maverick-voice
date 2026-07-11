import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyAction } from './bindings'
import type { KeyEvent } from './listener'

// keys/listener.ts is the platform seam; keys/bindings.ts only consumes its
// normalized 'key' events and its setBinding() setter, so a plain
// EventEmitter stub is a faithful double.
vi.mock('./listener', () => {
  const emitter = new EventEmitter() as EventEmitter & { setBinding: ReturnType<typeof vi.fn> }
  emitter.setBinding = vi.fn()
  return { keyListener: emitter }
})

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}
const REAL_PLATFORM = process.platform

describe('keys/bindings.ts — KeyBindings FSM', () => {
  let keyListener: EventEmitter & { setBinding: ReturnType<typeof vi.fn> }
  let keyBindings: typeof import('./bindings').keyBindings
  let actions: KeyAction[]

  async function load(platform: string = 'darwin') {
    setPlatform(platform)
    vi.resetModules()
    const listenerMod = await import('./listener')
    keyListener = listenerMod.keyListener as unknown as typeof keyListener
    // The './listener' mock factory is registered once and its emitter
    // persists across vi.resetModules() calls (only bindings.ts's own module
    // — and thus its KeyBindings singleton — is actually torn down and
    // recreated). Without this, every previous test's KeyBindings instance
    // stays subscribed to 'key' on the same shared emitter forever, so a
    // single press() would fan out to every past instance too.
    keyListener.removeAllListeners('key')
    keyListener.setBinding.mockClear()
    const bindingsMod = await import('./bindings')
    keyBindings = bindingsMod.keyBindings
    actions = []
    keyBindings.on('action', (a: KeyAction) => actions.push(a))
  }

  function press(e: KeyEvent): void {
    keyListener.emit('key', e)
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setPlatform(REAL_PLATFORM)
  })

  describe('binding / activation-mode / instruction accessors', () => {
    it('getBinding()/setBinding() is the one source of truth and pushes to keyListener', async () => {
      await load()
      expect(keyBindings.getBinding()).toEqual({ type: 'key', key: 'fn' })
      keyBindings.setBinding({ type: 'key', key: 'right-option' })
      expect(keyBindings.getBinding()).toEqual({ type: 'key', key: 'right-option' })
      expect(keyListener.setBinding).toHaveBeenCalledWith({ type: 'key', key: 'right-option' })
    })

    it('non-darwin default binding is right-ctrl', async () => {
      await load('win32')
      expect(keyBindings.getBinding()).toEqual({ type: 'key', key: 'right-ctrl' })
    })

    it('getActivationMode() defaults to tap-toggle; setActivationMode() updates it', async () => {
      await load()
      expect(keyBindings.getActivationMode()).toBe('tap-toggle')
      keyBindings.setActivationMode('push-to-talk')
      expect(keyBindings.getActivationMode()).toBe('push-to-talk')
    })

    it('getInstructionEnabled() defaults false; setInstructionEnabled(true/false)', async () => {
      await load()
      expect(keyBindings.getInstructionEnabled()).toBe(false)
      keyBindings.setInstructionEnabled(true)
      expect(keyBindings.getInstructionEnabled()).toBe(true)
    })

    it('setInstructionEnabled(false) while an instruction session is active drops instructionActive', async () => {
      await load()
      keyBindings.setInstructionEnabled(true)
      press('instruction-down') // session-start instruction
      expect(actions).toEqual([{ type: 'session-start', mode: 'instruction' }])
      keyBindings.setInstructionEnabled(false)
      // Instruction is now disabled AND its active flag was cleared — a fresh
      // instruction-down is ignored outright (disabled), and dictation no
      // longer sees a "stale" active instruction to chain-stop from.
      actions = []
      press('dictation-down')
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
    })

    it('setInstructionEnabled(false) with no active instruction session is a no-op flag flip', async () => {
      await load()
      keyBindings.setInstructionEnabled(true)
      keyBindings.setInstructionEnabled(false)
      expect(keyBindings.getInstructionEnabled()).toBe(false)
    })
  })

  describe('resetState()', () => {
    it('clears dictation/instruction active flags and debounce timestamps but not persisted settings', async () => {
      await load()
      keyBindings.setInstructionEnabled(true)
      keyBindings.setActivationMode('push-to-talk')
      press('dictation-down') // dictationActive = true
      keyBindings.resetState()
      actions = []
      // dictationActive was reset, so a fresh push-to-talk down starts anew.
      press('dictation-down')
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
      // Persisted settings survive resetState().
      expect(keyBindings.getInstructionEnabled()).toBe(true)
      expect(keyBindings.getActivationMode()).toBe('push-to-talk')
    })
  })

  describe('tap-toggle mode (default)', () => {
    it('down starts a session; down again stops it and expires the chain immediately', async () => {
      await load()
      press('dictation-down')
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
      actions = []
      vi.advanceTimersByTime(500) // clear debounce before the stop press
      press('dictation-down')
      expect(actions).toEqual([
        { type: 'session-stop', mode: 'dictation' },
        { type: 'chain-expired' }
      ])
    })

    it('key-up is ignored entirely in tap-toggle mode', async () => {
      await load()
      press('dictation-down')
      actions = []
      press('dictation-up')
      expect(actions).toEqual([])
    })

    it('debounces a rapid re-press after a stop (start only, not stop)', async () => {
      await load()
      press('dictation-down') // start
      vi.advanceTimersByTime(50)
      press('dictation-down') // stop (debounce never gates a stop)
      actions = []
      vi.advanceTimersByTime(50) // still within 300ms of the stop timestamp
      press('dictation-down') // would-be start — debounced
      expect(actions).toEqual([])
      vi.advanceTimersByTime(300)
      press('dictation-down') // now proceeds
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
    })
  })

  describe('push-to-talk mode', () => {
    beforeEach(async () => {
      await load()
      keyBindings.setActivationMode('push-to-talk')
      actions = []
    })

    it('down starts, a repeated down while active is a no-op, up stops', () => {
      press('dictation-down')
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
      actions = []
      press('dictation-down') // already active — early return
      expect(actions).toEqual([])
      press('dictation-up')
      expect(actions).toEqual([
        { type: 'session-stop', mode: 'dictation' },
        { type: 'chain-expired' }
      ])
    })

    it('up while not active is a no-op', () => {
      press('dictation-up')
      expect(actions).toEqual([])
    })

    it('debounces a rapid re-start after a stop', () => {
      press('dictation-down')
      press('dictation-up')
      actions = []
      vi.advanceTimersByTime(50)
      press('dictation-down') // within DEBOUNCE_MS of last toggle — debounced
      expect(actions).toEqual([])
      vi.advanceTimersByTime(300)
      press('dictation-down')
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
    })
  })

  describe('instruction toggle (Caps Lock) — requires instructionEnabled', () => {
    beforeEach(async () => {
      await load()
      actions = []
    })

    it('is ignored entirely while instruction mode is disabled', () => {
      press('instruction-down')
      expect(actions).toEqual([])
    })

    it('starts an instruction session on first press', () => {
      keyBindings.setInstructionEnabled(true)
      press('instruction-down')
      expect(actions).toEqual([{ type: 'session-start', mode: 'instruction' }])
    })

    it('stops an active instruction session and expires the chain immediately', () => {
      keyBindings.setInstructionEnabled(true)
      press('instruction-down')
      actions = []
      vi.advanceTimersByTime(400)
      press('instruction-down')
      expect(actions).toEqual([
        { type: 'session-stop', mode: 'instruction' },
        { type: 'chain-expired' }
      ])
    })

    it('debounces a rapid re-press', () => {
      keyBindings.setInstructionEnabled(true)
      press('instruction-down')
      actions = []
      vi.advanceTimersByTime(50)
      press('instruction-down') // < 300ms — debounced
      expect(actions).toEqual([])
    })

    it('dictation active -> instruction is a direct chain (stop dictation, chain-start instruction)', () => {
      keyBindings.setInstructionEnabled(true)
      press('dictation-down')
      actions = []
      vi.advanceTimersByTime(400)
      press('instruction-down')
      expect(actions).toEqual([
        { type: 'session-stop', mode: 'dictation' },
        { type: 'chain-start', mode: 'instruction' }
      ])
    })

    it('instruction active -> dictation is a direct chain (stop instruction, chain-start dictation)', () => {
      keyBindings.setInstructionEnabled(true)
      press('instruction-down')
      actions = []
      vi.advanceTimersByTime(400)
      press('dictation-down')
      expect(actions).toEqual([
        { type: 'session-stop', mode: 'instruction' },
        { type: 'chain-start', mode: 'dictation' }
      ])
    })
  })

  describe('chain-window branches (wasChainPending) — _chainPending is never set true by any', () => {
    // reachable public-API path (confirmed by reading bindings.ts end to end):
    // it is declared, reset to false in resetState()/wasChainPending(), and
    // read back — but no code path ever assigns it true. Per INTERFACES.md
    // this is intentionally "ported verbatim; latent in v1's final chain
    // design ... nothing arms the timed window". We exercise the 'chain' and
    // 'same-mode-restart' branches directly by poking the private fields,
    // documenting the contrivance rather than leaving the branch un-asserted.
    it('dictation: a pending chain into the SAME mode expires immediately (same-mode-restart)', async () => {
      await load()
      actions = []
      ;(keyBindings as any)._chainPending = true
      ;(keyBindings as any)._chainMode = 'dictation'
      press('dictation-down')
      expect(actions).toEqual([{ type: 'chain-expired' }])
    })

    it('dictation: a pending chain into a DIFFERENT mode starts a chained dictation session', async () => {
      await load()
      actions = []
      ;(keyBindings as any)._chainPending = true
      ;(keyBindings as any)._chainMode = 'instruction'
      press('dictation-down')
      expect(actions).toEqual([{ type: 'chain-start', mode: 'dictation' }])
    })

    it('instruction: a pending chain into the SAME mode expires immediately (same-mode-restart)', async () => {
      await load()
      keyBindings.setInstructionEnabled(true)
      actions = []
      ;(keyBindings as any)._chainPending = true
      ;(keyBindings as any)._chainMode = 'instruction'
      press('instruction-down')
      expect(actions).toEqual([{ type: 'chain-expired' }])
    })

    it('instruction: a pending chain into a DIFFERENT mode starts a chained instruction session', async () => {
      await load()
      keyBindings.setInstructionEnabled(true)
      actions = []
      ;(keyBindings as any)._chainPending = true
      ;(keyBindings as any)._chainMode = 'dictation'
      press('instruction-down')
      expect(actions).toEqual([{ type: 'chain-start', mode: 'instruction' }])
    })

    it('clearChainTimer() clears an armed chainTimer (contrived — chainTimer is never armed by any reachable path)', async () => {
      // `chainTimer` is declared and cleared throughout the file but no code
      // path ever calls setTimeout to assign it — same "ported verbatim,
      // latent" situation as _chainPending. Poke a real timer handle in so
      // the `if (this.chainTimer)` true branch has something to clear.
      await load()
      const handle = setTimeout(() => {}, 10_000)
      ;(keyBindings as any).chainTimer = handle
      press('dictation-down') // startDictation() calls clearChainTimer()
      expect((keyBindings as any).chainTimer).toBeNull()
      clearTimeout(handle)
    })
  })

  describe('escape', () => {
    it('escape-down emits cancel', async () => {
      await load()
      actions = []
      press('escape-down')
      expect(actions).toEqual([{ type: 'cancel' }])
    })

    it('escape-up is a no-op', async () => {
      await load()
      actions = []
      press('escape-up')
      expect(actions).toEqual([])
    })
  })

  describe('double-tap-push (dual) mode', () => {
    beforeEach(async () => {
      await load()
      keyBindings.setActivationMode('double-tap-push')
      actions = []
    })

    it('idle -> down starts the hold timer; expiring it (no release) starts push-recording dictation', () => {
      press('dictation-down')
      expect(actions).toEqual([]) // still just "held", nothing emitted yet
      vi.advanceTimersByTime(400)
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
    })

    it('held -> up before the hold timer fires arms the double-tap window (awaiting-second)', () => {
      press('dictation-down')
      press('dictation-up')
      expect(actions).toEqual([]) // nothing yet — awaiting a possible second tap
      vi.advanceTimersByTime(400) // window expires — no double tap arrived
      expect(actions).toEqual([]) // back to idle, silently
    })

    it('awaiting-second -> down within the window starts hands-free dictation (double-tap)', () => {
      press('dictation-down')
      press('dictation-up') // -> awaiting-second
      vi.advanceTimersByTime(200)
      press('dictation-down') // second tap within DUAL_DOUBLE_TAP_MS
      expect(actions).toEqual([{ type: 'session-start', mode: 'dictation' }])
    })

    it('hands-free -> down stops dictation (tap to stop); up in hands-free is a no-op', () => {
      press('dictation-down')
      press('dictation-up')
      press('dictation-down') // hands-free
      actions = []
      press('dictation-up') // no-op per handleDualModeUp's 'hands-free' case
      expect(actions).toEqual([])
      press('dictation-down') // hands-free -> idle, stop
      expect(actions).toEqual([
        { type: 'session-stop', mode: 'dictation' },
        { type: 'chain-expired' }
      ])
    })

    it('push-recording -> up stops dictation (released)', () => {
      press('dictation-down')
      vi.advanceTimersByTime(400) // held -> push-recording, startDictation
      actions = []
      press('dictation-up')
      expect(actions).toEqual([
        { type: 'session-stop', mode: 'dictation' },
        { type: 'chain-expired' }
      ])
    })

    it('setActivationMode() switching away clears an armed hold timer (no stray session-start)', () => {
      press('dictation-down') // held, hold timer armed
      keyBindings.setActivationMode('tap-toggle')
      vi.advanceTimersByTime(1000)
      expect(actions).toEqual([]) // the stale 400ms hold timer never fires
    })

    it('setActivationMode() switching away clears an armed double-tap timer', () => {
      press('dictation-down')
      press('dictation-up') // awaiting-second, double-tap timer armed
      keyBindings.setActivationMode('push-to-talk')
      vi.advanceTimersByTime(1000)
      expect(actions).toEqual([]) // no stray hands-free start
    })

    it('default branches: a down while already "held" (unexpected repeat) is a no-op', () => {
      press('dictation-down') // -> held
      actions = []
      ;(keyBindings as any).dualState = 'held' // still held (defensive, matches real state)
      press('dictation-down') // handleDualModeDown has no 'held' case -> default: break
      expect(actions).toEqual([])
    })

    it('default branches: an up while idle is a no-op', () => {
      // Never entered 'held'/'awaiting-second'/'push-recording' — dualState is 'idle'.
      press('dictation-up')
      expect(actions).toEqual([])
    })

    it('hold timer firing after dualState already moved on is a no-op (contrived)', () => {
      // Every reachable path that leaves 'held' also cancels dualHoldTimer via
      // clearDualTimers(), so the timer callback's own `dualState === 'held'`
      // re-check never sees a stale timer in practice. Poke dualState away
      // without touching the timer to exercise that defensive guard.
      press('dictation-down') // idle -> held, arms the 400ms hold timer
      ;(keyBindings as any).dualState = 'push-recording'
      actions = []
      vi.advanceTimersByTime(400) // stale timer fires, guard skips startDictation()
      expect(actions).toEqual([])
    })

    it('double-tap timer firing after dualState already moved on is a no-op (contrived)', () => {
      press('dictation-down')
      press('dictation-up') // held -> awaiting-second, arms the 400ms double-tap timer
      ;(keyBindings as any).dualState = 'hands-free'
      actions = []
      vi.advanceTimersByTime(400) // stale timer fires, guard skips resetting to idle
      expect((keyBindings as any).dualState).toBe('hands-free')
    })

    it('idle debounce guard: an idle re-press within DEBOUNCE_MS of the last toggle is dropped (contrived)', () => {
      // Reaching 'idle' with a *recent* lastDictationToggleTime is otherwise
      // unreachable — every real transition back to 'idle' either happens via
      // resetState() (which also zeroes the debounce timestamp) or leaves
      // dualState in 'awaiting-second' until its own timer fires. Poking
      // dualState directly reproduces "idle, but a press just happened"
      // without inventing new source behavior.
      press('dictation-down') // idle -> held; sets lastDictationToggleTime = now
      ;(keyBindings as any).dualState = 'idle'
      actions = []
      press('dictation-down') // now - lastDictationToggleTime is ~0ms < DEBOUNCE_MS
      expect(actions).toEqual([])
    })
  })
})
