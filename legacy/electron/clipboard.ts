// ════════════════════════════════════════════════════════════════════════
// electron/clipboard.ts — selection capture + output injection via simulated
// copy/paste, cross-platform.
//
//  - darwin: osascript System Events keystroke (the ONLY reliable path — CGEvent
//    drops events silently in packaged apps).
//  - win32: clipboard + PowerShell SendKeys ('^c' / '^v') via wscript.shell.
//
// The save → clear → simulate → 150ms settle → read → restore clipboard dance
// is identical on both platforms so callers (sessionManager) stay platform-blind.
// ════════════════════════════════════════════════════════════════════════

import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Simulate a keyboard shortcut (copy/paste). Branches on platform.
 *
 *  - darwin: `osascript -e 'tell application "System Events" to keystroke
 *    "<key>" using <modifier> down'`. This is the ONLY reliable path — CGEvent
 *    via helper binaries drops events SILENTLY in packaged apps.
 *  - win32: PowerShell wscript.shell SendKeys with a '^' (Ctrl) prefix
 *    ('^c' / '^v'). The clipboard already holds the text for paste.
 *
 * @param key      'c' (copy) or 'v' (paste)
 * @param modifier macOS modifier name (e.g. 'command'); ignored on win32 (uses '^').
 */
async function simulateKeyCombo(key: string, modifier: string): Promise<void> {
  if (process.platform === 'darwin') {
    const script = `tell application "System Events" to keystroke "${key}" using ${modifier} down`
    // execFile to skip shell overhead (~10-20ms faster than exec).
    console.log(`[clipboard] Using osascript for ${key} (reliable path)`)
    try {
      await execFileAsync('/usr/bin/osascript', ['-e', script])
      console.log(`[clipboard] osascript ${key} succeeded`)
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string }
      console.error('[clipboard] osascript error:', e.message, e.stderr ? `stderr: ${e.stderr}` : '')
      throw err
    }
    return
  }

  if (process.platform === 'win32') {
    // SendKeys: '^' == Ctrl. '^c' = copy, '^v' = paste.
    const sendKeysArg = `^${key}`
    const script = `$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${sendKeysArg}')`
    console.log(`[clipboard] Using PowerShell SendKeys for ${sendKeysArg}`)
    try {
      await execFileAsync('powershell', ['-NoProfile', '-Command', script])
      console.log(`[clipboard] PowerShell SendKeys ${sendKeysArg} succeeded`)
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string }
      console.error('[clipboard] PowerShell error:', e.message, e.stderr ? `stderr: ${e.stderr}` : '')
      throw err
    }
    return
  }

  throw new Error('Key simulation not implemented for this platform')
}

/**
 * Try to capture selected text from the active application.
 *
 * Strategy:
 * 1. Save + clear the clipboard so we can detect a fresh copy.
 * 2. Simulate Ctrl/Cmd+C, wait 150ms for the clipboard to settle (load-bearing).
 * 3. Read the result, restore the original clipboard, return the selection.
 * 4. If the simulation fails (e.g. Accessibility not granted on macOS), restore
 *    the clipboard and — only when `useClipboardFallback` — return the saved
 *    clipboard contents as context.
 *
 * @param useClipboardFallback If true, reads clipboard as fallback when simulate fails.
 *                             TRUE only for instruction mode; FALSE for dictation.
 */
export async function captureSelectedText(useClipboardFallback: boolean = false): Promise<string | null> {
  try {
    // Save current clipboard content
    const savedClipboard = clipboard.readText()
    console.log('[clipboard] Current clipboard length:', savedClipboard.length)

    // Clear clipboard to detect if Cmd/Ctrl+C actually copies something new
    clipboard.writeText('')

    // Try to simulate copy (Cmd+C on darwin, Ctrl+C on win32)
    try {
      await simulateKeyCombo('c', 'command')
      // Wait for clipboard to update (load-bearing async settle)
      await sleep(150)

      // Read the new clipboard content
      const selectedText = clipboard.readText()
      console.log(
        '[clipboard] After copy, clipboard length:',
        selectedText.length,
        'text:',
        selectedText ? JSON.stringify(selectedText.substring(0, 80)) : 'empty'
      )

      // Restore original clipboard
      clipboard.writeText(savedClipboard)

      // If clipboard is still empty, nothing was selected
      if (!selectedText || selectedText.trim() === '') {
        console.log('[clipboard] No text was selected via copy')
        return null
      }

      return selectedText
    } catch {
      // Simulation failed — Accessibility not granted (macOS) or SendKeys blocked
      console.log('[clipboard] Copy simulation failed (Accessibility permission needed)')

      // Restore clipboard (we cleared it above)
      clipboard.writeText(savedClipboard)

      // Fallback: use clipboard contents as context if requested
      if (useClipboardFallback && savedClipboard && savedClipboard.trim() !== '') {
        console.log('[clipboard] Using clipboard contents as context (fallback), length:', savedClipboard.length)
        console.log('[clipboard] Clipboard preview:', JSON.stringify(savedClipboard.substring(0, 100)))
        return savedClipboard
      }

      return null
    }
  } catch (err) {
    console.error('[clipboard] Failed to capture selected text:', err)
    return null
  }
}

/**
 * Inject output text at the cursor. Writes to the clipboard FIRST (so manual
 * paste works even if auto-paste fails), then simulates Cmd/Ctrl+V. Errors are
 * swallowed — the text is on the clipboard regardless.
 */
export async function injectOutput(text: string): Promise<void> {
  // Always copy to clipboard first
  clipboard.writeText(text)
  console.log('[clipboard] Output copied to clipboard, length:', text.length)

  // Try to simulate paste (Cmd+V on darwin, Ctrl+V on win32) to auto-paste
  try {
    await simulateKeyCombo('v', 'command')
    console.log('[clipboard] Auto-paste succeeded')
  } catch (err) {
    // Auto-paste failed — text is in clipboard, user can paste manually
    console.error('[clipboard] Auto-paste FAILED:', err instanceof Error ? err.message : err)
    console.log('[clipboard] Text is in clipboard, user can paste manually')
  }
}

export function copyToClipboard(text: string): void {
  clipboard.writeText(text)
  console.log('[clipboard] Text copied to clipboard, length:', text.length)
}
