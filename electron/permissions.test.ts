import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getMediaAccessStatusMock, isTrustedAccessibilityClientMock, askForMediaAccessMock, openExternalMock, getSelectedStorageBackendMock, appOnMock, keyListenerCommandMock, keyListenerIsRunningMock, execFileMock } =
  vi.hoisted(() => ({
    getMediaAccessStatusMock: vi.fn(),
    isTrustedAccessibilityClientMock: vi.fn(),
    askForMediaAccessMock: vi.fn(),
    openExternalMock: vi.fn(),
    getSelectedStorageBackendMock: vi.fn(),
    appOnMock: vi.fn(),
    keyListenerCommandMock: vi.fn(),
    keyListenerIsRunningMock: vi.fn(),
    execFileMock: vi.fn()
  }))

vi.mock('electron', () => ({
  app: { on: appOnMock },
  safeStorage: { getSelectedStorageBackend: getSelectedStorageBackendMock },
  shell: { openExternal: (...a: unknown[]) => openExternalMock(...a) },
  systemPreferences: {
    getMediaAccessStatus: (...a: unknown[]) => getMediaAccessStatusMock(...a),
    isTrustedAccessibilityClient: (...a: unknown[]) => isTrustedAccessibilityClientMock(...a),
    askForMediaAccess: (...a: unknown[]) => askForMediaAccessMock(...a)
  }
}))
vi.mock('./keys/listener', () => ({
  keyListener: { command: keyListenerCommandMock, isRunning: keyListenerIsRunningMock }
}))
vi.mock('child_process', () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }))

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}
const REAL_PLATFORM = process.platform

describe('electron/permissions', () => {
  beforeEach(() => {
    vi.resetModules()
    getMediaAccessStatusMock.mockReset()
    isTrustedAccessibilityClientMock.mockReset()
    askForMediaAccessMock.mockReset()
    openExternalMock.mockReset().mockResolvedValue(undefined)
    getSelectedStorageBackendMock.mockReset()
    appOnMock.mockReset()
    keyListenerCommandMock.mockReset()
    keyListenerIsRunningMock.mockReset().mockReturnValue(true)
    execFileMock.mockReset()
    delete process.env.XDG_SESSION_TYPE
  })
  afterEach(() => {
    setPlatform(REAL_PLATFORM)
    vi.restoreAllMocks()
  })

  describe('preflight — win32', () => {
    it('everything is granted-by-default', async () => {
      setPlatform('win32')
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report).toEqual({
        mic: 'granted',
        accessibility: true,
        inputMonitoring: true,
        automation: 'granted',
        listenerAlive: true
      })
    })
  })

  describe('preflight — darwin', () => {
    beforeEach(() => setPlatform('darwin'))

    it('maps a granted mic status and a successful HEALTH check', async () => {
      getMediaAccessStatusMock.mockReturnValue('granted')
      isTrustedAccessibilityClientMock.mockReturnValue(true)
      keyListenerCommandMock.mockResolvedValue('HEALTH:OK')
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report).toEqual({
        mic: 'granted',
        accessibility: true,
        inputMonitoring: true,
        automation: 'unknown',
        listenerAlive: true
      })
    })

    it('maps not-determined and denied mic statuses', async () => {
      isTrustedAccessibilityClientMock.mockReturnValue(false)
      keyListenerCommandMock.mockResolvedValue('nope')
      const { preflight } = await import('./permissions')

      getMediaAccessStatusMock.mockReturnValue('not-determined')
      expect((await preflight()).mic).toBe('not-determined')

      getMediaAccessStatusMock.mockReturnValue('denied')
      expect((await preflight()).mic).toBe('denied')

      getMediaAccessStatusMock.mockReturnValue('restricted')
      expect((await preflight()).mic).toBe('denied')
    })

    it('treats a non-HEALTH:OK reply as inputMonitoring false / listenerAlive false', async () => {
      getMediaAccessStatusMock.mockReturnValue('granted')
      isTrustedAccessibilityClientMock.mockReturnValue(true)
      keyListenerCommandMock.mockResolvedValue('HEALTH:DEAD')
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report.inputMonitoring).toBe(false)
      expect(report.listenerAlive).toBe(false)
    })

    it('logs and degrades gracefully when the HEALTH command rejects', async () => {
      getMediaAccessStatusMock.mockReturnValue('granted')
      isTrustedAccessibilityClientMock.mockReturnValue(true)
      keyListenerCommandMock.mockRejectedValue(new Error('helper not running'))
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report.inputMonitoring).toBe(false)
      expect(report.listenerAlive).toBe(false)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('HEALTH check failed'), 'helper not running')
    })

    it('a non-Error HEALTH rejection is logged as-is (ternary non-Error branch)', async () => {
      getMediaAccessStatusMock.mockReturnValue('granted')
      isTrustedAccessibilityClientMock.mockReturnValue(true)
      keyListenerCommandMock.mockRejectedValue('a plain string rejection')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { preflight } = await import('./permissions')
      await preflight()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('HEALTH check failed'), 'a plain string rejection')
    })
  })

  describe('preflight — linux', () => {
    beforeEach(() => setPlatform('linux'))

    it('reports the session type, xdotool presence, and secretService backend', async () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null))
      getSelectedStorageBackendMock.mockReturnValue('gnome_libsecret')
      keyListenerIsRunningMock.mockReturnValue(true)
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report.linux).toEqual({ sessionType: 'x11', xdotool: true, secretService: true })
      expect(report.listenerAlive).toBe(true)
    })

    it('falls back to "unknown" session type, xdotool false, and secretService false on failures', async () => {
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(new Error('ENOENT')))
      getSelectedStorageBackendMock.mockImplementation(() => {
        throw new Error('no backend')
      })
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report.linux).toEqual({ sessionType: 'unknown', xdotool: false, secretService: false })
    })

    it('secretService is false for the basic_text backend', async () => {
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null))
      getSelectedStorageBackendMock.mockReturnValue('basic_text')
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report.linux?.secretService).toBe(false)
    })

    it('recognizes wayland as a valid session type', async () => {
      process.env.XDG_SESSION_TYPE = 'wayland'
      execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(new Error('ENOENT')))
      const { preflight } = await import('./permissions')
      const report = await preflight()
      expect(report.linux?.sessionType).toBe('wayland')
    })
  })

  describe('requestMicPermission', () => {
    it('resolves true immediately on non-darwin without asking', async () => {
      setPlatform('win32')
      const { requestMicPermission } = await import('./permissions')
      expect(await requestMicPermission()).toBe(true)
      expect(askForMediaAccessMock).not.toHaveBeenCalled()
    })

    it('delegates to systemPreferences on darwin', async () => {
      setPlatform('darwin')
      askForMediaAccessMock.mockResolvedValue(true)
      const { requestMicPermission } = await import('./permissions')
      expect(await requestMicPermission()).toBe(true)
      expect(askForMediaAccessMock).toHaveBeenCalledWith('microphone')
    })

    it('returns false and logs when askForMediaAccess throws', async () => {
      setPlatform('darwin')
      askForMediaAccessMock.mockRejectedValue(new Error('denied'))
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { requestMicPermission } = await import('./permissions')
      expect(await requestMicPermission()).toBe(false)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('askForMediaAccess failed'), 'denied')
    })

    it('a non-Error rejection is logged as-is (ternary non-Error branch)', async () => {
      setPlatform('darwin')
      askForMediaAccessMock.mockRejectedValue('plain string denial')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { requestMicPermission } = await import('./permissions')
      expect(await requestMicPermission()).toBe(false)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('askForMediaAccess failed'), 'plain string denial')
    })
  })

  describe('openSettingsPane', () => {
    it('is a no-op on non-darwin platforms', async () => {
      setPlatform('win32')
      const { openSettingsPane } = await import('./permissions')
      openSettingsPane('mic')
      expect(openExternalMock).not.toHaveBeenCalled()
    })

    it('opens the Ventura+ deep link for each pane on darwin', async () => {
      setPlatform('darwin')
      const { openSettingsPane } = await import('./permissions')
      openSettingsPane('accessibility')
      expect(openExternalMock).toHaveBeenCalledWith(expect.stringContaining('Privacy_Accessibility'))
    })

    it('logs (does not throw) when shell.openExternal rejects', async () => {
      setPlatform('darwin')
      openExternalMock.mockRejectedValue(new Error('open failed'))
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { openSettingsPane } = await import('./permissions')
      openSettingsPane('keyboard')
      await new Promise((r) => setTimeout(r, 0))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to open pane'), 'open failed')
    })

    it('a non-Error rejection is logged as-is (ternary non-Error branch)', async () => {
      setPlatform('darwin')
      openExternalMock.mockRejectedValue('plain string failure')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { openSettingsPane } = await import('./permissions')
      openSettingsPane('automation')
      await new Promise((r) => setTimeout(r, 0))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to open pane'), 'plain string failure')
    })
  })

  describe('onChange — focus-triggered re-check', () => {
    it('subscribes exactly one app focus handler regardless of subscriber count, and notifies subscribers with the fresh report', async () => {
      setPlatform('win32') // simplest preflight() path
      const { onChange } = await import('./permissions')
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const unsub1 = onChange(cb1)
      onChange(cb2)
      expect(appOnMock).toHaveBeenCalledTimes(1)
      expect(appOnMock).toHaveBeenCalledWith('browser-window-focus', expect.any(Function))

      const focusHandler = appOnMock.mock.calls[0][1] as () => void
      focusHandler()
      await new Promise((r) => setTimeout(r, 0))
      expect(cb1).toHaveBeenCalledWith(expect.objectContaining({ mic: 'granted' }))
      expect(cb2).toHaveBeenCalled()

      unsub1()
      cb1.mockClear()
      cb2.mockClear()
      focusHandler()
      await new Promise((r) => setTimeout(r, 0))
      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).toHaveBeenCalled()
    })

    it('does nothing when there are no subscribers left', async () => {
      setPlatform('win32')
      const { onChange } = await import('./permissions')
      const unsub = onChange(vi.fn())
      unsub()
      const focusHandler = appOnMock.mock.calls[0][1] as () => void
      expect(() => focusHandler()).not.toThrow()
    })

    it('re-entrancy guard: a focus event while a check is already in flight is ignored', async () => {
      setPlatform('darwin')
      getMediaAccessStatusMock.mockReturnValue('granted')
      isTrustedAccessibilityClientMock.mockReturnValue(true)
      let resolveHealth: (v: string) => void
      keyListenerCommandMock.mockReturnValue(new Promise((r) => (resolveHealth = r)))
      const { onChange } = await import('./permissions')
      const cb = vi.fn()
      onChange(cb)
      const focusHandler = appOnMock.mock.calls[0][1] as () => void
      focusHandler() // starts a check (still pending)
      focusHandler() // re-entrant call while `checking` is true — ignored
      resolveHealth!('HEALTH:OK')
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('logs when preflight() itself rejects during a focus re-check', async () => {
      setPlatform('darwin')
      getMediaAccessStatusMock.mockImplementation(() => {
        throw new Error('boom')
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { onChange } = await import('./permissions')
      onChange(vi.fn())
      const focusHandler = appOnMock.mock.calls[0][1] as () => void
      focusHandler()
      await new Promise((r) => setTimeout(r, 0))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('focus preflight failed'), 'boom')
    })

    it('a non-Error preflight rejection during a focus re-check is logged as-is', async () => {
      setPlatform('darwin')
      getMediaAccessStatusMock.mockImplementation(() => {
        throw 'plain string boom'
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { onChange } = await import('./permissions')
      onChange(vi.fn())
      const focusHandler = appOnMock.mock.calls[0][1] as () => void
      focusHandler()
      await new Promise((r) => setTimeout(r, 0))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('focus preflight failed'), 'plain string boom')
    })

    it('logs (but does not stop other subscribers) when a subscriber callback throws', async () => {
      setPlatform('win32')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { onChange } = await import('./permissions')
      const throwing = vi.fn(() => {
        throw new Error('subscriber exploded')
      })
      const other = vi.fn()
      onChange(throwing)
      onChange(other)
      const focusHandler = appOnMock.mock.calls[0][1] as () => void
      focusHandler()
      await new Promise((r) => setTimeout(r, 0))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('onChange subscriber threw'), 'subscriber exploded')
      expect(other).toHaveBeenCalled()
    })

    it('a non-Error subscriber throw is logged as-is (ternary non-Error branch)', async () => {
      setPlatform('win32')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { onChange } = await import('./permissions')
      const throwing = vi.fn(() => {
        throw 'plain string subscriber failure'
      })
      onChange(throwing)
      const focusHandler = appOnMock.mock.calls[0][1] as () => void
      focusHandler()
      await new Promise((r) => setTimeout(r, 0))
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('onChange subscriber threw'),
        'plain string subscriber failure'
      )
    })
  })
})
