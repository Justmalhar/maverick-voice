import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const onMock = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { on: (...a: unknown[]) => onMock(...a) }
}))

const ORIGINAL_CONSOLE = { log: console.log, warn: console.warn, error: console.error }
let tmpHome: string

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => tmpHome }, homedir: () => tmpHome }
})

function logDir(): string {
  return path.join(tmpHome, '.maverick-voice', 'logs')
}

function todayFile(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return path.join(logDir(), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`)
}

describe('electron/logger', () => {
  beforeEach(() => {
    vi.resetModules()
    onMock.mockReset()
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-logger-'))
  })
  afterEach(() => {
    console.log = ORIGINAL_CONSOLE.log
    console.warn = ORIGINAL_CONSOLE.warn
    console.error = ORIGINAL_CONSOLE.error
    process.removeAllListeners('uncaughtExceptionMonitor')
    process.removeAllListeners('unhandledRejection')
    fs.rmSync(tmpHome, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('initLogger creates the log dir + file and mirrors console.log to it', async () => {
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    console.log('hello from test')
    closeLogger()
    await new Promise((r) => setTimeout(r, 20))
    const content = fs.readFileSync(todayFile(), 'utf8')
    expect(content).toContain('[log] hello from test')
  })

  it('still calls the original console method (visible output preserved)', async () => {
    // Spy BEFORE initLogger() so the module captures this spy as "original"
    // when it hooks console.log — proving the hook still forwards to it.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    console.log('still prints')
    closeLogger()
    expect(spy).toHaveBeenCalledWith('still prints')
  })

  it('serializes Error objects (stack) and JSON-serializable objects; falls back to String() otherwise', async () => {
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    console.warn(new Error('boom'))
    console.error({ a: 1 })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    console.log(circular)
    closeLogger()
    await new Promise((r) => setTimeout(r, 20))
    const content = fs.readFileSync(todayFile(), 'utf8')
    expect(content).toContain('Error: boom')
    expect(content).toContain('{"a":1}')
    expect(content).toContain('[object Object]')
  })

  it('serializes an Error with no stack by falling back to its message', async () => {
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    const noStack = new Error('stackless')
    noStack.stack = undefined
    console.warn(noStack)
    closeLogger()
    await new Promise((r) => setTimeout(r, 20))
    const content = fs.readFileSync(todayFile(), 'utf8')
    expect(content).toContain('stackless')
  })

  it('cleanupOldLogs swallows an unlink rejection (fire-and-forget)', async () => {
    fs.mkdirSync(logDir(), { recursive: true })
    const oldDate = new Date(Date.now() - 40 * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const oldName = `${oldDate.getFullYear()}-${pad(oldDate.getMonth() + 1)}-${pad(oldDate.getDate())}.log`
    fs.writeFileSync(path.join(logDir(), oldName), 'stale')
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockRejectedValue(new Error('EBUSY'))
    const { initLogger, closeLogger } = await import('./logger')
    expect(() => initLogger()).not.toThrow()
    closeLogger()
    await new Promise((r) => setTimeout(r, 30))
    expect(unlinkSpy).toHaveBeenCalled()
  })

  it('cleanupOldLogs swallows a readdir rejection (fire-and-forget)', async () => {
    const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockRejectedValue(new Error('EACCES') as never)
    const { initLogger, closeLogger } = await import('./logger')
    expect(() => initLogger()).not.toThrow()
    closeLogger()
    await new Promise((r) => setTimeout(r, 30))
    expect(readdirSpy).toHaveBeenCalled()
  })

  it('registers the IPC.LOG_WRITE handler that writes renderer messages, defaulting an invalid level to log', async () => {
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    const handler = onMock.mock.calls.find((c) => typeof c[1] === 'function')?.[1] as (
      e: unknown,
      level: unknown,
      message: unknown
    ) => void
    expect(handler).toBeTypeOf('function')
    handler(null, 'warn', 'renderer said hi')
    handler(null, 'not-a-level', 'defaults to log')
    handler(null, 'error', 12345) // non-string message is ignored
    closeLogger()
    await new Promise((r) => setTimeout(r, 20))
    const content = fs.readFileSync(todayFile(), 'utf8')
    expect(content).toContain('[renderer] renderer said hi')
    expect(content).toContain('[renderer] defaults to log')
    expect(content).not.toContain('12345')
  })

  it('truncates an overly long renderer message to 2000 chars', async () => {
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    const handler = onMock.mock.calls.find((c) => typeof c[1] === 'function')?.[1] as (
      e: unknown,
      level: unknown,
      message: unknown
    ) => void
    handler(null, 'log', 'x'.repeat(3000))
    closeLogger()
    await new Promise((r) => setTimeout(r, 20))
    const content = fs.readFileSync(todayFile(), 'utf8')
    const line = content.split('\n').find((l) => l.includes('[renderer]'))!
    expect(line.length).toBeLessThan(2100)
  })

  it('degrades to console-only when mkdirSync throws (no log dir writable)', async () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('EACCES')
    })
    const { initLogger } = await import('./logger')
    expect(() => initLogger()).not.toThrow()
    expect(() => console.log('should not throw even without a stream')).not.toThrow()
  })

  it('write() is a no-op before the stream exists (mkdirSync failure path exercised via initLogger)', async () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('EACCES')
    })
    const { initLogger } = await import('./logger')
    initLogger()
    expect(() => console.error('no stream, no crash')).not.toThrow()
  })

  it('degrades to console-only if the write stream errors out', async () => {
    // Pre-create the exact log-file path AS A DIRECTORY so the write stream
    // fails to open it and emits 'error' — the module must swallow this and
    // keep working console-only, never throwing into caller code.
    fs.mkdirSync(logDir(), { recursive: true })
    fs.mkdirSync(todayFile())
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    await new Promise((r) => setTimeout(r, 20))
    expect(() => console.log('should not throw despite the stream error')).not.toThrow()
    closeLogger()
  })

  it('cleanupOldLogs deletes files older than the retention window and ignores non-matching names', async () => {
    fs.mkdirSync(logDir(), { recursive: true })
    const oldDate = new Date(Date.now() - 40 * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const oldName = `${oldDate.getFullYear()}-${pad(oldDate.getMonth() + 1)}-${pad(oldDate.getDate())}.log`
    fs.writeFileSync(path.join(logDir(), oldName), 'stale')
    fs.writeFileSync(path.join(logDir(), 'not-a-log-file.txt'), 'irrelevant')

    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    closeLogger()
    await new Promise((r) => setTimeout(r, 30))
    expect(fs.existsSync(path.join(logDir(), oldName))).toBe(false)
    expect(fs.existsSync(path.join(logDir(), 'not-a-log-file.txt'))).toBe(true)
  })

  it('rotates to a new day file when the local date changes between writes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T23:59:59'))
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    console.log('day one')
    vi.setSystemTime(new Date('2026-01-02T00:00:01'))
    console.log('day two')
    closeLogger()
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 20))
    const files = fs.readdirSync(logDir()).filter((f) => f.endsWith('.log'))
    expect(files.sort()).toEqual(['2026-01-01.log', '2026-01-02.log'])
  })

  it('closeLogger is safe to call when never initialized (or twice)', async () => {
    const { closeLogger } = await import('./logger')
    expect(() => closeLogger()).not.toThrow()
    expect(() => closeLogger()).not.toThrow()
  })

  it('uncaughtExceptionMonitor writes a fatal line; unhandledRejection logs via console.error', async () => {
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    const errSpy = vi.spyOn(ORIGINAL_CONSOLE, 'error')
    process.emit('unhandledRejection', new Error('rejected'), Promise.resolve())
    ;(process.emit as (event: string, ...args: unknown[]) => boolean)(
      'uncaughtExceptionMonitor',
      new Error('fatal crash'),
      'uncaughtException'
    )
    closeLogger()
    await new Promise((r) => setTimeout(r, 20))
    const content = fs.readFileSync(todayFile(), 'utf8')
    expect(content).toContain('[fatal]')
    expect(content).toContain('fatal crash')
    errSpy.mockRestore()
  })

  it('unhandledRejection with a non-Error reason is stringified', async () => {
    const { initLogger, closeLogger } = await import('./logger')
    initLogger()
    process.emit('unhandledRejection', 'plain string rejection' as unknown as Error, Promise.resolve())
    closeLogger()
    await new Promise((r) => setTimeout(r, 20))
    const content = fs.readFileSync(todayFile(), 'utf8')
    expect(content).toContain('unhandled rejection')
  })
})
