// ─── Centralized Error Logger ───
// Broadcasts errors to the renderer's Developer view (last-error display).
// Keeps an in-memory ring of recent errors (no disk persistence).

import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'

export interface ErrorEntry {
  source: string
  message: string
  timestamp: string
}

const MAX_ERRORS = 50
const recentErrors: ErrorEntry[] = []

// Reference to the main window — set once during init.
let mainWindowGetter: (() => BrowserWindow | null) | null = null

export function initErrorLogger(getMainWindow: () => BrowserWindow | null): void {
  mainWindowGetter = getMainWindow
}

export function broadcastError(source: string, message: string): void {
  const entry: ErrorEntry = {
    source,
    message,
    timestamp: new Date().toISOString()
  }

  // Store in memory (newest first), capped to MAX_ERRORS.
  recentErrors.unshift(entry)
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.length = MAX_ERRORS
  }

  console.error(`[error-log] [${source}] ${message}`)

  // Send to renderer Developer view.
  const mainWin = mainWindowGetter?.()
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(IPC.DEV_ERROR_LOG, entry)
  }
}

export function getRecentErrors(): ErrorEntry[] {
  return recentErrors
}
