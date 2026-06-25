import { describe, it, expect, vi, beforeEach } from 'vitest'

const clipboardState = vi.hoisted(() => {
  let text = 'saved clipboard contents'
  return {
    readText: vi.fn(() => text),
    writeText: vi.fn((next: string) => {
      text = next
    }),
    reset: (next = 'saved clipboard contents') => {
      text = next
      clipboardState.readText.mockClear()
      clipboardState.writeText.mockClear()
    },
    current: () => text,
  }
})

const execFileMock = vi.hoisted(() =>
  vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
    cb(null)
  }),
)

vi.mock('electron', () => ({
  clipboard: {
    readText: () => clipboardState.readText(),
    writeText: (t: string) => clipboardState.writeText(t),
  },
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('node:util', () => ({
  promisify: (fn: typeof execFileMock) => {
    return (...args: unknown[]) =>
      new Promise<void>((resolve, reject) => {
        fn(args[0] as string, args[1] as string[], (err: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      })
  },
}))

import { injectOutput } from './clipboard'

describe('injectOutput', () => {
  beforeEach(() => {
    clipboardState.reset('prior user clip')
    execFileMock.mockImplementation((_cmd, _args, cb) => {
      cb(null)
    })
  })

  it('restores the prior clipboard after a successful auto-paste', async () => {
    await injectOutput('transcript text')

    expect(clipboardState.readText).toHaveBeenCalled()
    expect(clipboardState.writeText).toHaveBeenCalledWith('transcript text')
    expect(clipboardState.current()).toBe('prior user clip')
  })

  it('leaves the injected text on the clipboard when auto-paste fails', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => {
      cb(new Error('paste blocked'))
    })

    await injectOutput('transcript text')

    expect(clipboardState.current()).toBe('transcript text')
  })
})
