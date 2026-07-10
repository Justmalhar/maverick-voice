// ════════════════════════════════════════════════════════════════════════
// electron/output/inject.ts — output injection (clipboard + synthesized paste).
//
// Clipboard is written FIRST, always — manual paste works even if the
// auto-paste keystroke fails. Keystroke errors are swallowed (but logged)
// because the text is already on the clipboard.
//
// darwin fast path: the mac-helper CGEvent paste (~5 ms, acked with PASTE_OK).
// The helper is owned by keys/listener.ts, which is written in parallel — so
// this module does NOT import it. Callers inject `opts.helperCommand`
// (main wiring passes `keyListener.command`). Absence/failure/timeout falls
// back to osascript.
// ════════════════════════════════════════════════════════════════════════

import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TIMEOUTS } from '../config'

const execFileAsync = promisify(execFile)

export type HelperCommand = (cmd: 'PASTE' | 'COPY') => Promise<string>

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

// `which xdotool` result cached for the process lifetime (linux only).
let xdotoolCheck: Promise<boolean> | null = null
function hasXdotool(): Promise<boolean> {
  xdotoolCheck ??= execFileAsync('which', ['xdotool']).then(() => true, () => false)
  return xdotoolCheck
}

export function copyToClipboard(text: string): void {
  clipboard.writeText(text)
  console.log('[output] text copied to clipboard, length:', text.length)
}

/**
 * Inject output text at the cursor. Writes to the clipboard FIRST (so manual
 * paste works even if auto-paste fails), then synthesizes a platform paste
 * keystroke. Never rejects for keystroke failures.
 *
 * @param opts.helperCommand mac-helper stdin command (darwin CGEvent fast
 *   path, ack 'PASTE_OK'). Injected by main wiring; optional so this module
 *   never imports keys/listener.ts.
 * @returns `{ degraded: 'clipboard-only' }` when no keystroke path exists
 *   (linux Wayland / missing xdotool) so the HUD can show
 *   "Copied — press Ctrl+V" instead of pretending it pasted.
 */
export async function injectOutput(
  text: string,
  opts?: { helperCommand?: HelperCommand }
): Promise<{ degraded?: 'clipboard-only' }> {
  // Always copy to clipboard first.
  clipboard.writeText(text)
  console.log('[output] output copied to clipboard, length:', text.length)

  if (process.platform === 'darwin') {
    // Fast path: helper CGEvent paste (~5 ms), verified at runtime via the
    // PASTE_OK ack — anything else falls through to osascript.
    if (opts?.helperCommand) {
      try {
        const reply = await withTimeout(opts.helperCommand('PASTE'), TIMEOUTS.helperCommand)
        if (reply === 'PASTE_OK') {
          console.log('[output] helper CGEvent paste succeeded')
          return {}
        }
        console.warn('[output] helper PASTE unexpected reply, falling back to osascript')
      } catch (err) {
        console.warn(
          '[output] helper PASTE failed/timed out, falling back to osascript:',
          err instanceof Error ? err.message : err
        )
      }
    }
    // Fallback: osascript System Events keystroke. This is the proven path —
    // CGEvent posted from the Electron process drops events SILENTLY in
    // packaged apps, so osascript stays the reliable fallback.
    try {
      await execFileAsync('/usr/bin/osascript', [
        '-e',
        'tell application "System Events" to keystroke "v" using command down'
      ])
      console.log('[output] osascript paste succeeded')
    } catch (err) {
      // Swallowed: text is on the clipboard, user can paste manually.
      console.error('[output] osascript paste failed:', err instanceof Error ? err.message : err)
    }
    return {}
  }

  if (process.platform === 'win32') {
    try {
      // SendKeys: '^v' == Ctrl+V. Clipboard already holds the text.
      await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"
      ])
      console.log('[output] SendKeys paste succeeded')
    } catch (err) {
      console.error('[output] SendKeys paste failed:', err instanceof Error ? err.message : err)
    }
    return {}
  }

  // linux
  if (process.env.XDG_SESSION_TYPE === 'x11' && (await hasXdotool())) {
    try {
      await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+v'])
      console.log('[output] xdotool paste succeeded')
    } catch (err) {
      console.error('[output] xdotool paste failed:', err instanceof Error ? err.message : err)
    }
    return {}
  }
  // Wayland or no xdotool — no synthesized-keystroke path exists.
  console.log('[output] no paste path (wayland/no xdotool) — clipboard-only')
  return { degraded: 'clipboard-only' }
}
