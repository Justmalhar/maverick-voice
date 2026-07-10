import { BrowserWindow } from 'electron'
import { join } from 'node:path'

let dashboard: BrowserWindow | null = null

export function createDashboard(): BrowserWindow {
  dashboard = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 700,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void dashboard.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void dashboard.loadFile(join(__dirname, '../renderer/index.html'))
  }
  dashboard.once('ready-to-show', () => dashboard?.show())
  dashboard.on('closed', () => {
    dashboard = null
  })
  return dashboard
}

export function getDashboard(): BrowserWindow | null {
  return dashboard
}

export function showDashboard(): void {
  if (!dashboard) createDashboard()
  dashboard?.show()
  dashboard?.focus()
}
