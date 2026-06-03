// ════════════════════════════════════════════════════════════════════════
// electron/tray.ts — the menu-bar / system-tray icon for Maverick Voice.
//
// Builds a procedural alpha glyph from the bundled menubar-icon.png and pulses
// it (an 8-frame sine fade) while recording. On macOS the glyph ships as a
// template image so the OS tints it for light/dark menu bars; on win32 template
// images render wrong, so the same alpha bitmap is emitted as a plain
// white-on-transparent icon. Ported from the reference unmute tray, rebranded.
//
// Imported by: main.ts (createTray), sessionManager.ts (setTrayRecording /
// setTrayIdle).
// ════════════════════════════════════════════════════════════════════════

import { Tray, Menu, nativeImage, NativeImage, app } from 'electron'
import path from 'path'
import { existsSync } from 'fs'
import { showMainWindow } from './windowManager'

const isDarwin = process.platform === 'darwin'

let tray: Tray | null = null
let animTimer: ReturnType<typeof setInterval> | null = null
let animFrame = 0

// Pre-generated animation frames.
let idleIcon: NativeImage | null = null
let dictationFrames: NativeImage[] = []
let instructionFrames: NativeImage[] = []

const ICON_SIZE = 18
const FRAME_COUNT = 8
const SCALE = 2 // render @2x for crisp Retina menu-bar rendering

// The brand mark, tightly cropped, at ICON_SIZE*SCALE — alpha only, RGB = 0.
// Built once from the bundled menubar-icon.png (white mark on a dark square).
let baseGlyph: { buf: Buffer; w: number; h: number } | null = null

/**
 * Resolve the menubar-icon.png across dev + packaged layouts. The architect's
 * electron-builder config copies `resources/icons` → `Contents/Resources/icons`,
 * but the asset currently also lives at the resources root, so both shapes are
 * probed (dev project root + every packaged candidate).
 */
function getMenubarSourcePath(): string | null {
  const candidates = [
    // Packaged: process.resourcesPath = .app/Contents/Resources
    path.join(process.resourcesPath || '', 'icons', 'menubar-icon.png'),
    path.join(process.resourcesPath || '', 'menubar-icon.png'),
    // Dev: relative to the project root
    path.join(app.getAppPath(), 'resources', 'icons', 'menubar-icon.png'),
    path.join(app.getAppPath(), 'resources', 'menubar-icon.png'),
    path.join(__dirname, '..', '..', 'resources', 'icons', 'menubar-icon.png'),
    path.join(__dirname, '..', '..', 'resources', 'menubar-icon.png'),
  ]
  return candidates.find((c) => existsSync(c)) || null
}

/**
 * Load the app icon, isolate the bright mark (white shape on a dark square),
 * crop it tight, and produce an alpha-only bitmap. As a macOS template image
 * the OS tints it (white on a dark menu bar, black on a light one); on win32 we
 * keep the alpha as-is and paint it white.
 */
function buildBaseGlyph(): void {
  const src = getMenubarSourcePath()
  if (!src) {
    console.error('[tray] menubar-icon.png not found — falling back to dot')
    return
  }
  const img = nativeImage.createFromPath(src)
  const { width: sw, height: sh } = img.getSize()
  const bmp = img.toBitmap() // BGRA, premultiplied

  // alpha = luminance × source-alpha → keeps only the bright mark, drops the
  // dark square (low luminance) and the transparent corners.
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
  if (maxX < minX) return // nothing found

  // Crop to the mark, then letterbox into a square with a little padding so it
  // sits nicely in the menu bar / tray.
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
      // win32 paints white (template images render wrong on Windows); macOS
      // uses RGB=0 + template tinting.
      const rgb = isDarwin ? 0 : 255
      out[di] = rgb
      out[di + 1] = rgb
      out[di + 2] = rgb
      out[di + 3] = a
    }
  }
  baseGlyph = { buf: out, w: target, h: target }
}

/** A NativeImage of the brand mark at the given opacity. */
function glyphAt(alpha: number): NativeImage {
  if (!baseGlyph) {
    // Fallback: a simple filled dot if the asset failed to load.
    const s = ICON_SIZE * SCALE,
      b = Buffer.alloc(s * s * 4),
      c = s / 2,
      rad = s * 0.28
    const rgb = isDarwin ? 0 : 255
    for (let y = 0; y < s; y++)
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
    const fb = nativeImage.createFromBuffer(b, { width: s, height: s, scaleFactor: SCALE })
    if (isDarwin) fb.setTemplateImage(true)
    return fb
  }
  const { buf, w, h } = baseGlyph
  const out = Buffer.from(buf) // copy
  for (let p = 0; p < w * h; p++) out[p * 4 + 3] = Math.round(out[p * 4 + 3] * alpha)
  const img = nativeImage.createFromBuffer(out, { width: w, height: h, scaleFactor: SCALE })
  if (isDarwin) img.setTemplateImage(true)
  return img
}

/** Pulse frames — the mark fades in and out while recording. */
function generatePulseFrames(): NativeImage[] {
  const frames: NativeImage[] = []
  for (let f = 0; f < FRAME_COUNT; f++) {
    const t = f / FRAME_COUNT
    const alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2)) // 0.4 → 1.0
    frames.push(glyphAt(alpha))
  }
  return frames
}

export function createTray(): void {
  buildBaseGlyph()

  // Static idle icon: the brand mark at full opacity (template on macOS).
  idleIcon = glyphAt(1)

  // Recording: the mark pulses (same animation for both modes).
  dictationFrames = generatePulseFrames()
  instructionFrames = generatePulseFrames()

  tray = new Tray(idleIcon)
  tray.setToolTip('Maverick Voice')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Maverick Voice', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Dictation: press your hotkey to start',
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => showMainWindow())
}

/** Start the pulsing animation on the tray icon (called when recording starts). */
export function setTrayRecording(mode: 'dictation' | 'instruction'): void {
  if (!tray) return

  stopTrayAnimation()

  const frames = mode === 'dictation' ? dictationFrames : instructionFrames
  animFrame = 0

  animTimer = setInterval(() => {
    if (!tray || frames.length === 0) return
    tray.setImage(frames[animFrame % frames.length])
    animFrame++
  }, 120) // ~8fps pulse
}

/** Stop the animation and return to the idle icon. */
export function setTrayIdle(): void {
  stopTrayAnimation()
  if (tray && idleIcon) {
    tray.setImage(idleIcon)
  }
}

function stopTrayAnimation(): void {
  if (animTimer) {
    clearInterval(animTimer)
    animTimer = null
  }
  animFrame = 0
}

export function getTray(): Tray | null {
  return tray
}
