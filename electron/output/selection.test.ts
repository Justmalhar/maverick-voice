import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clipboardState = { text: '', image: { empty: true } as { empty: boolean } }
const readTextMock = vi.fn(() => clipboardState.text)
const readImageMock = vi.fn(() => {
  // Snapshot at call-time — code under test calls clipboard.clear() right
  // after reading, which must not retroactively change what was "saved".
  const empty = clipboardState.image.empty
  return { isEmpty: () => empty }
})
const clearMock = vi.fn(() => {
  clipboardState.text = ''
  clipboardState.image = { empty: true }
})
const writeTextMock = vi.fn((t: string) => {
  clipboardState.text = t
})
const writeMock = vi.fn()

vi.mock('electron', () => ({
  clipboard: {
    readText: () => readTextMock(),
    readImage: () => readImageMock(),
    clear: () => clearMock(),
    writeText: (t: string) => writeTextMock(t),
    write: (o: unknown) => writeMock(o)
  }
}))

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

const REAL_PLATFORM = process.platform
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

function execSucceeds(onCall?: () => void) {
  execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null, r?: unknown) => void) => {
    onCall?.()
    cb(null, { stdout: '', stderr: '' })
  })
}
function execFails(err: Error) {
  execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => {
    cb(err)
  })
}

describe('output/selection', () => {
  beforeEach(() => {
    vi.resetModules()
    execFileMock.mockReset()
    readTextMock.mockClear()
    readImageMock.mockClear()
    clearMock.mockClear()
    writeTextMock.mockClear()
    writeMock.mockClear()
    clipboardState.text = ''
    clipboardState.image = { empty: true }
    delete process.env.XDG_SESSION_TYPE
  })
  afterEach(() => {
    setPlatform(REAL_PLATFORM)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns null immediately on a wayland/unknown linux session without touching the clipboard', async () => {
    setPlatform('linux')
    process.env.XDG_SESSION_TYPE = 'wayland'
    const { captureSelectedText } = await import('./selection')
    const result = await captureSelectedText({ useClipboardFallback: false })
    expect(result).toBeNull()
    expect(readTextMock).not.toHaveBeenCalled()
  })

  describe('darwin', () => {
    beforeEach(() => setPlatform('darwin'))

    it('captures new selected text via the helper COPY fast path, then restores the old clipboard', async () => {
      vi.useFakeTimers()
      clipboardState.text = 'old clipboard'
      const helperCommand = vi.fn().mockResolvedValue('COPY_OK')
      const { captureSelectedText } = await import('./selection')
      // Simulate the target app writing new text to the clipboard after the copy keystroke.
      const promise = captureSelectedText({ useClipboardFallback: false, helperCommand })
      await vi.advanceTimersByTimeAsync(0)
      clipboardState.text = 'freshly selected'
      await vi.advanceTimersByTimeAsync(150)
      const result = await promise
      expect(result).toBe('freshly selected')
      expect(writeTextMock).toHaveBeenLastCalledWith('old clipboard')
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('falls back to osascript when the helper COPY reply is unexpected', async () => {
      vi.useFakeTimers()
      execSucceeds(() => {
        clipboardState.text = 'copied via osascript'
      })
      const helperCommand = vi.fn().mockResolvedValue('WRONG')
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false, helperCommand })
      await vi.advanceTimersByTimeAsync(150)
      const result = await promise
      expect(result).toBe('copied via osascript')
      expect(execFileMock).toHaveBeenCalled()
    })

    it('falls back to osascript when the helper COPY rejects', async () => {
      vi.useFakeTimers()
      execSucceeds()
      const helperCommand = vi.fn().mockRejectedValue(new Error('helper down'))
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false, helperCommand })
      await vi.advanceTimersByTimeAsync(150)
      await promise
      expect(execFileMock).toHaveBeenCalled()
    })

    it('helper COPY that never resolves is caught by the internal withTimeout guard', async () => {
      vi.useFakeTimers()
      execSucceeds(() => {
        clipboardState.text = 'copied via osascript after timeout'
      })
      const helperCommand = vi.fn(() => new Promise<string>(() => {})) // never settles
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false, helperCommand })
      await vi.advanceTimersByTimeAsync(500) // TIMEOUTS.helperCommand → withTimeout rejects
      await vi.advanceTimersByTimeAsync(150) // copy settle
      expect(await promise).toBe('copied via osascript after timeout')
      expect(execFileMock).toHaveBeenCalled()
    })

    it('falls back to osascript when the helper COPY rejects with a non-Error value', async () => {
      vi.useFakeTimers()
      execSucceeds()
      const helperCommand = vi.fn().mockRejectedValue('raw helper failure')
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false, helperCommand })
      await vi.advanceTimersByTimeAsync(150)
      await promise
      expect(execFileMock).toHaveBeenCalled()
    })

    it('logs a non-Error value when the copy simulation itself fails', async () => {
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: unknown) => void) => cb('raw copy failure'))
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      clipboardState.text = 'unchanged'
      const { captureSelectedText } = await import('./selection')
      const result = await captureSelectedText({ useClipboardFallback: false })
      expect(result).toBeNull()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('copy simulation failed'), 'raw copy failure')
    })

    it('logs a non-Error value on an unexpected top-level failure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      readTextMock.mockImplementationOnce(() => {
        throw 'raw top-level failure'
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { captureSelectedText } = await import('./selection')
      const result = await captureSelectedText({ useClipboardFallback: false })
      expect(result).toBeNull()
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to capture selected text'), 'raw top-level failure')
    })

    it('uses osascript directly with no helperCommand supplied', async () => {
      vi.useFakeTimers()
      execSucceeds()
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false })
      await vi.advanceTimersByTimeAsync(150)
      await promise
      expect(execFileMock).toHaveBeenCalledWith(
        '/usr/bin/osascript',
        expect.arrayContaining([expect.stringContaining('keystroke "c"')]),
        expect.any(Function)
      )
    })

    it('returns null when nothing new was copied (clipboard still empty after settle)', async () => {
      vi.useFakeTimers()
      clipboardState.text = ''
      execSucceeds()
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false })
      await vi.advanceTimersByTimeAsync(150)
      expect(await promise).toBeNull()
    })

    it('restores a saved image (with text) when the clipboard held an image', async () => {
      vi.useFakeTimers()
      clipboardState.text = 'text-with-image'
      clipboardState.image = { empty: false }
      execSucceeds(() => {
        clipboardState.text = 'new selection'
      })
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false })
      await vi.advanceTimersByTimeAsync(150)
      await promise
      expect(writeMock).toHaveBeenCalledWith({ text: 'text-with-image', image: expect.anything() })
    })

    it('restores an image-only clipboard (no saved text)', async () => {
      vi.useFakeTimers()
      clipboardState.text = ''
      clipboardState.image = { empty: false }
      execSucceeds(() => {
        clipboardState.text = 'new selection'
      })
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false })
      await vi.advanceTimersByTimeAsync(150)
      await promise
      expect(writeMock).toHaveBeenCalledWith({ image: expect.anything() })
    })

    it('when the copy simulation fails, restores clipboard and returns null without fallback', async () => {
      execFails(new Error('Accessibility not granted'))
      clipboardState.text = 'unchanged'
      const { captureSelectedText } = await import('./selection')
      const result = await captureSelectedText({ useClipboardFallback: false })
      expect(result).toBeNull()
      expect(writeTextMock).toHaveBeenLastCalledWith('unchanged')
    })

    it('when copy fails and useClipboardFallback is true, returns the saved clipboard text', async () => {
      execFails(new Error('Accessibility not granted'))
      clipboardState.text = 'existing context'
      const { captureSelectedText } = await import('./selection')
      const result = await captureSelectedText({ useClipboardFallback: true })
      expect(result).toBe('existing context')
    })

    it('when copy fails, useClipboardFallback true but saved text is blank, returns null', async () => {
      execFails(new Error('Accessibility not granted'))
      clipboardState.text = '   '
      const { captureSelectedText } = await import('./selection')
      const result = await captureSelectedText({ useClipboardFallback: true })
      expect(result).toBeNull()
    })

    it('catches an unexpected top-level error (e.g. clipboard.readText throws) and returns null', async () => {
      readTextMock.mockImplementationOnce(() => {
        throw new Error('clipboard exploded')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { captureSelectedText } = await import('./selection')
      const result = await captureSelectedText({ useClipboardFallback: false })
      expect(result).toBeNull()
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to capture selected text'), 'clipboard exploded')
    })
  })

  describe('win32', () => {
    beforeEach(() => setPlatform('win32'))

    it('uses SendKeys to simulate Ctrl+C', async () => {
      vi.useFakeTimers()
      execSucceeds(() => {
        clipboardState.text = 'win selection'
      })
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false })
      await vi.advanceTimersByTimeAsync(150)
      expect(await promise).toBe('win selection')
      expect(execFileMock).toHaveBeenCalledWith('powershell', expect.any(Array), expect.any(Function))
    })
  })

  describe('linux x11', () => {
    beforeEach(() => {
      setPlatform('linux')
      process.env.XDG_SESSION_TYPE = 'x11'
    })

    it('uses xdotool when available', async () => {
      vi.useFakeTimers()
      execSucceeds(() => {
        clipboardState.text = 'x11 selection'
      })
      const { captureSelectedText } = await import('./selection')
      const promise = captureSelectedText({ useClipboardFallback: false })
      await vi.advanceTimersByTimeAsync(150)
      expect(await promise).toBe('x11 selection')
    })

    it('throws (falls back path) when xdotool is not installed', async () => {
      execFails(new Error('ENOENT'))
      clipboardState.text = 'kept'
      const { captureSelectedText } = await import('./selection')
      const result = await captureSelectedText({ useClipboardFallback: false })
      expect(result).toBeNull()
    })
  })
})
