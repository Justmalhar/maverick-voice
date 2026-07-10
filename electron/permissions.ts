// ════════════════════════════════════════════════════════════════════════
// permissions.ts — PLATFORM SEAM for TCC/permission preflight.
//
// v1 had no health check anywhere: a helper without Input Monitoring spawned
// fine and received nothing (M6), paste needed a second unchecked Automation
// grant (M7), and settings deep links were pre-Ventura (M8). Here the report
// is driven by the helper's HEALTH command and Ventura+ pane URLs.
// ════════════════════════════════════════════════════════════════════════

import { app, safeStorage, shell, systemPreferences } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PermissionPane, PermissionsReport } from '../shared/types'
import { keyListener } from './keys/listener'

const run = promisify(execFile)

// Ventura+ (macOS 13) System Settings extension anchors. Pre-Ventura
// com.apple.preference.security links are exactly what M8 bans.
const PANE_URLS: Record<PermissionPane, string> = {
  mic: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone',
  accessibility: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
  'input-monitoring': 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent',
  automation: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation',
  keyboard: 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension'
}

export async function preflight(): Promise<PermissionsReport> {
  if (process.platform === 'darwin') return preflightDarwin()
  if (process.platform === 'linux') return preflightLinux()
  // win32: no TCC equivalent — everything is grantable-by-default.
  return {
    mic: 'granted',
    accessibility: true,
    inputMonitoring: true,
    automation: 'granted',
    listenerAlive: keyListener.isRunning()
  }
}

async function preflightDarwin(): Promise<PermissionsReport> {
  const micStatus = systemPreferences.getMediaAccessStatus('microphone')
  const mic: PermissionsReport['mic'] =
    micStatus === 'granted' ? 'granted' : micStatus === 'not-determined' ? 'not-determined' : 'denied'

  const accessibility = systemPreferences.isTrustedAccessibilityClient(false)

  // The helper is the authority: HEALTH:OK means it holds Input Monitoring +
  // Accessibility AND is alive to say so. A spawned-but-deaf helper (or a dead
  // one) reports false — v1 M6's silent hotkey death becomes a visible banner.
  let inputMonitoring = false
  let listenerAlive = false
  try {
    const reply = await keyListener.command('HEALTH')
    if (reply === 'HEALTH:OK') {
      inputMonitoring = true
      listenerAlive = true
    }
  } catch (err) {
    console.log('[permissions] HEALTH check failed:', err instanceof Error ? err.message : err)
  }

  // Automation (Apple Events → System Events): there is no query API that
  // doesn't itself SEND an Apple Event and thereby trigger/consume the TCC
  // prompt. Report 'unknown'; the openSettingsPane('automation') deep link is
  // the remediation path (v1 M7).
  return { mic, accessibility, inputMonitoring, automation: 'unknown', listenerAlive }
}

async function preflightLinux(): Promise<PermissionsReport> {
  const st = process.env.XDG_SESSION_TYPE
  const sessionType: 'x11' | 'wayland' | 'unknown' = st === 'x11' || st === 'wayland' ? st : 'unknown'

  let xdotool = false
  try {
    await run('which', ['xdotool'])
    xdotool = true
  } catch {
    xdotool = false
  }

  let secretService = false
  try {
    secretService = safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    secretService = false
  }

  return {
    mic: 'granted',
    accessibility: true,
    inputMonitoring: true,
    automation: 'unknown',
    // Wayland compositors can block uiohook — a failed start shows up here.
    listenerAlive: keyListener.isRunning(),
    linux: { sessionType, xdotool, secretService }
  }
}

/** darwin: OS mic prompt (askForMediaAccess). Elsewhere: already granted. */
export async function requestMicPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  try {
    return await systemPreferences.askForMediaAccess('microphone')
  } catch (err) {
    console.log('[permissions] askForMediaAccess failed:', err instanceof Error ? err.message : err)
    return false
  }
}

export function openSettingsPane(pane: PermissionPane): void {
  if (process.platform !== 'darwin') return // no-op: win32/linux have no pane deep links
  console.log('[permissions] Opening settings pane:', pane)
  shell.openExternal(PANE_URLS[pane]).catch((err) => {
    console.log('[permissions] Failed to open pane:', err instanceof Error ? err.message : err)
  })
}

// ── Change notification: re-check when the user comes back from System
//    Settings (any of our windows regaining focus). ─────────────────────────

const subscribers = new Set<(r: PermissionsReport) => void>()
let focusHandlerAttached = false
let checking = false

function onWindowFocus(): void {
  if (subscribers.size === 0 || checking) return
  checking = true
  preflight()
    .then((report) => {
      for (const cb of subscribers) {
        try {
          cb(report)
        } catch (err) {
          console.log('[permissions] onChange subscriber threw:', err instanceof Error ? err.message : err)
        }
      }
    })
    .catch((err) => {
      console.log('[permissions] focus preflight failed:', err instanceof Error ? err.message : err)
    })
    .finally(() => {
      checking = false
    })
}

export function onChange(cb: (r: PermissionsReport) => void): () => void {
  subscribers.add(cb)
  if (!focusHandlerAttached) {
    focusHandlerAttached = true
    app.on('browser-window-focus', onWindowFocus)
  }
  return () => {
    subscribers.delete(cb)
  }
}
