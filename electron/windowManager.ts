// ════════════════════════════════════════════════════════════════════════
// electron/windowManager.ts — owns the two BrowserWindows:
//   • main window  — 900×640 dashboard (History / Features / Settings / Privacy)
//   • HUD widget   — 520×140 frameless transparent always-on-top liquid-glass
//                    pill that appears while recording / processing.
//
// Ported near-verbatim from the reference unmute windowManager, re-skinned to
// pure-black glass and made cross-platform (macOS panel specifics are gated
// behind process.platform === 'darwin'; win32 uses frameless transparent
// equivalents). Imported by: main.ts, tray.ts (getMainWindow), sessionManager.ts
// (getWidgetWindow / showHUD / hideHUD / setHUDPosition / cancelPendingHide).
// ════════════════════════════════════════════════════════════════════════

import { BrowserWindow, screen, shell, app } from 'electron'
import path from 'path'

const isProduction = app.isPackaged
const isDarwin = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null
let hideTimeout: ReturnType<typeof setTimeout> | null = null

// Resolves once the widget renderer has mounted and registered its IPC
// listeners. showHUD() awaits this so the window never becomes visible before
// the React tree can paint the active state — which would otherwise show a
// transparent (invisible) panel while recording proceeds.
let hudReadyResolve: (() => void) | null = null
let hudReadyPromise: Promise<void> = new Promise<void>((resolve) => {
  hudReadyResolve = resolve
})

export function markHUDReady(): void {
  if (hudReadyResolve) {
    hudReadyResolve()
    hudReadyResolve = null
  }
}

function resetHUDReady(): void {
  if (hudReadyResolve) return
  hudReadyPromise = new Promise<void>((resolve) => {
    hudReadyResolve = resolve
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Kept as getWidgetWindow for the name sessionManager's sendToWidget depends on. */
export function getWidgetWindow(): BrowserWindow | null {
  return hudWindow
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 700,
    minHeight: 500,
    show: false,
    // Pure black so the black-glass dashboard never flashes a light frame.
    backgroundColor: '#000000',
    // macOS: inset traffic-light titlebar. win32: a frameless chrome (the
    // 'hiddenInset' style is mac-only; 'hidden' gives a clean frameless look).
    titleBarStyle: isDarwin ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isProduction,
    },
  })

  // Prevent external URLs (links) from navigating away from the app — open them
  // in the user's default browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow the dev server and packaged file:// navigation; block everything else.
    if (url.startsWith('http://localhost') || url.startsWith('file://')) return
    event.preventDefault()
    shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
}

/* ===============================
   HUD WIDGET WINDOW

   A 520×140 transparent frameless panel that drops in from the top of the
   screen when recording starts (center or right, see getHUDBounds). Hidden by
   default. Show/hide is driven by the main process (sessionManager); the
   entry/exit animations themselves live in the renderer CSS.
================================ */

const HUD_WIDTH = 520
// Slightly taller canvas than the pill itself so the multi-line error pill has
// room to grow without resizing the window. The pill anchors to the top of the
// canvas; the empty area is transparent and click-through.
const HUD_HEIGHT = 140

let hudPosition: 'center' | 'right' = 'center'

export function setHUDPosition(position: 'center' | 'right'): void {
  hudPosition = position
  // If the HUD exists and is visible, reposition immediately.
  if (hudWindow?.isVisible()) {
    hudWindow.setBounds(getHUDBounds())
  }
}

function getHUDBounds(): { x: number; y: number; width: number; height: number } {
  const display = screen.getPrimaryDisplay()
  const { workArea } = display

  let x: number
  if (hudPosition === 'right') {
    x = workArea.x + workArea.width - HUD_WIDTH - 12 // 12px from the right edge
  } else {
    x = workArea.x + Math.round((workArea.width - HUD_WIDTH) / 2) // centered
  }
  const y = workArea.y + 6 // 6px below the top of the work area (under the menu bar)

  return { x, y, width: HUD_WIDTH, height: HUD_HEIGHT }
}

export function createHUDWindow(): BrowserWindow {
  const { x, y, width, height } = getHUDBounds()

  hudWindow = new BrowserWindow({
    width,
    height,
    x,
    y,

    frame: false,
    transparent: true,
    resizable: false,
    // macOS: a borderless transparent panel needs no shadow (the glass draws its
    // own edge glow). On win32 a transparent window also has no native shadow.
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    // 'panel' is macOS-only — it lets the window float above full-screen apps
    // without becoming key. Omit it on win32 (transparent frameless still works).
    ...(isDarwin ? { type: 'panel' as const } : {}),
    alwaysOnTop: true,
    backgroundColor: '#00000000', // fully transparent — the glass pill paints itself

    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isProduction,
    },
  })

  hudWindow.setAlwaysOnTop(true, 'floating')

  // macOS-only window choreography — make the panel visible on every Space and
  // over full-screen apps, and never let it enter full-screen itself. These
  // APIs are no-ops/unsupported on win32, so gate them.
  if (isDarwin) {
    hudWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    })
    hudWindow.setFullScreenable(false)
  }

  // Re-position when the display changes (resolution change, external monitor).
  screen.on('display-metrics-changed', () => {
    if (!hudWindow || !hudWindow.isVisible()) return
    hudWindow.setBounds(getHUDBounds())
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    hudWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/widget`)
  } else {
    hudWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/widget',
    })
  }

  hudWindow.on('closed', () => {
    hudWindow = null
  })

  // Reset the ready promise on every (re)load (dev HMR, crash recovery) so the
  // next showHUD() waits for the fresh renderer to re-register its listeners.
  hudWindow.webContents.on('did-start-loading', resetHUDReady)

  return hudWindow
}

/** Cancel any pending delayed hide (from a prior session's exit animation).
 *  Called from sessionManager.cancelAutoHide() and from showHUD() (before AND
 *  after its await) so a session restart can't race an orphan hide() into a
 *  freshly-visible widget. */
export function cancelPendingHide(): void {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
}

/** Show the HUD — called when recording starts. Awaits renderer readiness so
 *  the panel never appears blank on a cold start. */
export async function showHUD(): Promise<void> {
  // Kill any pending hide BEFORE awaiting — otherwise the 220ms exit-animation
  // timer from a prior session could fire during the await and hide our window
  // immediately after we made it visible.
  cancelPendingHide()
  await hudReadyPromise
  if (!hudWindow) return

  // Re-check in case a hide was scheduled during the await (defense in depth).
  cancelPendingHide()

  // Recalculate position in case the display changed.
  hudWindow.setBounds(getHUDBounds())
  hudWindow.setIgnoreMouseEvents(false)
  hudWindow.setFocusable(true)
  hudWindow.showInactive() // show without stealing focus from the user's app

  // Force to front — showInactive() alone can leave the window behind other
  // always-on-top surfaces (macOS Stage Manager, some full-screen apps).
  hudWindow.setAlwaysOnTop(true, 'floating')
  hudWindow.moveTop()
}

/** Hide the HUD — called after output / error / cancel dismiss. */
export function hideHUD(): void {
  if (!hudWindow) return

  // Small delay to let the renderer play its exit animation first.
  hideTimeout = setTimeout(() => {
    if (!hudWindow) return
    hudWindow.hide()
    hudWindow.setFocusable(false)
    hideTimeout = null
  }, 220) // matches the .animate-hud-exit duration (200ms) + a small buffer
}

// Alias for the name main.ts uses when creating the widget window.
export const createWidgetWindow: typeof createHUDWindow = createHUDWindow
