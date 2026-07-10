// ─── electron/windows/tray.ts — menu-bar / system-tray icon ───
// Ported from legacy/electron/tray.ts (procedural glyph + pulse animation),
// fixing LEGACY-ISSUES §2 C13: pulse frames are generated ONCE and reused for
// both dictation and instruction modes (v1 generated the identical 8-frame
// set twice). darwin ships a template image (OS tints for light/dark menu
// bars); win32/linux get a plain white-on-transparent bitmap.

import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { showDashboard } from './dashboard'

const isDarwin = process.platform === 'darwin'

const ICON_SIZE = 18
const FRAME_COUNT = 8
const SCALE = 2 // @2x for crisp Retina rendering
const PULSE_INTERVAL_MS = 120 // ~8fps, v1-tuned

let tray: Tray | null = null
let animTimer: NodeJS.Timeout | null = null
let animFrame = 0
let idleIcon: NativeImage | null = null
let pulseFrames: NativeImage[] = []
let baseGlyph: { buf: Buffer; w: number; h: number } | null = null

function iconSourcePath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'icons', 'menubar-icon.png'),
    path.join(app.getAppPath(), 'resources', 'icons', 'menubar-icon.png'),
    // Bare `electron dist/electron/main.js` runs resolve appPath to the
    // script dir — walk up from dist/electron like keys/listenerDarwin does.
    path.join(__dirname, '../../resources/icons', 'menubar-icon.png')
  ]
  return candidates.find((c) => existsSync(c)) || null
}

/** Isolate the bright mark (white shape on a dark square) from the source
 *  PNG, crop tight, letterbox into a padded square, alpha-only bitmap. */
function buildBaseGlyph(): void {
  const src = iconSourcePath()
  if (!src) {
    console.error('[tray] menubar-icon.png not found — falling back to a dot glyph')
    return
  }
  const img = nativeImage.createFromPath(src)
  const { width: sw, height: sh } = img.getSize()
  const bmp = img.toBitmap() // BGRA, premultiplied

  const alpha = new Uint8Array(sw * sh)
  let minX = sw,
    minY = sh,
    maxX = 0,
    maxY = 0
  for (let p = 0; p < sw * sh; p++) {
    const b = bmp[p * 4],
      g = bmp[p * 4 + 1],
      r = bmp[p * 4 + 2],
      sa = bmp[p * 4 + 3]
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) * (sa / 255)
    const a = lum > 40 ? Math.min(255, Math.round(lum)) : 0
    alpha[p] = a
    if (a > 24) {
      const x = p % sw,
        y = (p / sw) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) return

  const cropW = maxX - minX + 1,
    cropH = maxY - minY + 1
  const target = ICON_SIZE * SCALE
  const pad = Math.round(target * 0.12)
  const inner = target - pad * 2
  const k = Math.min(inner / cropW, inner / cropH)
  const drawW = Math.round(cropW * k),
    drawH = Math.round(cropH * k)
  const offX = ((target - drawW) / 2) | 0,
    offY = ((target - drawH) / 2) | 0

  const out = Buffer.alloc(target * target * 4)
  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const sx = minX + Math.min(cropW - 1, Math.floor(x / k))
      const sy = minY + Math.min(cropH - 1, Math.floor(y / k))
      const a = alpha[sy * sw + sx]
      const di = ((offY + y) * target + (offX + x)) * 4
      const rgb = isDarwin ? 0 : 255
      out[di] = rgb
      out[di + 1] = rgb
      out[di + 2] = rgb
      out[di + 3] = a
    }
  }
  baseGlyph = { buf: out, w: target, h: target }
}

function glyphAt(alpha: number): NativeImage {
  if (!baseGlyph) {
    const s = ICON_SIZE * SCALE,
      b = Buffer.alloc(s * s * 4),
      c = s / 2,
      rad = s * 0.28
    const rgb = isDarwin ? 0 : 255
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = x - c + 0.5,
          dy = y - c + 0.5,
          i = (y * s + x) * 4
        const on = Math.sqrt(dx * dx + dy * dy) < rad
        b[i] = on ? rgb : 0
        b[i + 1] = on ? rgb : 0
        b[i + 2] = on ? rgb : 0
        b[i + 3] = on ? Math.round(alpha * 255) : 0
      }
    }
    const fb = nativeImage.createFromBuffer(b, { width: s, height: s, scaleFactor: SCALE })
    if (isDarwin) fb.setTemplateImage(true)
    return fb
  }
  const { buf, w, h } = baseGlyph
  const out = Buffer.from(buf)
  for (let p = 0; p < w * h; p++) out[p * 4 + 3] = Math.round(out[p * 4 + 3] * alpha)
  const img = nativeImage.createFromBuffer(out, { width: w, height: h, scaleFactor: SCALE })
  if (isDarwin) img.setTemplateImage(true)
  return img
}

function generatePulseFrames(): NativeImage[] {
  const frames: NativeImage[] = []
  for (let f = 0; f < FRAME_COUNT; f++) {
    const t = f / FRAME_COUNT
    const alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2))
    frames.push(glyphAt(alpha))
  }
  return frames
}

export function createTray(): void {
  buildBaseGlyph()
  idleIcon = glyphAt(1)
  pulseFrames = generatePulseFrames() // generated ONCE, reused for both modes

  tray = new Tray(idleIcon)
  tray.setToolTip('Maverick Voice')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Maverick Voice', click: () => showDashboard() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  tray.on('click', () => showDashboard())
}

function stopAnimation(): void {
  if (animTimer) {
    clearInterval(animTimer)
    animTimer = null
  }
  animFrame = 0
}

/** Start the pulse animation (same frame set for both dictation/instruction). */
export function setTrayRecording(_mode: 'dictation' | 'instruction'): void {
  if (!tray) return
  stopAnimation()
  animTimer = setInterval(() => {
    if (!tray || pulseFrames.length === 0) return
    tray.setImage(pulseFrames[animFrame % pulseFrames.length])
    animFrame++
  }, PULSE_INTERVAL_MS)
}

export function setTrayIdle(): void {
  stopAnimation()
  if (tray && idleIcon) tray.setImage(idleIcon)
}

export function getTray(): Tray | null {
  return tray
}
