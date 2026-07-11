import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { getSetting } from '../store/settings'

const HUD_WIDTH = 520
const HUD_HEIGHT = 140
const DOCK_CLEARANCE = 80
const RIGHT_INSET = 12

let hud: BrowserWindow | null = null
let hudReady: Promise<void> | null = null
let resolveReady: (() => void) | null = null
let resolveExitDone: (() => void) | null = null

function hudBounds(): { x: number; y: number; width: number; height: number } {
  // Display containing the cursor — not the primary display (v1 issue M9).
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const y = wa.y + wa.height - HUD_HEIGHT - DOCK_CLEARANCE
  const x =
    getSetting('widgetPosition') === 'right'
      ? wa.x + wa.width - HUD_WIDTH - RIGHT_INSET
      : wa.x + Math.round((wa.width - HUD_WIDTH) / 2)
  return { x, y, width: HUD_WIDTH, height: HUD_HEIGHT }
}

export function createHUD(): BrowserWindow {
  hudReady = new Promise((resolve) => {
    resolveReady = resolve
  })
  hud = new BrowserWindow({
    ...hudBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  if (process.platform === 'darwin') {
    hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    hud.setFullScreenable(false)
  }
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    void hud.loadURL(`${url}#/widget`)
  } else {
    void hud.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/widget' })
  }
  hud.on('closed', () => {
    hud = null
  })
  return hud
}

export function getHUD(): BrowserWindow | null {
  return hud
}

/** Renderer handshake (IPC.WIDGET_READY) — HUD never shows before React mounts. */
export function markReady(): void {
  resolveReady?.()
  resolveReady = null
}

/** Renderer ack (IPC.HUD_EXIT_DONE) — replaces v1's hand-tuned 220ms timer. */
export function markExitDone(): void {
  resolveExitDone?.()
  resolveExitDone = null
}

export async function showHUD(): Promise<void> {
  if (!hud) createHUD()
  await hudReady
  hud?.setBounds(hudBounds())
  hud?.showInactive()
  hud?.setAlwaysOnTop(true, 'floating')
  hud?.moveTop()
}

export function setHUDPosition(): void {
  hud?.setBounds(hudBounds())
}

export async function hideHUD(sendHide: () => void): Promise<void> {
  if (!hud || !hud.isVisible()) return
  const exited = new Promise<void>((resolve) => {
    resolveExitDone = resolve
  })
  sendHide()
  // Guard only — the renderer ack is the real signal.
  await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 1000))])
  hud?.hide()
}
