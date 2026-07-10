// ════════════════════════════════════════════════════════════════════════
// electron/output/selection.ts — capture the active app's selected text via a
// synthesized copy round-trip. Ported from v1 clipboard.ts; the sequence is
// load-bearing:
//
//   save clipboard → clear → simulate Cmd/Ctrl+C → 150 ms settle → read →
//   restore clipboard
//
// v2 fix over v1: the saved clipboard includes the image content
// (clipboard.readImage) and restores it when non-empty — v1 restored text
// only and destroyed images/screenshots the user had copied.
//
// darwin copy fast path: injected `opts.helperCommand('COPY')` (mac-helper
// CGEvent, ack 'COPY_OK'); keys/listener.ts is written in parallel so it is
// never imported here. Fallback: osascript System Events — the ONLY reliable
// path when the helper is absent, since CGEvent posted from the Electron
// process drops events silently in packaged apps.
// ════════════════════════════════════════════════════════════════════════

import { clipboard, type NativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TIMEOUTS } from '../config'

const execFileAsync = promisify(execFile)

export type HelperCommand = (cmd: 'PASTE' | 'COPY') => Promise<string>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

let xdotoolCheck: Promise<boolean> | null = null
function hasXdotool(): Promise<boolean> {
  xdotoolCheck ??= execFileAsync('which', ['xdotool']).then(() => true, () => false)
  return xdotoolCheck
}

/** Simulate the platform copy keystroke. Throws on failure/unavailability. */
async function simulateCopy(helperCommand?: HelperCommand): Promise<void> {
  if (process.platform === 'darwin') {
    // Fast path: helper CGEvent copy (~5 ms), verified via COPY_OK ack.
    if (helperCommand) {
      try {
        const reply = await withTimeout(helperCommand('COPY'), TIMEOUTS.helperCommand)
        if (reply === 'COPY_OK') return
        console.warn('[selection] helper COPY unexpected reply, falling back to osascript')
      } catch (err) {
        console.warn(
          '[selection] helper COPY failed/timed out, falling back to osascript:',
          err instanceof Error ? err.message : err
        )
      }
    }
    // osascript System Events: reliable when packaged (CGEvent from Electron
    // drops silently in packaged apps). execFile to skip shell overhead.
    await execFileAsync('/usr/bin/osascript', [
      '-e',
      'tell application "System Events" to keystroke "c" using command down'
    ])
    return
  }

  if (process.platform === 'win32') {
    // SendKeys: '^c' == Ctrl+C.
    await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')"
    ])
    return
  }

  // linux x11 (wayland is rejected before we get here)
  if (!(await hasXdotool())) throw new Error('xdotool not available')
  await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+c'])
}

/** Restore whatever the user had on the clipboard before we touched it. */
function restoreClipboard(savedText: string, savedImage: NativeImage): void {
  if (!savedImage.isEmpty()) {
    // v1 lost non-text content here — restore image (and text alongside it).
    clipboard.write(savedText ? { text: savedText, image: savedImage } : { image: savedImage })
  } else {
    clipboard.writeText(savedText)
  }
}

/**
 * Try to capture selected text from the active application.
 *
 * Strategy:
 * 1. Save the current clipboard (text AND image) so we can restore it.
 * 2. Clear the clipboard so a fresh copy is detectable.
 * 3. Simulate Cmd/Ctrl+C, wait 150 ms for the clipboard to settle
 *    (load-bearing: the target app writes the pasteboard asynchronously after
 *    receiving the keystroke; v1-tuned — shorter loses copies from slow apps).
 * 4. Read the result, restore the original clipboard, return the selection.
 * 5. If the simulation fails (e.g. Accessibility not granted on macOS),
 *    restore the clipboard and — only when `useClipboardFallback` — return the
 *    saved clipboard text as context.
 *
 * @param opts.useClipboardFallback TRUE only for instruction mode; FALSE for
 *   dictation.
 * @param opts.helperCommand mac-helper stdin command (darwin CGEvent copy fast
 *   path). Injected by main wiring; keys/listener.ts is never imported here.
 */
export async function captureSelectedText(opts: {
  useClipboardFallback: boolean
  helperCommand?: HelperCommand
}): Promise<string | null> {
  // Wayland (or unknown non-x11 session) has no synthesized-copy path at all —
  // bail before destroying the user's clipboard.
  if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE !== 'x11') {
    console.log('[selection] no copy path on wayland — skipping capture')
    return null
  }

  try {
    // Save current clipboard content — text and image (v1 saved text only).
    const savedText = clipboard.readText()
    const savedImage = clipboard.readImage()
    console.log('[selection] saved clipboard, text length:', savedText.length, 'hasImage:', !savedImage.isEmpty())

    // Clear clipboard to detect whether Cmd/Ctrl+C actually copies something new.
    clipboard.clear()

    try {
      await simulateCopy(opts.helperCommand)
      // Wait for clipboard to update (load-bearing async settle — see docblock).
      await sleep(150)

      const selectedText = clipboard.readText()
      console.log('[selection] after copy, clipboard length:', selectedText.length)

      // Restore original clipboard.
      restoreClipboard(savedText, savedImage)

      // Clipboard still empty ⇒ nothing was selected.
      if (!selectedText || selectedText.trim() === '') {
        console.log('[selection] no text was selected via copy')
        return null
      }
      return selectedText
    } catch (err) {
      // Simulation failed — Accessibility not granted (macOS), SendKeys
      // blocked, or xdotool missing.
      console.log('[selection] copy simulation failed:', err instanceof Error ? err.message : err)

      // Restore clipboard (we cleared it above).
      restoreClipboard(savedText, savedImage)

      // Fallback: use existing clipboard text as context if requested
      // (instruction mode only).
      if (opts.useClipboardFallback && savedText && savedText.trim() !== '') {
        console.log('[selection] using clipboard contents as context (fallback), length:', savedText.length)
        return savedText
      }
      return null
    }
  } catch (err) {
    console.error('[selection] failed to capture selected text:', err instanceof Error ? err.message : err)
    return null
  }
}
