// ─── electron/updater.ts — electron-updater against a generic R2 feed ───
// Never blocks boot: start() is fire-and-forget, every failure is logged
// once (not per-check) and swallowed. Skipped entirely in dev (!app.isPackaged)
// since unpackaged builds have no code signature for the updater to verify
// (LEGACY-ISSUES M10 — v1 shipped a placeholder feed that never resolved).

import { app } from 'electron'

// CONFIRM before release: this must point at the real published R2 bucket
// (SYSTEM-DESIGN §8 CI asserts the release manifest is uploaded here).
const FEED_URL = 'https://updates.getmaverick.sh/releases'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
let started = false
let errorLogged = false

function logErrorOnce(err: unknown): void {
  if (errorLogged) return
  errorLogged = true
  console.warn('[updater] check failed (will keep retrying silently):', err instanceof Error ? err.message : err)
}

export async function startUpdater(): Promise<void> {
  if (started || !app.isPackaged) return
  started = true
  try {
    // ponytail: lazy import — electron-updater drags ajv/js-yaml/fs-extra/lodash/semver
    // onto every boot even though this path only runs when packaged.
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL })
    autoUpdater.autoDownload = false
    autoUpdater.on('error', (err) => logErrorOnce(err))

    const check = (): void => {
      autoUpdater.checkForUpdates().catch((err) => logErrorOnce(err))
    }
    check()
    setInterval(check, CHECK_INTERVAL_MS)
  } catch (err) {
    logErrorOnce(err)
  }
}
