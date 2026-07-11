import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

const REAL_PLATFORM = process.platform
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

type Responder = (cmd: string, args: string[]) => { stdout: string } | Error

function respond(fn: Responder) {
  execFileMock.mockImplementation((cmd: string, args: string[], _opts: unknown, cb?: (e: Error | null, r?: unknown) => void) => {
    const callback = typeof _opts === 'function' ? _opts : cb
    const result = fn(cmd, args)
    if (result instanceof Error) callback?.(result)
    else callback?.(null, { stdout: result.stdout, stderr: '' })
  })
}

/** Rejects every execFile call with a raw non-Error value — exercises the
 * `err instanceof Error ? ... : err` fallback branch (Node always rejects
 * with a real Error in practice, but the ternary still guards for the
 * possibility, so tests must reach it explicitly). */
function respondRejectRaw(raw: unknown) {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb?: (e: unknown) => void) => {
    const callback = typeof _opts === 'function' ? _opts : cb
    callback?.(raw)
  })
}

describe('output/media', () => {
  beforeEach(() => {
    vi.resetModules()
    execFileMock.mockReset()
  })
  afterEach(() => {
    setPlatform(REAL_PLATFORM)
    vi.restoreAllMocks()
  })

  describe('darwin', () => {
    beforeEach(() => setPlatform('darwin'))

    it('pauses a playing scriptable app and resumes it later', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: script.includes('pause') ? '' : 'playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()
      expect(logSpy).toHaveBeenCalledWith('[media] paused', 'Music')

      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'paused' }
        return { stdout: '' }
      })
      await resumePausedMedia()
      expect(logSpy).toHaveBeenCalledWith('[media] resumed', 'Music')
    })

    it('skips an app that is not running', async () => {
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'false' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()
      await resumePausedMedia() // nothing was paused -> no-op
      expect(execFileMock).toHaveBeenCalledTimes(2) // one "running?" check per player
    })

    it('skips an app that is running but not currently playing', async () => {
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'paused' }
        return { stdout: '' }
      })
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      // running check + state check per player, no "pause" action
      const pauseCalls = execFileMock.mock.calls.filter((c) => (c[1] as string[])[1].includes(' to pause'))
      expect(pauseCalls).toHaveLength(0)
    })

    it('warns (per-player) and continues when a check throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respond(() => new Error('osascript denied'))
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pause check failed for'), 'osascript denied')
    })

    it('warns (per-player) with a non-Error rejection too', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respondRejectRaw('raw pause denial')
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pause check failed for'), 'raw pause denial')
    })

    it('does not relaunch an app the user quit before resume', async () => {
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia() // pauses Music + Spotify

      respond(() => ({ stdout: 'false' })) // user quit both apps
      await resumePausedMedia()
      const resumeCalls = execFileMock.mock.calls.filter((c) => /\bto play\b/.test((c[1] as string[])[1]))
      expect(resumeCalls).toHaveLength(0)
    })

    it('does not resume if the user manually resumed it already', async () => {
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()

      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'playing' } // still playing, not paused
        return { stdout: '' }
      })
      await resumePausedMedia()
      const resumeCalls = execFileMock.mock.calls.filter((c) => /\bto play\b/.test((c[1] as string[])[1]))
      expect(resumeCalls).toHaveLength(0)
    })

    it('resumePausedMedia with nothing paused is a no-op', async () => {
      const { resumePausedMedia } = await import('./media')
      await resumePausedMedia()
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('warns and continues when a resume check throws', async () => {
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respond(() => new Error('resume denied'))
      await resumePausedMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('resume failed for'), 'resume denied')
    })

    it('warns and continues with a non-Error resume-check rejection too', async () => {
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respondRejectRaw('raw resume denial')
      await resumePausedMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('resume failed for'), 'raw resume denial')
    })

    it('resetMediaState drops any stale resume set', async () => {
      respond((_cmd, args) => {
        const script = args[1] as string
        if (script.includes('name of processes')) return { stdout: 'true' }
        if (script.includes('player state')) return { stdout: 'playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia, resetMediaState } = await import('./media')
      await pausePlayingMedia()
      resetMediaState()
      execFileMock.mockClear()
      await resumePausedMedia()
      expect(execFileMock).not.toHaveBeenCalled()
    })
  })

  describe('linux', () => {
    beforeEach(() => setPlatform('linux'))

    it('pauses playing players via playerctl and resumes them', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      respond((_cmd, args) => {
        if (args[0] === '--list-all') return { stdout: 'spotify\nvlc' }
        if (args.includes('status')) return { stdout: 'Playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()
      expect(logSpy).toHaveBeenCalledWith('[media] paused', 'spotify')

      respond((_cmd, args) => {
        if (args.includes('status')) return { stdout: 'Paused' }
        return { stdout: '' }
      })
      await resumePausedMedia()
      expect(logSpy).toHaveBeenCalledWith('[media] resumed', 'spotify')
    })

    it('skips a listed player that is not currently playing', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      respond((_cmd, args) => {
        if (args[0] === '--list-all') return { stdout: 'playing-one\npaused-one' }
        if (args.includes('status')) return { stdout: args.includes('paused-one') ? 'Paused' : 'Playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(logSpy).toHaveBeenCalledWith('[media] paused', 'playing-one')
      expect(logSpy).not.toHaveBeenCalledWith('[media] paused', 'paused-one')
    })

    it('does not resume a player the user already resumed (status no longer Paused)', async () => {
      respond((_cmd, args) => {
        if (args[0] === '--list-all') return { stdout: 'p1' }
        if (args.includes('status')) return { stdout: 'Playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia() // p1 was playing -> paused by us

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      respond((_cmd, args) => {
        if (args.includes('status')) return { stdout: 'Playing' } // user resumed it
        return { stdout: '' }
      })
      await resumePausedMedia()
      expect(logSpy).not.toHaveBeenCalledWith('[media] resumed', 'p1')
    })

    it('no-op with no players listed', async () => {
      respond((_cmd, args) => {
        if (args[0] === '--list-all') return { stdout: '' }
        return { stdout: '' }
      })
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(execFileMock).toHaveBeenCalledTimes(1)
    })

    it('returns (no-op) when playerctl itself is missing', async () => {
      respond(() => new Error('ENOENT'))
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(execFileMock).toHaveBeenCalledTimes(1)
    })

    it('warns and continues when pausing an individual player fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respond((_cmd, args) => {
        if (args[0] === '--list-all') return { stdout: 'p1' }
        if (args.includes('status')) return { stdout: 'Playing' }
        return new Error('pause failed')
      })
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pause failed for'), 'pause failed')
    })

    it('warns and continues when pausing an individual player fails with a non-Error value', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // playerctl is invoked as execFile(cmd, args, opts, cb) — grab the LAST
      // arg as the callback (the existing respond() helper does the same).
      execFileMock.mockImplementation((...a: unknown[]) => {
        const cb = a[a.length - 1] as (e: unknown, r?: unknown) => void
        const args = a[1] as string[]
        if (args[0] === '--list-all') return cb(null, { stdout: 'p1', stderr: '' })
        if (args.includes('status')) return cb(null, { stdout: 'Playing', stderr: '' })
        cb('raw pause failure')
      })
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pause failed for'), 'raw pause failure')
    })

    it('warns and continues when resuming an individual player fails', async () => {
      respond((_cmd, args) => {
        if (args[0] === '--list-all') return { stdout: 'p1' }
        if (args.includes('status')) return { stdout: 'Playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respond((_cmd, args) => {
        if (args.includes('status')) return { stdout: 'Paused' }
        return new Error('resume failed')
      })
      await resumePausedMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('resume failed for'), 'resume failed')
    })

    it('warns and continues when resuming an individual player fails with a non-Error value', async () => {
      respond((_cmd, args) => {
        if (args[0] === '--list-all') return { stdout: 'p1' }
        if (args.includes('status')) return { stdout: 'Playing' }
        return { stdout: '' }
      })
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      execFileMock.mockImplementation((...a: unknown[]) => {
        const cb = a[a.length - 1] as (e: unknown, r?: unknown) => void
        const args = a[1] as string[]
        if (args.includes('status')) return cb(null, { stdout: 'Paused', stderr: '' })
        cb('raw resume failure')
      })
      await resumePausedMedia()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('resume failed for'), 'raw resume failure')
    })
  })

  describe('win32', () => {
    beforeEach(() => setPlatform('win32'))

    it('pauses sessions via WinRT PowerShell and resumes them', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      respond(() => ({ stdout: 'App1\nApp2' }))
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()
      expect(logSpy).toHaveBeenCalledWith('[media] paused', 2, 'session(s)')

      respond(() => ({ stdout: '' }))
      await resumePausedMedia()
      expect(logSpy).toHaveBeenCalledWith('[media] resume attempted for', 2, 'session(s)')
    })

    it('logs nothing when the pause script reports no sessions', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      respond(() => ({ stdout: '' }))
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('paused'), expect.anything(), expect.anything())
    })

    it('warns once (not repeatedly) when WinRT is unavailable', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respond(() => new Error('WinRT missing'))
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      await pausePlayingMedia() // second failure must not warn again
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('pauseWin failing with a non-Error value is still logged', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respondRejectRaw('raw WinRT pause failure')
      const { pausePlayingMedia } = await import('./media')
      await pausePlayingMedia()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WinRT media control unavailable'),
        'raw WinRT pause failure'
      )
    })

    it('resumeWin failure is caught and warned (and shares the winErrorLogged latch)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respond(() => ({ stdout: 'App1' }))
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()
      respond(() => new Error('WinRT resume missing'))
      await resumePausedMedia()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WinRT media control unavailable'),
        'WinRT resume missing'
      )
      // The latch is shared across pause/resume — a second failure anywhere
      // must not warn again.
      warnSpy.mockClear()
      respond(() => ({ stdout: 'App1' }))
      await pausePlayingMedia()
      respond(() => new Error('still broken'))
      await resumePausedMedia()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('resumeWin failing with a non-Error value is still logged', async () => {
      respond(() => ({ stdout: 'App1' }))
      const { pausePlayingMedia, resumePausedMedia } = await import('./media')
      await pausePlayingMedia()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      respondRejectRaw('raw WinRT resume failure')
      await resumePausedMedia()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WinRT media control unavailable'),
        'raw WinRT resume failure'
      )
    })
  })
})
