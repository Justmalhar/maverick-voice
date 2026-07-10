// ════════════════════════════════════════════════════════════════════════
// electron/frontmostApp.ts — detect the frontmost (focused) application.
//
// Used by sessionManager at dictation-session START to choose an app-aware
// AUTO_FORMAT profile (see appProfiles.ts). This module is the DETECTION seam;
// the mapping table lives in appProfiles.ts.
//
//  - darwin PRIMARY: ask the running globe-listener helper over its stdin
//    protocol (keyListener.requestFrontApp, which issues the `FRONTAPP` command
//    and resolves the `<bundleId>|<localizedName>` reply built from
//    NSWorkspace.shared.frontmostApplication).
//  - darwin FALLBACK (helper unavailable / rejected): osascript System Events.
//  - win32: PowerShell Add-Type P/Invoke (GetForegroundWindow +
//    GetWindowThreadProcessId + Process.GetProcessById) -> `<proc>|<title>`.
//    ProcessName has no extension on Windows, so it is normalized to `<name>.exe`
//    so it matches the win32 entries in appProfiles.ts.
//
// CONTRACT: getFrontmostApp() NEVER throws and resolves `null` on any failure
// or after an internal ~800ms timeout. It must NEVER block or delay the caller
// beyond that window (sessionManager kicks it off without awaiting).
// ════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { keyListener } from './keyListener'

const execFileAsync = promisify(execFile)

/** Hard cap on the whole detection — resolves `null` past this. */
const DETECTION_TIMEOUT_MS = 800

/**
 * The globe-listener seam exposes `requestFrontApp()` (darwin), which resolves
 * the raw reply payload `<bundleId>|<localizedName>` (the `FRONTAPP:` prefix is
 * already stripped by keyListener) and REJECTS on timeout / process-not-running
 * / non-darwin. We map a rejection to the osascript fallback. Typed
 * structurally to avoid coupling to the rest of the KeyListener surface.
 */
type RequestFrontAppFn = () => Promise<string>
const requestFrontApp = (
  keyListener as unknown as { requestFrontApp: RequestFrontAppFn }
).requestFrontApp.bind(keyListener)

/**
 * Wrap a promise in a timeout that resolves `null` rather than rejecting, so a
 * slow/hung detection path can never stall the caller.
 */
function withNullTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, ms)
    p.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

/**
 * Parse the helper reply payload into `{id,name}`. The payload is
 * `<bundleId>|<localizedName>`; an incoming `FRONTAPP:` prefix is also tolerated
 * defensively. Lenient — returns null only when no id can be extracted.
 */
function parseFrontappReply(line: string | null): { id: string; name: string } | null {
  if (!line) return null
  const trimmed = line.trim()
  const body = trimmed.startsWith('FRONTAPP:') ? trimmed.slice('FRONTAPP:'.length) : trimmed
  if (!body) return null
  const pipe = body.indexOf('|')
  const id = (pipe >= 0 ? body.slice(0, pipe) : body).trim()
  const name = (pipe >= 0 ? body.slice(pipe + 1) : '').trim()
  if (!id) return null
  // Name may be absent when only the bundle id is available — fall back to id.
  return { id, name: name || id }
}

// ─── darwin ────────────────────────────────────────────────────────────────

/** PRIMARY darwin path — ask the running globe-listener helper over stdin. */
async function darwinViaHelper(): Promise<{ id: string; name: string } | null> {
  try {
    const reply = await requestFrontApp()
    const parsed = parseFrontappReply(reply)
    if (parsed) {
      console.log('[frontapp] helper:', parsed.id, '|', parsed.name)
      return parsed
    }
    return null
  } catch (err) {
    console.log(
      '[frontapp] helper unavailable, falling back to osascript:',
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/** FALLBACK darwin path — osascript System Events (bundle id only). */
async function darwinViaOsascript(): Promise<{ id: string; name: string } | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-e',
      'tell application "System Events" to get bundle identifier of first application process whose frontmost is true'
    ])
    const id = (stdout || '').trim()
    if (!id) return null
    console.log('[frontapp] osascript:', id)
    // System Events only yields the bundle id; use it as the name too.
    return { id, name: id }
  } catch (err) {
    console.log('[frontapp] osascript failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function detectDarwin(): Promise<{ id: string; name: string } | null> {
  const viaHelper = await darwinViaHelper()
  if (viaHelper) return viaHelper
  return darwinViaOsascript()
}

// ─── win32 ───────────────────────────────────────────────────────────────

/**
 * PowerShell P/Invoke: foreground window -> owning process -> name + window
 * title. Returns `<processName>|<windowTitle>`. `id` = processName, `name` =
 * windowTitle (falls back to processName when the title is empty).
 */
const WIN32_FRONTAPP_PS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MvFront {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$hwnd = [MvFront]::GetForegroundWindow()
$procId = 0
[void][MvFront]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$sb = New-Object System.Text.StringBuilder 512
[void][MvFront]::GetWindowText($hwnd, $sb, $sb.Capacity)
$title = $sb.ToString()
$proc = [System.Diagnostics.Process]::GetProcessById($procId)
$name = if ($proc) { $proc.ProcessName } else { '' }
Write-Output ("{0}|{1}" -f $name, $title)
`.trim()

async function detectWin32(): Promise<{ id: string; name: string } | null> {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WIN32_FRONTAPP_PS
    ])
    const line = (stdout || '').trim()
    if (!line) return null
    const pipe = line.indexOf('|')
    const processName = (pipe >= 0 ? line.slice(0, pipe) : line).trim()
    const windowTitle = (pipe >= 0 ? line.slice(pipe + 1) : '').trim()
    if (!processName) return null
    // Map to the convention used by appProfiles win32 process names ('foo.exe').
    const id = /\.exe$/i.test(processName) ? processName : `${processName}.exe`
    console.log('[frontapp] win32:', id, '|', windowTitle)
    return { id, name: windowTitle || processName }
  } catch (err) {
    console.log('[frontapp] win32 detection failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── public API ────────────────────────────────────────────────────────────

/**
 * Resolve the frontmost application as `{ id, name }`, or `null` when it cannot
 * be determined (unsupported platform, helper down + osascript failure, win32
 * P/Invoke failure) or after the internal ~800ms timeout. NEVER throws.
 */
export function getFrontmostApp(): Promise<{ id: string; name: string } | null> {
  let detector: Promise<{ id: string; name: string } | null>
  try {
    if (process.platform === 'darwin') {
      detector = detectDarwin()
    } else if (process.platform === 'win32') {
      detector = detectWin32()
    } else {
      return Promise.resolve(null)
    }
  } catch {
    // Synchronous throw from a detector kickoff — never propagate.
    return Promise.resolve(null)
  }
  return withNullTimeout(detector, DETECTION_TIMEOUT_MS).catch(() => null)
}
