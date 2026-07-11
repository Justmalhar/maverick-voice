import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { BrowserWindowMock, instances } = vi.hoisted(() => {
  const instances: any[] = []
  class BrowserWindowMock {
    static ctorArgs: unknown[] = []
    loadURL = vi.fn().mockResolvedValue(undefined)
    loadFile = vi.fn().mockResolvedValue(undefined)
    show = vi.fn()
    focus = vi.fn()
    private handlers = new Map<string, () => void>()
    constructor(opts: unknown) {
      BrowserWindowMock.ctorArgs.push(opts)
      instances.push(this)
    }
    once(event: string, cb: () => void) {
      this.handlers.set(`once:${event}`, cb)
    }
    on(event: string, cb: () => void) {
      this.handlers.set(event, cb)
    }
    fire(event: string) {
      this.handlers.get(event)?.()
    }
    fireOnce(event: string) {
      this.handlers.get(`once:${event}`)?.()
    }
  }
  return { BrowserWindowMock, instances }
})

vi.mock('electron', () => ({ BrowserWindow: BrowserWindowMock }))

const REAL_ENV = process.env['ELECTRON_RENDERER_URL']

describe('windows/dashboard', () => {
  beforeEach(() => {
    vi.resetModules()
    instances.length = 0
    BrowserWindowMock.ctorArgs.length = 0
    delete process.env['ELECTRON_RENDERER_URL']
  })
  afterEach(() => {
    if (REAL_ENV === undefined) delete process.env['ELECTRON_RENDERER_URL']
    else process.env['ELECTRON_RENDERER_URL'] = REAL_ENV
    vi.restoreAllMocks()
  })

  it('createDashboard loads a file in production (no dev server URL) and shows on ready-to-show', async () => {
    const { createDashboard, getDashboard } = await import('./dashboard')
    const win = createDashboard()
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('renderer/index.html'))
    expect(win.loadURL).not.toHaveBeenCalled()
    expect(getDashboard()).toBe(win)
    ;(win as any).fireOnce('ready-to-show')
    expect(win.show).toHaveBeenCalled()
  })

  it('loads the dev server URL when ELECTRON_RENDERER_URL is set', async () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const { createDashboard } = await import('./dashboard')
    const win = createDashboard()
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(win.loadFile).not.toHaveBeenCalled()
  })

  it('clears the module reference on "closed"', async () => {
    const { createDashboard, getDashboard } = await import('./dashboard')
    const win = createDashboard()
    ;(win as any).fire('closed')
    expect(getDashboard()).toBeNull()
  })

  it('applies hiddenInset titleBarStyle on darwin only', async () => {
    const REAL_PLATFORM = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    const { createDashboard } = await import('./dashboard')
    createDashboard()
    expect(BrowserWindowMock.ctorArgs.at(-1)).toMatchObject({ titleBarStyle: 'hiddenInset' })
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  })

  it('omits titleBarStyle on non-darwin platforms', async () => {
    const REAL_PLATFORM = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const { createDashboard } = await import('./dashboard')
    createDashboard()
    expect(BrowserWindowMock.ctorArgs.at(-1)).not.toHaveProperty('titleBarStyle')
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  })

  it('getDashboard returns null before any window has been created', async () => {
    const { getDashboard } = await import('./dashboard')
    expect(getDashboard()).toBeNull()
  })

  it('showDashboard creates a dashboard on first call, then reuses + focuses it', async () => {
    const { showDashboard, getDashboard } = await import('./dashboard')
    showDashboard()
    const win = getDashboard()
    expect(win).not.toBeNull()
    expect(win!.show).toHaveBeenCalledTimes(1)
    expect(win!.focus).toHaveBeenCalledTimes(1)

    showDashboard() // second call reuses the same window
    expect(instances).toHaveLength(1)
    expect(win!.show).toHaveBeenCalledTimes(2)
    expect(win!.focus).toHaveBeenCalledTimes(2)
  })
})
