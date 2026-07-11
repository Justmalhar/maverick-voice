import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promisify } from 'node:util'

// frontmostApp.ts computes `execFileAsync = promisify(execFile)` at module load.
// Node's execFile ships a `[promisify.custom]` implementation, so as long as our
// mock also defines that symbol, `promisify(execFile)` resolves to exactly that
// function reference — letting us fully control every execFile-based path.
const execFileCustom = vi.fn()
vi.mock('node:child_process', () => {
  const fn = vi.fn() as unknown as { (...a: unknown[]): unknown }
  ;(fn as any)[promisify.custom] = (...args: unknown[]) => execFileCustom(...args)
  return { execFile: fn }
})

import { getFrontmostApp } from './frontmostApp'

const ORIGINAL_PLATFORM = process.platform
const ORIGINAL_SESSION_TYPE = process.env.XDG_SESSION_TYPE

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  process.env.XDG_SESSION_TYPE = ORIGINAL_SESSION_TYPE
  execFileCustom.mockReset()
  vi.useRealTimers()
})

describe('getFrontmostApp — darwin', () => {
  beforeEach(() => setPlatform('darwin'))

  it('resolves via the helper command reply "id|name"', async () => {
    const helperCommand = vi.fn().mockResolvedValue('com.apple.mail|Mail')
    const result = await getFrontmostApp(helperCommand)
    expect(result).toEqual({ id: 'com.apple.mail', name: 'Mail' })
    expect(execFileCustom).not.toHaveBeenCalled()
  })

  it('tolerates a "FRONTAPP:" prefix on the helper reply', async () => {
    const helperCommand = vi.fn().mockResolvedValue('FRONTAPP:com.apple.mail|Mail')
    const result = await getFrontmostApp(helperCommand)
    expect(result).toEqual({ id: 'com.apple.mail', name: 'Mail' })
  })

  it('defaults name to id when the reply has no pipe', async () => {
    const helperCommand = vi.fn().mockResolvedValue('com.apple.mail')
    const result = await getFrontmostApp(helperCommand)
    expect(result).toEqual({ id: 'com.apple.mail', name: 'com.apple.mail' })
  })

  it('falls back to osascript when the helper reply parses to null (empty body)', async () => {
    const helperCommand = vi.fn().mockResolvedValue('   ')
    execFileCustom.mockResolvedValue({ stdout: 'com.apple.finder\n' })
    const result = await getFrontmostApp(helperCommand)
    expect(result).toEqual({ id: 'com.apple.finder', name: 'com.apple.finder' })
  })

  it('falls back to osascript when the helper command rejects', async () => {
    const helperCommand = vi.fn().mockRejectedValue(new Error('helper down'))
    execFileCustom.mockResolvedValue({ stdout: 'com.apple.finder' })
    const result = await getFrontmostApp(helperCommand)
    expect(result).toEqual({ id: 'com.apple.finder', name: 'com.apple.finder' })
  })

  it('uses osascript directly when no helperCommand is provided', async () => {
    execFileCustom.mockResolvedValue({ stdout: 'com.apple.safari' })
    const result = await getFrontmostApp()
    expect(result).toEqual({ id: 'com.apple.safari', name: 'com.apple.safari' })
  })

  it('resolves null when osascript itself fails and yields empty stdout', async () => {
    execFileCustom.mockResolvedValue({ stdout: '' })
    const result = await getFrontmostApp()
    expect(result).toBeNull()
  })

  it('resolves null when osascript execFile rejects', async () => {
    execFileCustom.mockRejectedValue(new Error('osascript not found'))
    const result = await getFrontmostApp()
    expect(result).toBeNull()
  })

  it('resolves null (via the internal timeout guard) when detection hangs past the cap', async () => {
    vi.useFakeTimers()
    const helperCommand = vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
    const promise = getFrontmostApp(helperCommand)
    await vi.advanceTimersByTimeAsync(900)
    await expect(promise).resolves.toBeNull()
  })

  it('ignores a late resolution that arrives after the timeout guard already fired', async () => {
    vi.useFakeTimers()
    let resolveHelper: (v: string) => void = () => {}
    const helperCommand = vi.fn().mockReturnValue(new Promise((resolve) => { resolveHelper = resolve }))
    const promise = getFrontmostApp(helperCommand)
    await vi.advanceTimersByTimeAsync(900)
    await expect(promise).resolves.toBeNull()
    // Late settlement after the guard already resolved — must not throw / double-resolve.
    resolveHelper('com.apple.mail|Mail')
    await vi.advanceTimersByTimeAsync(10)
  })

  it('ignores a late rejection that arrives after the timeout guard already fired', async () => {
    vi.useFakeTimers()
    let rejectHelper: (e: Error) => void = () => {}
    const helperCommand = vi.fn().mockReturnValue(new Promise((_resolve, reject) => { rejectHelper = reject }))
    const promise = getFrontmostApp(helperCommand)
    await vi.advanceTimersByTimeAsync(900)
    await expect(promise).resolves.toBeNull()
    rejectHelper(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(10)
  })

  it('resolves before the timeout guard fires and later ignores the guard itself', async () => {
    vi.useFakeTimers()
    const helperCommand = vi.fn().mockResolvedValue('com.apple.mail|Mail')
    const promise = getFrontmostApp(helperCommand)
    await vi.advanceTimersByTimeAsync(0)
    await expect(promise).resolves.toEqual({ id: 'com.apple.mail', name: 'Mail' })
    // Let the (now-irrelevant) 800ms guard timer fire too — must be a no-op.
    await vi.advanceTimersByTimeAsync(900)
  })
})

describe('getFrontmostApp — win32', () => {
  beforeEach(() => setPlatform('win32'))

  it('parses "processName|windowTitle" and normalizes id to <name>.exe', async () => {
    execFileCustom.mockResolvedValue({ stdout: 'notepad|Untitled - Notepad' })
    const result = await getFrontmostApp()
    expect(result).toEqual({ id: 'notepad.exe', name: 'Untitled - Notepad' })
  })

  it('leaves an already-.exe process name untouched and falls back to processName when title is blank', async () => {
    execFileCustom.mockResolvedValue({ stdout: 'notepad.exe|' })
    const result = await getFrontmostApp()
    expect(result).toEqual({ id: 'notepad.exe', name: 'notepad.exe' })
  })

  it('resolves null when stdout is blank', async () => {
    execFileCustom.mockResolvedValue({ stdout: '  ' })
    const result = await getFrontmostApp()
    expect(result).toBeNull()
  })

  it('resolves null when powershell rejects', async () => {
    execFileCustom.mockRejectedValue(new Error('powershell missing'))
    const result = await getFrontmostApp()
    expect(result).toBeNull()
  })
})

describe('getFrontmostApp — linux', () => {
  beforeEach(() => setPlatform('linux'))

  it('resolves null immediately on a non-x11 session (no execFile calls)', async () => {
    process.env.XDG_SESSION_TYPE = 'wayland'
    const result = await getFrontmostApp()
    expect(result).toBeNull()
    expect(execFileCustom).not.toHaveBeenCalled()
  })

  it('resolves null when XDG_SESSION_TYPE is unset', async () => {
    delete process.env.XDG_SESSION_TYPE
    const result = await getFrontmostApp()
    expect(result).toBeNull()
  })

  it('queries xdotool on x11 and lowercases the class as id', async () => {
    process.env.XDG_SESSION_TYPE = 'x11'
    execFileCustom
      .mockResolvedValueOnce({ stdout: 'Slack\n' })
      .mockResolvedValueOnce({ stdout: 'general - Slack\n' })
    const result = await getFrontmostApp()
    expect(result).toEqual({ id: 'slack', name: 'general - Slack' })
  })

  it('falls back name to the original-case class id when the window title is blank', async () => {
    process.env.XDG_SESSION_TYPE = 'x11'
    execFileCustom.mockResolvedValueOnce({ stdout: 'Slack' }).mockResolvedValueOnce({ stdout: '' })
    const result = await getFrontmostApp()
    // Note: `id` in the returned object is lowercased, but the name fallback uses
    // the pre-lowercase local `id` — this is existing (arguably surprising) behavior.
    expect(result).toEqual({ id: 'slack', name: 'Slack' })
  })

  it('resolves null when the class name is blank', async () => {
    process.env.XDG_SESSION_TYPE = 'x11'
    execFileCustom.mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: 'title' })
    const result = await getFrontmostApp()
    expect(result).toBeNull()
  })

  it('resolves null when xdotool rejects', async () => {
    process.env.XDG_SESSION_TYPE = 'x11'
    execFileCustom.mockRejectedValue(new Error('xdotool missing'))
    const result = await getFrontmostApp()
    expect(result).toBeNull()
  })
})

describe('getFrontmostApp — unsupported platform', () => {
  it('resolves null without touching any detector', async () => {
    setPlatform('freebsd')
    const result = await getFrontmostApp()
    expect(result).toBeNull()
    expect(execFileCustom).not.toHaveBeenCalled()
  })
})
