import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isPackagedRef, setFeedURLMock, checkForUpdatesMock, autoUpdaterOnMock } = vi.hoisted(() => ({
  isPackagedRef: { value: true },
  setFeedURLMock: vi.fn(),
  checkForUpdatesMock: vi.fn(),
  autoUpdaterOnMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackagedRef.value
    }
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    setFeedURL: setFeedURLMock,
    autoDownload: undefined as boolean | undefined,
    on: autoUpdaterOnMock,
    checkForUpdates: checkForUpdatesMock
  }
}))

describe('electron/updater', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    isPackagedRef.value = true
    setFeedURLMock.mockReset()
    checkForUpdatesMock.mockReset().mockResolvedValue(undefined)
    autoUpdaterOnMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is a no-op when not packaged (dev mode)', async () => {
    isPackagedRef.value = false
    const { startUpdater } = await import('./updater')
    startUpdater()
    expect(setFeedURLMock).not.toHaveBeenCalled()
    expect(checkForUpdatesMock).not.toHaveBeenCalled()
  })

  it('configures the feed, disables autoDownload, and checks immediately when packaged', async () => {
    const { startUpdater } = await import('./updater')
    startUpdater()
    expect(setFeedURLMock).toHaveBeenCalledWith({ provider: 'generic', url: expect.stringContaining('https://') })
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1)
    expect(autoUpdaterOnMock).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('is idempotent — a second call does not re-register or re-check', async () => {
    const { startUpdater } = await import('./updater')
    startUpdater()
    startUpdater()
    expect(setFeedURLMock).toHaveBeenCalledTimes(1)
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1)
  })

  it('re-checks on the 24h interval', async () => {
    const { startUpdater } = await import('./updater')
    startUpdater()
    checkForUpdatesMock.mockClear()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1)
  })

  it('logs a checkForUpdates() rejection once, not repeatedly across multiple failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    checkForUpdatesMock.mockRejectedValue(new Error('network down'))
    const { startUpdater } = await import('./updater')
    startUpdater()
    await Promise.resolve()
    await Promise.resolve()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('check failed'), 'network down')

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(warnSpy).toHaveBeenCalledTimes(1) // still only once
  })

  it('logs an autoUpdater "error" event once via the same guard', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { startUpdater } = await import('./updater')
    startUpdater()
    const errorHandler = autoUpdaterOnMock.mock.calls.find((c) => c[0] === 'error')?.[1] as (e: unknown) => void
    errorHandler(new Error('update corrupt'))
    errorHandler(new Error('second error'))
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('check failed'), 'update corrupt')
  })

  it('catches a synchronous setFeedURL throw and logs once', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setFeedURLMock.mockImplementation(() => {
      throw new Error('bad feed config')
    })
    const { startUpdater } = await import('./updater')
    expect(() => startUpdater()).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('check failed'), 'bad feed config')
  })

  it('stringifies a non-Error rejection as-is', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    checkForUpdatesMock.mockRejectedValue('plain string failure')
    const { startUpdater } = await import('./updater')
    startUpdater()
    await Promise.resolve()
    await Promise.resolve()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('check failed'), 'plain string failure')
  })
})
