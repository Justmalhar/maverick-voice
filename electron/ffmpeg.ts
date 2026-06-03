import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Resolve the ffmpeg binary path.
 * In development: use the ffmpeg-static package from node_modules.
 * In packaged app: use the binary asarUnpack'd next to the asar
 * (electron-builder asarUnpacks node_modules/ffmpeg-static per package.json).
 *
 * Cross-platform: the binary is named `ffmpeg.exe` on win32, `ffmpeg` elsewhere.
 */
export function getFFmpegPath(): string | null {
  const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const appPath = app.getAppPath()
  const candidates = [
    // Development: ffmpeg-static in node_modules.
    path.join(appPath, 'node_modules', 'ffmpeg-static', bin),
    // Packaged app: ffmpeg-static is asarUnpack'd next to the asar. A path
    // INSIDE app.asar reports as existing (asar fs shim) but cannot be spawned
    // — it fails with ENOTDIR — so we must use the .unpacked location.
    path.join(appPath.replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules', 'ffmpeg-static', bin),
    path.join(process.resourcesPath || '', bin),
  ]

  for (const candidate of candidates) {
    // CRITICAL: skip any path still inside app.asar — existsSync lies for those
    // (the asar fs shim reports them as existing), and spawning them throws
    // ENOTDIR. Use the .unpacked location instead.
    if (candidate.includes(`app.asar${path.sep}`)) continue
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  console.error('[ffmpeg] No ffmpeg binary found. Checked:', candidates)
  return null
}
