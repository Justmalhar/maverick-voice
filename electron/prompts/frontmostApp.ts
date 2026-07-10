// ─── electron/prompts/frontmostApp.ts — detect the frontmost application ───
// Used at dictation-session start to choose an app-aware AUTO_FORMAT profile
// (appProfiles.detectProfile). This is the DETECTION seam only.
//
//  - darwin PRIMARY: the injected helper command function (keyListener's
//    `FRONTAPP` stdin command → `<bundleId>|<localizedName>` reply). Injected
//    to avoid a hard dependency on the keys module.
//  - darwin FALLBACK: osascript System Events (bundle id only).
//  - win32: PowerShell P/Invoke (GetForegroundWindow → process) →
//    `<proc>.exe|<title>` matching appProfiles' win32 entries.
//  - linux: xdotool getactivewindow on X11; null on Wayland ('default' profile).
//
// CONTRACT: getFrontmostApp() NEVER throws and resolves `null` on any failure
// or after an internal ~800ms cap. Callers kick it off without awaiting.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Hard cap on the whole detection — resolves `null` past this. */
const DETECTION_TIMEOUT_MS = 800

export interface FrontmostApp {
  id: string
  name: string
}

/**
 * The keys-module seam: issues a helper stdin command and resolves the raw
 * reply payload (rejects on timeout / helper down / non-darwin).
 */
export type HelperCommandFn = (cmd: string) => Promise<string>

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
 * `<bundleId>|<localizedName>`; a `FRONTAPP:` prefix is tolerated defensively.
 * Lenient — returns null only when no id can be extracted.
 */
function parseFrontappReply(line: string | null): FrontmostApp | null {
  if (!line) return null
  const trimmed = line.trim()
  const body = trimmed.startsWith('FRONTAPP:') ? trimmed.slice('FRONTAPP:'.length) : trimmed
  if (!body) return null
  const pipe = body.indexOf('|')
  const id = (pipe >= 0 ? body.slice(0, pipe) : body).trim()
  const name = (pipe >= 0 ? body.slice(pipe + 1) : '').trim()
  if (!id) return null
  return { id, name: name || id }
}

// ─── darwin ────────────────────────────────────────────────────────────────

async function darwinViaHelper(helperCommand: HelperCommandFn): Promise<FrontmostApp | null> {
  try {
    const reply = await helperCommand('FRONTAPP')
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
async function darwinViaOsascript(): Promise<FrontmostApp | null> {
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

async function detectDarwin(helperCommand?: HelperCommandFn): Promise<FrontmostApp | null> {
  if (helperCommand) {
    const viaHelper = await darwinViaHelper(helperCommand)
    if (viaHelper) return viaHelper
  }
  return darwinViaOsascript()
}

// ─── win32 ───────────────────────────────────────────────────────────────

/**
 * PowerShell P/Invoke: foreground window → owning process → name + window
 * title. Returns `<processName>|<windowTitle>`. `id` = processName normalized
 * to `<name>.exe` (matching appProfiles' win32 entries), `name` = windowTitle.
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

async function detectWin32(): Promise<FrontmostApp | null> {
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
    const id = /\.exe$/i.test(processName) ? processName : `${processName}.exe`
    console.log('[frontapp] win32:', id, '|', windowTitle)
    return { id, name: windowTitle || processName }
  } catch (err) {
    console.log('[frontapp] win32 detection failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── linux ─────────────────────────────────────────────────────────────────

/**
 * X11 only: `xdotool getactivewindow getwindowclassname` (→ id, matches
 * appProfiles' linux process names) + `getwindowname` (→ human title).
 * Wayland exposes no portable focused-window query → null ('default' profile).
 */
async function detectLinux(): Promise<FrontmostApp | null> {
  const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase()
  if (sessionType !== 'x11') {
    console.log('[frontapp] linux session is not x11 (', sessionType || 'unknown', ') — skipping')
    return null
  }
  try {
    const [{ stdout: cls }, { stdout: title }] = await Promise.all([
      execFileAsync('xdotool', ['getactivewindow', 'getwindowclassname']),
      execFileAsync('xdotool', ['getactivewindow', 'getwindowname'])
    ])
    const id = (cls || '').trim()
    if (!id) return null
    const name = (title || '').trim()
    console.log('[frontapp] linux:', id, '|', name)
    return { id: id.toLowerCase(), name: name || id }
  } catch (err) {
    console.log('[frontapp] linux detection failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── public API ────────────────────────────────────────────────────────────

/**
 * Resolve the frontmost application as `{ id, name }`, or `null` when it
 * cannot be determined or after the internal ~800ms cap. NEVER throws.
 *
 * @param helperCommand darwin-only optional seam: the keyListener command
 * function; tried first with 'FRONTAPP', osascript on failure.
 */
export function getFrontmostApp(helperCommand?: HelperCommandFn): Promise<FrontmostApp | null> {
  let detector: Promise<FrontmostApp | null>
  try {
    if (process.platform === 'darwin') {
      detector = detectDarwin(helperCommand)
    } else if (process.platform === 'win32') {
      detector = detectWin32()
    } else if (process.platform === 'linux') {
      detector = detectLinux()
    } else {
      return Promise.resolve(null)
    }
  } catch {
    // Synchronous throw from a detector kickoff — never propagate.
    return Promise.resolve(null)
  }
  return withNullTimeout(detector, DETECTION_TIMEOUT_MS).catch(() => null)
}
