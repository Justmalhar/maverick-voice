// ════════════════════════════════════════════════════════════════════════
// electron/updater.ts — auto-update via electron-updater + Cloudflare R2.
//
// Uses the generic provider. The FEED_URL points at a public R2 bucket that
// holds only the release artifacts (DMG, EXE, .yml manifests) — the GitHub
// source repo stays private.
//
// Behaviour:
//   • Skips entirely in dev (app.isPackaged = false).
//   • Checks 10 s after launch so first-use is never blocked by network.
//   • Downloads silently in the background.
//   • Prompts the user once the download is complete; they choose
//     "Restart now" or "Later". autoInstallOnAppQuit = true handles "Later".
//   • All errors are swallowed — a broken update check never crashes the app.
// ════════════════════════════════════════════════════════════════════════

import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

// ── Replace this with your R2 public bucket URL after setup.
// Example: https://pub-abc123.r2.dev/releases
//          https://updates.yourdomain.com/releases  (custom domain)
const FEED_URL = 'https://REPLACE_WITH_YOUR_R2_PUBLIC_URL/releases'

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `Maverick Voice ${info.version} is ready to install.`,
        detail: 'Restart now to apply the update, or it will be applied on next launch.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true)
      })
      .catch(() => {
        /* ignore — user closed the dialog */
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] check failed:', err.message)
  })

  // Delay the first check so the app is fully usable before any network I/O.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* ignore */
    })
  }, 10_000)
}
