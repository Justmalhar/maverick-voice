import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
const existsSyncMock = vi.fn()
const chmodSyncMock = vi.fn()

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/dev/app-path' }
}))
vi.mock('fs', () => ({
  default: {
    existsSync: (...a: unknown[]) => existsSyncMock(...a),
    chmodSync: (...a: unknown[]) => chmodSyncMock(...a)
  },
  existsSync: (...a: unknown[]) => existsSyncMock(...a),
  chmodSync: (...a: unknown[]) => chmodSyncMock(...a)
}))

import { DarwinHelper, type DarwinCallbacks } from './listenerDarwin'

function makeFakeProc() {
  const proc: any = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = new EventEmitter() as any
  proc.stdin.write = vi.fn((_data: string, cb?: (err?: Error) => void) => cb?.())
  proc.killed = false
  proc.kill = vi.fn(() => {
    proc.killed = true
  })
  return proc
}

describe('listenerDarwin.DarwinHelper', () => {
  let procs: any[]
  let cb: DarwinCallbacks
  let onToken: ReturnType<typeof vi.fn>
  let onAlive: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    procs = []
    spawnMock.mockReset()
    existsSyncMock.mockReset()
    chmodSyncMock.mockReset()
    existsSyncMock.mockReturnValue(true) // first candidate (resourcesPath) found
    spawnMock.mockImplementation(() => {
      const p = makeFakeProc()
      procs.push(p)
      return p
    })
    onToken = vi.fn()
    onAlive = vi.fn()
    cb = { onToken, onAlive } as unknown as DarwinCallbacks
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('binaryPath: uses first existing candidate and spawns', () => {
    const helper = new DarwinHelper(cb)
    const ok = helper.start()
    expect(ok).toBe(true)
    expect(chmodSyncMock).toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(onAlive).toHaveBeenCalledWith(true)
    expect(helper.isRunning()).toBe(true)
  })

  it('binaryPath: falls back through candidates, none found -> spawnHelper fails', () => {
    existsSyncMock.mockReturnValue(false)
    const helper = new DarwinHelper(cb)
    const ok = helper.start()
    expect(ok).toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(helper.isRunning()).toBe(false)
  })

  it('binaryPath: second candidate found (app.getAppPath) when first missing', () => {
    existsSyncMock.mockImplementation((p: string) => p.includes('/dev/app-path'))
    const helper = new DarwinHelper(cb)
    expect(helper.start()).toBe(true)
  })

  it('chmodSync throwing is swallowed (read-only signed bundle)', () => {
    chmodSyncMock.mockImplementation(() => {
      throw new Error('EROFS')
    })
    const helper = new DarwinHelper(cb)
    expect(helper.start()).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('stdout: partial-line carry across chunks', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    proc.stdout.emit('data', Buffer.from('FN_DO'))
    expect(onToken).not.toHaveBeenCalled()
    proc.stdout.emit('data', Buffer.from('WN\nFN_UP\npartial'))
    expect(onToken).toHaveBeenNthCalledWith(1, 'FN_DOWN')
    expect(onToken).toHaveBeenNthCalledWith(2, 'FN_UP')
    expect(onToken).toHaveBeenCalledTimes(2)
    proc.stdout.emit('data', Buffer.from('_line\n'))
    expect(onToken).toHaveBeenNthCalledWith(3, 'partial_line')
  })

  it('stdout: blank lines (double newline) are skipped, not forwarded as empty tokens', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    proc.stdout.emit('data', Buffer.from('FN_DOWN\n\nFN_UP\n'))
    expect(onToken).toHaveBeenNthCalledWith(1, 'FN_DOWN')
    expect(onToken).toHaveBeenNthCalledWith(2, 'FN_UP')
    expect(onToken).toHaveBeenCalledTimes(2)
  })

  it('stdout: reply lines settle pending commands and are not forwarded as tokens', async () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    const p = helper.command('PASTE')
    proc.stdout.emit('data', Buffer.from('PASTE_OK\n'))
    await expect(p).resolves.toBe('PASTE_OK')
    expect(onToken).not.toHaveBeenCalled()
  })

  it('stdout: prefix-matched reply (FRONTAPP:, HEALTH:) with suffix content', async () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    const p = helper.command('FRONTAPP')
    proc.stdout.emit('data', Buffer.from('FRONTAPP:123|Notes\n'))
    await expect(p).resolves.toBe('FRONTAPP:123|Notes')

    const p2 = helper.command('HEALTH')
    proc.stdout.emit('data', Buffer.from('HEALTH:OK\n'))
    await expect(p2).resolves.toBe('HEALTH:OK')
  })

  it('settle(): a reply line with no matching pending command is a no-op', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    expect(() => proc.stdout.emit('data', Buffer.from('PASTE_OK\n'))).not.toThrow()
    expect(onToken).not.toHaveBeenCalled()
  })

  it('stderr data is logged, not forwarded', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    proc.stderr.emit('data', Buffer.from('warning: something\n'))
    expect(errSpy).toHaveBeenCalled()
    expect(onToken).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('swallows EPIPE on stdout/stderr/stdin error, logs other codes', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const epipe: NodeJS.ErrnoException = Object.assign(new Error('epipe'), { code: 'EPIPE' })
    proc.stdout.emit('error', epipe)
    proc.stderr.emit('error', epipe)
    proc.stdin && proc.stdin.emit && proc.stdin.emit('error', epipe)
    expect(errSpy).not.toHaveBeenCalled()
    const other: NodeJS.ErrnoException = Object.assign(new Error('boom'), { code: 'EOTHER' })
    proc.stdout.emit('error', other)
    expect(errSpy).toHaveBeenCalledWith('[keys] mac-helper pipe error:', 'boom')
    errSpy.mockRestore()
  })

  it('death via "error" event schedules exponential backoff restart, cleared by explicit start()', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc1 = procs[0]
    proc1.emit('error', new Error('crashed'))
    expect(onAlive).toHaveBeenLastCalledWith(false)
    expect(helper.isRunning()).toBe(false)

    // Backoff scheduled at BACKOFF_BASE_MS (2000ms) * 2^0
    vi.advanceTimersByTime(2000)
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(onAlive).toHaveBeenLastCalledWith(true)

    // Second death -> backoff doubles (4000ms)
    const proc2 = procs[1]
    proc2.emit('exit', 1)
    vi.advanceTimersByTime(3999)
    expect(spawnMock).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(spawnMock).toHaveBeenCalledTimes(3)

    // Explicit start() clears the latch/backoff attempts and any pending timer
    proc1.removeAllListeners()
    const proc3 = procs[2]
    proc3.emit('exit', 1)
    helper.start()
    expect(spawnMock).toHaveBeenCalledTimes(4)
    vi.advanceTimersByTime(30_000)
    // no extra spawn from the stale pre-start() restart timer
    expect(spawnMock).toHaveBeenCalledTimes(4)
  })

  it('handleDeath is idempotent when both "error" and "exit" fire for the same process', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    proc.emit('error', new Error('x'))
    expect(onAlive).toHaveBeenCalledTimes(2) // true (start) + false (death)
    proc.emit('exit', 1)
    // Second death signal for the SAME already-nulled proc must be a no-op.
    expect(onAlive).toHaveBeenCalledTimes(2)
  })

  it('stop(): kills proc, rejects pending, prevents restart scheduling', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    const pending = helper.command('PASTE')
    helper.stop()
    expect(proc.kill).toHaveBeenCalled()
    return expect(pending).rejects.toThrow('mac-helper stopped')
  })

  it('stop() while a restart backoff timer is pending clears it (no zombie restart)', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    proc.emit('exit', 1) // schedules a restart timer
    helper.stop()
    vi.advanceTimersByTime(60_000)
    expect(spawnMock).toHaveBeenCalledTimes(1) // only the original spawn, no restart
  })

  it('stop() then a late exit event on the old proc does not restart', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    helper.stop()
    proc.emit('exit', 0) // stale event on the already-detached proc
    vi.advanceTimersByTime(60_000)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('isRunning(): false when proc has no stdin or is killed', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    proc.stdin = null
    expect(helper.isRunning()).toBe(false)
    proc.stdin = { write: vi.fn() }
    proc.killed = true
    expect(helper.isRunning()).toBe(false)
  })

  it('command(): dedups in-flight calls for the same cmd', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    const p1 = helper.command('PASTE')
    const p2 = helper.command('PASTE')
    expect(p1).toBe(p2)
    expect(proc.stdin.write).toHaveBeenCalledTimes(1)
  })

  it('command(): rejects immediately when helper is not running', async () => {
    const helper = new DarwinHelper(cb) // never started
    await expect(helper.command('HEALTH')).rejects.toThrow('mac-helper not running')
  })

  it('command(): times out after TIMEOUTS.helperCommand with no reply', async () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const p = helper.command('PASTE')
    const assertion = expect(p).rejects.toThrow(/timed out after/)
    vi.advanceTimersByTime(500)
    await assertion
  })

  it('command(): stdin.write callback error rejects with that error, not a timeout', async () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    proc.stdin.write = vi.fn((_d: string, cb2: (err?: Error) => void) => cb2(new Error('EPIPE write')))
    const p = helper.command('COPY')
    await expect(p).rejects.toThrow('EPIPE write')
  })

  it('rejectAllPending: multiple distinct cmds all reject on stop()', async () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const p1 = helper.command('PASTE')
    const p2 = helper.command('COPY')
    helper.stop()
    await expect(p1).rejects.toThrow(/PASTE:/)
    await expect(p2).rejects.toThrow(/COPY:/)
  })

  it('handleDeath short-circuits when already stopping (no restart scheduled)', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    // Contrived: force the internal `stopping` latch without going through
    // stop() (which would also null out `this.proc` and mask this branch).
    ;(helper as any).stopping = true
    proc.emit('exit', 0)
    vi.advanceTimersByTime(60_000)
    expect(spawnMock).toHaveBeenCalledTimes(1) // no restart scheduled
  })

  it('restart timer callback also re-checks stopping when it fires', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const proc = procs[0]
    proc.emit('exit', 1) // schedules the restart timer (stopping still false)
    // Contrived: flip the latch after scheduling but before the timer fires,
    // without routing through stop() (which would also clear the timer and
    // mask this specific re-check inside the callback).
    ;(helper as any).stopping = true
    vi.advanceTimersByTime(2000)
    expect(spawnMock).toHaveBeenCalledTimes(1) // callback's own guard skipped the respawn
  })

  it('settle(): reject fallback constructs its own Error when none is supplied', () => {
    const helper = new DarwinHelper(cb)
    helper.start()
    const p = helper.command('PASTE')
    // Contrived: exercise the `err ?? new Error(...)` fallback directly —
    // every real call site that rejects always passes an err, so this
    // branch is otherwise unreachable through the public API.
    ;(helper as any).settle('PASTE', undefined, undefined)
    return expect(p).rejects.toThrow('PASTE failed')
  })
})
