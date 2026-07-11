import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingMock, cursorPoint, display, BrowserWindowMock, instances } = vi.hoisted(() => {
  const instances: any[] = []
  class BrowserWindowMock {
    static ctorArgs: unknown[] = []
    loadURL = vi.fn().mockResolvedValue(undefined)
    loadFile = vi.fn().mockResolvedValue(undefined)
    show = vi.fn()
    showInactive = vi.fn()
    hide = vi.fn()
    isVisible = vi.fn(() => true)
    setBounds = vi.fn()
    setAlwaysOnTop = vi.fn()
    moveTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setFullScreenable = vi.fn()
    private handlers = new Map<string, () => void>()
    constructor(opts: unknown) {
      BrowserWindowMock.ctorArgs.push(opts)
      instances.push(this)
    }
    on(event: string, cb: () => void) {
      this.handlers.set(event, cb)
    }
    fire(event: string) {
      this.handlers.get(event)?.()
    }
  }
  return {
    getSettingMock: vi.fn(() => 'center'),
    cursorPoint: { x: 100, y: 100 },
    display: { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    BrowserWindowMock,
    instances
  }
})

vi.mock('electron', () => ({
  BrowserWindow: BrowserWindowMock,
  screen: {
    getCursorScreenPoint: () => cursorPoint,
    getDisplayNearestPoint: () => display
  }
}))
vi.mock('../store/settings', () => ({ getSetting: getSettingMock }))

const REAL_ENV = process.env['ELECTRON_RENDERER_URL']

describe('windows/hud', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    instances.length = 0
    BrowserWindowMock.ctorArgs.length = 0
    getSettingMock.mockReset().mockReturnValue('center')
    delete process.env['ELECTRON_RENDERER_URL']
  })
  afterEach(() => {
    vi.useRealTimers()
    if (REAL_ENV === undefined) delete process.env['ELECTRON_RENDERER_URL']
    else process.env['ELECTRON_RENDERER_URL'] = REAL_ENV
    vi.restoreAllMocks()
  })

  it('createHUD centers the window when widgetPosition is "center"', async () => {
    const { createHUD } = await import('./hud')
    const win = createHUD()
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('renderer/index.html'), { hash: '/widget' })
    const bounds = BrowserWindowMock.ctorArgs.at(-1) as { x: number; width: number }
    expect(bounds.x).toBe(Math.round((1920 - 520) / 2))
  })

  it('right-aligns the window when widgetPosition is "right"', async () => {
    getSettingMock.mockReturnValue('right')
    const { createHUD } = await import('./hud')
    createHUD()
    const bounds = BrowserWindowMock.ctorArgs.at(-1) as { x: number }
    expect(bounds.x).toBe(1920 - 520 - 12)
  })

  it('loads the dev server URL with a #/widget hash when ELECTRON_RENDERER_URL is set', async () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const { createHUD } = await import('./hud')
    const win = createHUD()
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173#/widget')
    expect(win.loadFile).not.toHaveBeenCalled()
  })

  it('applies darwin-only panel behavior (visibleOnAllWorkspaces, non-fullscreenable, type: panel)', async () => {
    const REAL_PLATFORM = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    const { createHUD } = await import('./hud')
    const win = createHUD()
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true })
    expect(win.setFullScreenable).toHaveBeenCalledWith(false)
    expect(BrowserWindowMock.ctorArgs.at(-1)).toMatchObject({ type: 'panel' })
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  })

  it('skips darwin-only behavior on other platforms', async () => {
    const REAL_PLATFORM = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const { createHUD } = await import('./hud')
    const win = createHUD()
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    expect(BrowserWindowMock.ctorArgs.at(-1)).not.toHaveProperty('type')
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  })

  it('clears the module reference on "closed"', async () => {
    const { createHUD, getHUD } = await import('./hud')
    const win = createHUD()
    ;(win as any).fire('closed')
    expect(getHUD()).toBeNull()
  })

  it('getHUD is null before any HUD is created', async () => {
    const { getHUD } = await import('./hud')
    expect(getHUD()).toBeNull()
  })

  it('showHUD creates the HUD on first call, waits for the ready handshake, then shows it', async () => {
    const { createHUD, showHUD, markReady } = await import('./hud')
    const showPromise = showHUD() // no HUD exists yet -> createHUD() internally
    // markReady() must be called AFTER createHUD's internal instance exists
    await Promise.resolve()
    markReady()
    await showPromise
    const win = instances[0]
    expect(win.showInactive).toHaveBeenCalled()
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(win.moveTop).toHaveBeenCalled()
  })

  it('showHUD reuses an already-created HUD instead of creating a second one', async () => {
    const { createHUD, showHUD, markReady } = await import('./hud')
    createHUD() // HUD now exists
    expect(instances).toHaveLength(1)
    const showPromise = showHUD()
    markReady()
    await showPromise
    expect(instances).toHaveLength(1) // no second BrowserWindow constructed
    expect(instances[0].showInactive).toHaveBeenCalled()
  })

  it('markReady is idempotent (a second call is a harmless no-op)', async () => {
    const { showHUD, markReady } = await import('./hud')
    const p = showHUD()
    markReady()
    await p
    expect(() => markReady()).not.toThrow()
  })

  it('setHUDPosition re-applies the computed bounds to an existing HUD (no-op if none exists)', async () => {
    const { createHUD, setHUDPosition } = await import('./hud')
    expect(() => setHUDPosition()).not.toThrow() // no HUD yet
    const win = createHUD()
    setHUDPosition()
    expect(win.setBounds).toHaveBeenCalled()
  })

  it('hideHUD is a no-op when there is no HUD or it is not visible', async () => {
    const { hideHUD, createHUD } = await import('./hud')
    const sendHide = vi.fn()
    await hideHUD(sendHide) // no HUD at all
    expect(sendHide).not.toHaveBeenCalled()

    const win = createHUD()
    ;(win.isVisible as ReturnType<typeof vi.fn>).mockReturnValue(false)
    await hideHUD(sendHide)
    expect(sendHide).not.toHaveBeenCalled()
  })

  it('hideHUD sends hide, waits for the renderer ack (markExitDone), then hides', async () => {
    const { createHUD, hideHUD, markExitDone } = await import('./hud')
    const win = createHUD()
    ;(win.isVisible as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const sendHide = vi.fn()
    const promise = hideHUD(sendHide)
    expect(sendHide).toHaveBeenCalled()
    markExitDone()
    await promise
    expect(win.hide).toHaveBeenCalled()
  })

  it('hideHUD falls through the 1s guard timer if the renderer never acks', async () => {
    const { createHUD, hideHUD } = await import('./hud')
    const win = createHUD()
    ;(win.isVisible as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const promise = hideHUD(vi.fn())
    await vi.advanceTimersByTimeAsync(1000)
    await promise
    expect(win.hide).toHaveBeenCalled()
  })

  it('markExitDone is idempotent (a second call without a pending hide is a no-op)', async () => {
    const { markExitDone } = await import('./hud')
    expect(() => markExitDone()).not.toThrow()
  })
})
