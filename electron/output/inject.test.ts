import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const writeTextMock = vi.fn()
vi.mock('electron', () => ({
  clipboard: { writeText: (...a: unknown[]) => writeTextMock(...a) }
}))

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

const REAL_PLATFORM = process.platform
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

function succeed() {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb?: (e: Error | null, r?: unknown) => void) => {
    const callback = typeof _opts === 'function' ? _opts : cb
    callback?.(null, { stdout: '', stderr: '' })
  })
}
function fail(err: Error) {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb?: (e: Error | null, r?: unknown) => void) => {
    const callback = typeof _opts === 'function' ? _opts : cb
    callback?.(err)
  })
}

describe('output/inject', () => {
  beforeEach(() => {
    vi.resetModules()
    execFileMock.mockReset()
    writeTextMock.mockReset()
    delete process.env.XDG_SESSION_TYPE
  })
  afterEach(() => {
    setPlatform(REAL_PLATFORM)
    vi.restoreAllMocks()
  })

  it('copyToClipboard writes text and logs the length', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { copyToClipboard } = await import('./inject')
    copyToClipboard('hello')
    expect(writeTextMock).toHaveBeenCalledWith('hello')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('copied to clipboard'), expect.anything())
  })

  describe('darwin', () => {
    beforeEach(() => setPlatform('darwin'))

    it('always writes clipboard first', async () => {
      succeed()
      const { injectOutput } = await import('./inject')
      await injectOutput('text')
      expect(writeTextMock).toHaveBeenCalledWith('text')
    })

    it('uses the helper CGEvent fast path on PASTE_OK', async () => {
      const { injectOutput } = await import('./inject')
      const helperCommand = vi.fn().mockResolvedValue('PASTE_OK')
      const result = await injectOutput('text', { helperCommand })
      expect(result).toEqual({})
      expect(helperCommand).toHaveBeenCalledWith('PASTE')
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('a helper command that never resolves is caught by the internal withTimeout guard', async () => {
      vi.useFakeTimers()
      succeed()
      const { injectOutput } = await import('./inject')
      const helperCommand = vi.fn(() => new Promise<string>(() => {})) // never settles
      const resultPromise = injectOutput('text', { helperCommand })
      await vi.advanceTimersByTimeAsync(500) // TIMEOUTS.helperCommand
      const result = await resultPromise
      expect(result).toEqual({})
      expect(execFileMock).toHaveBeenCalled() // fell through to osascript
      vi.useRealTimers()
    })

    it('falls back to osascript on an unexpected helper reply', async () => {
      succeed()
      const { injectOutput } = await import('./inject')
      const helperCommand = vi.fn().mockResolvedValue('SOMETHING_ELSE')
      const result = await injectOutput('text', { helperCommand })
      expect(result).toEqual({})
      expect(execFileMock).toHaveBeenCalledWith(
        '/usr/bin/osascript',
        expect.arrayContaining([expect.stringContaining('keystroke "v"')]),
        expect.any(Function)
      )
    })

    it('falls back to osascript when the helper command rejects/times out', async () => {
      succeed()
      const { injectOutput } = await import('./inject')
      const helperCommand = vi.fn().mockRejectedValue(new Error('timeout'))
      await injectOutput('text', { helperCommand })
      expect(execFileMock).toHaveBeenCalled()
    })

    it('falls back to osascript when the helper command rejects with a non-Error value', async () => {
      succeed()
      const { injectOutput } = await import('./inject')
      const helperCommand = vi.fn().mockRejectedValue('a plain string rejection')
      await injectOutput('text', { helperCommand })
      expect(execFileMock).toHaveBeenCalled()
    })

    it('uses osascript directly when no helperCommand is supplied', async () => {
      succeed()
      const { injectOutput } = await import('./inject')
      await injectOutput('text')
      expect(execFileMock).toHaveBeenCalled()
    })

    it('swallows an osascript paste failure (clipboard already has the text)', async () => {
      fail(new Error('osascript denied'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('osascript paste failed'), 'osascript denied')
    })

    it('swallows an osascript paste failure that rejects with a non-Error value', async () => {
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: unknown) => void) => cb('raw osascript failure'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('osascript paste failed'), 'raw osascript failure')
    })
  })

  describe('win32', () => {
    beforeEach(() => setPlatform('win32'))

    it('uses SendKeys via powershell', async () => {
      succeed()
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(execFileMock).toHaveBeenCalledWith('powershell', expect.any(Array), expect.any(Function))
    })

    it('swallows a SendKeys failure', async () => {
      fail(new Error('SendKeys blocked'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('SendKeys paste failed'), 'SendKeys blocked')
    })

    it('swallows a SendKeys failure that rejects with a non-Error value', async () => {
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: unknown) => void) => cb('raw string failure'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('SendKeys paste failed'), 'raw string failure')
    })
  })

  describe('linux', () => {
    beforeEach(() => setPlatform('linux'))

    it('uses xdotool on x11 when available', async () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      succeed()
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(execFileMock).toHaveBeenCalledWith('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], expect.any(Function))
    })

    it('swallows an xdotool paste failure', async () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      // first call: `which xdotool` succeeds; second call: xdotool key fails
      let call = 0
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null, r?: unknown) => void) => {
        call++
        if (call === 1) cb(null, { stdout: '', stderr: '' })
        else cb(new Error('xdotool failed'))
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('xdotool paste failed'), 'xdotool failed')
    })

    it('swallows an xdotool paste failure that rejects with a non-Error value', async () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      let call = 0
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: unknown, r?: unknown) => void) => {
        call++
        if (call === 1) cb(null, { stdout: '', stderr: '' })
        else cb('raw xdotool failure')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({})
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('xdotool paste failed'), 'raw xdotool failure')
    })

    it('degrades to clipboard-only on wayland (no xdotool check)', async () => {
      process.env.XDG_SESSION_TYPE = 'wayland'
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({ degraded: 'clipboard-only' })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no paste path'))
    })

    it('degrades to clipboard-only on x11 without xdotool installed', async () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      fail(new Error('ENOENT'))
      const { injectOutput } = await import('./inject')
      const result = await injectOutput('text')
      expect(result).toEqual({ degraded: 'clipboard-only' })
    })

    it('caches the xdotool presence check across calls', async () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      succeed()
      const { injectOutput } = await import('./inject')
      await injectOutput('one')
      await injectOutput('two')
      // `which xdotool` (1) + `xdotool key` x2 = 3 total execFile calls
      expect(execFileMock).toHaveBeenCalledTimes(3)
    })
  })
})
