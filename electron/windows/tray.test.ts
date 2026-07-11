import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, showDashboardMock, appQuitMock, TrayMock, trayInstances, buildFromTemplateMock, createFromPathMock, createFromBufferMock } =
  vi.hoisted(() => {
    const trayInstances: any[] = []
    class TrayMock {
      setToolTip = vi.fn()
      setContextMenu = vi.fn()
      setImage = vi.fn()
      private handlers = new Map<string, () => void>()
      constructor(public icon: unknown) {
        trayInstances.push(this)
      }
      on(event: string, cb: () => void) {
        this.handlers.set(event, cb)
      }
      fire(event: string) {
        this.handlers.get(event)?.()
      }
    }
    return {
      existsSyncMock: vi.fn(),
      showDashboardMock: vi.fn(),
      appQuitMock: vi.fn(),
      TrayMock,
      trayInstances,
      buildFromTemplateMock: vi.fn((items: unknown) => items),
      createFromPathMock: vi.fn(),
      createFromBufferMock: vi.fn()
    }
  })

vi.mock('node:fs', () => ({ existsSync: (...a: unknown[]) => existsSyncMock(...a) }))
vi.mock('./dashboard', () => ({ showDashboard: showDashboardMock }))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app', quit: appQuitMock },
  Menu: { buildFromTemplate: buildFromTemplateMock },
  Tray: TrayMock,
  nativeImage: {
    createFromPath: (...a: unknown[]) => createFromPathMock(...a),
    createFromBuffer: (...a: unknown[]) => createFromBufferMock(...a)
  }
}))

function fakeImage(w: number, h: number, opaque = true) {
  // BGRA bitmap: fill with a bright, opaque square so buildBaseGlyph finds a mark.
  const bmp = Buffer.alloc(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    bmp[p * 4] = 255
    bmp[p * 4 + 1] = 255
    bmp[p * 4 + 2] = 255
    bmp[p * 4 + 3] = opaque ? 255 : 0
  }
  return {
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => bmp
  }
}

function fakeNativeImage() {
  return { setTemplateImage: vi.fn() }
}

const REAL_PLATFORM = process.platform
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

// The real Tray type has plain methods; our TrayMock exposes vi.fn() members
// plus a test-only fire(). Cast getTray()'s result through this shape so the
// mock affordances (.mock/.mockClear/fire) type-check.
type MockTray = {
  setToolTip: ReturnType<typeof vi.fn>
  setContextMenu: ReturnType<typeof vi.fn>
  setImage: ReturnType<typeof vi.fn>
  fire(event: string): void
}
const asMock = (t: unknown): MockTray => t as unknown as MockTray

describe('windows/tray', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    trayInstances.length = 0
    existsSyncMock.mockReset()
    showDashboardMock.mockReset()
    appQuitMock.mockReset()
    buildFromTemplateMock.mockClear()
    createFromPathMock.mockReset().mockReturnValue(fakeImage(18, 18))
    createFromBufferMock.mockReset().mockReturnValue(fakeNativeImage())
    setPlatform('darwin')
  })
  afterEach(() => {
    vi.useRealTimers()
    setPlatform(REAL_PLATFORM)
    vi.restoreAllMocks()
  })

  it('createTray builds an idle icon from the isolated glyph, sets a tooltip and menu, and reacts to clicks', async () => {
    existsSyncMock.mockReturnValue(true)
    const { createTray, getTray } = await import('./tray')
    createTray()
    const tray = getTray()
    expect(tray).not.toBeNull()
    expect(tray!.setToolTip).toHaveBeenCalledWith('Maverick Voice')
    expect(tray!.setContextMenu).toHaveBeenCalled()
    expect(buildFromTemplateMock).toHaveBeenCalledWith([
      { label: 'Open Maverick Voice', click: expect.any(Function) },
      { type: 'separator' },
      { label: 'Quit', click: expect.any(Function) }
    ])
    asMock(tray).fire('click')
    expect(showDashboardMock).toHaveBeenCalled()
  })

  it('menu items route to showDashboard() and app.quit()', async () => {
    existsSyncMock.mockReturnValue(true)
    const { createTray } = await import('./tray')
    createTray()
    const template = buildFromTemplateMock.mock.calls[0][0] as Array<{ click?: () => void }>
    template[0].click?.()
    expect(showDashboardMock).toHaveBeenCalled()
    template[2].click?.()
    expect(appQuitMock).toHaveBeenCalled()
  })

  it('falls back to a dot glyph and logs an error when no icon file is found', async () => {
    existsSyncMock.mockReturnValue(false)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { createTray, getTray } = await import('./tray')
    createTray()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('menubar-icon.png not found'))
    expect(getTray()).not.toBeNull()
  })

  it('bails out of buildBaseGlyph when the source image has no bright pixels above the alpha threshold', async () => {
    existsSyncMock.mockReturnValue(true)
    createFromPathMock.mockReturnValue(fakeImage(18, 18, false)) // fully transparent -> no mark found
    const { createTray, getTray } = await import('./tray')
    expect(() => createTray()).not.toThrow()
    expect(getTray()).not.toBeNull()
  })

  it('builds a white (non-template) fallback dot glyph on non-darwin when no icon file exists', async () => {
    setPlatform('win32')
    existsSyncMock.mockReturnValue(false) // no icon -> fallback dot glyph path
    const fb = fakeNativeImage()
    createFromBufferMock.mockReturnValue(fb)
    const { createTray, getTray } = await import('./tray')
    createTray()
    expect(getTray()).not.toBeNull()
    // Non-darwin: the dot glyph is drawn white (rgb 255) and never templated.
    expect(fb.setTemplateImage).not.toHaveBeenCalled()
  })

  it('does not set a template image on non-darwin platforms', async () => {
    setPlatform('win32')
    existsSyncMock.mockReturnValue(true)
    const img = fakeNativeImage()
    createFromBufferMock.mockReturnValue(img)
    const { createTray } = await import('./tray')
    createTray()
    expect(img.setTemplateImage).not.toHaveBeenCalled()
  })

  it('setTrayRecording animates through the pulse frames on an interval, reusing the same frame set for both modes', async () => {
    existsSyncMock.mockReturnValue(true)
    const { createTray, setTrayRecording, getTray } = await import('./tray')
    createTray()
    const tray = asMock(getTray())
    setTrayRecording('dictation')
    await vi.advanceTimersByTimeAsync(120)
    const callsAfterDictation = tray.setImage.mock.calls.length
    expect(callsAfterDictation).toBeGreaterThan(0)

    setTrayRecording('instruction') // restarts the animation from frame 0, same frame set
    await vi.advanceTimersByTimeAsync(120)
    expect(tray.setImage.mock.calls.length).toBeGreaterThan(callsAfterDictation)
  })

  it('setTrayRecording before createTray is a no-op (no tray yet)', async () => {
    const { setTrayRecording } = await import('./tray')
    expect(() => setTrayRecording('dictation')).not.toThrow()
  })

  it('setTrayIdle stops the animation and restores the idle icon', async () => {
    existsSyncMock.mockReturnValue(true)
    const { createTray, setTrayRecording, setTrayIdle, getTray } = await import('./tray')
    createTray()
    const tray = asMock(getTray())
    setTrayRecording('dictation')
    await vi.advanceTimersByTimeAsync(120)
    tray.setImage.mockClear()
    setTrayIdle()
    await vi.advanceTimersByTimeAsync(500)
    expect(tray.setImage).toHaveBeenCalledTimes(1) // only the idle-icon restore, animation stopped
  })

  it('getTray returns null before createTray is called', async () => {
    const { getTray } = await import('./tray')
    expect(getTray()).toBeNull()
  })

  it('setTrayIdle before createTray is a no-op (tray/idleIcon still null)', async () => {
    const { setTrayIdle } = await import('./tray')
    expect(() => setTrayIdle()).not.toThrow()
  })

  it('resolves the icon path via the app.getAppPath() dev fallback when resourcesPath is absent', async () => {
    const originalResourcesPath = process.resourcesPath
    // @ts-expect-error test-only override of a read-only runtime path
    process.resourcesPath = ''
    existsSyncMock.mockImplementation((p: string) => p.includes('/app/resources'))
    const { createTray, getTray } = await import('./tray')
    createTray()
    expect(getTray()).not.toBeNull()
    // @ts-expect-error restore
    process.resourcesPath = originalResourcesPath
  })
})
