// ════════════════════════════════════════════════════════════════════════
// electron/output/media.ts — pause playing media during dictation, resume
// afterwards (PRD F31).
//
// Module-level state remembers EXACTLY what WE paused; resume touches only
// that set, and re-checks each player is still paused first (the user may
// have manually resumed or quit it in between).
//
// Contract: never throws (everything caught + logged), fire-and-forget from
// the session fsm, no external call outlives MEDIA_TIMEOUT_MS (execFile's
// `timeout` option kills the child).
// ════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TIMEOUTS } from '../config'

const execFileAsync = promisify(execFile)

const MEDIA_TIMEOUT_MS = TIMEOUTS.media

/** Player identifiers we paused: app names (darwin), playerctl names (linux),
 *  AppUserModelIds (win32). Only ever one platform's ids at runtime. */
let pausedByUs: string[] = []

/** Session fsm calls this on hard errors to drop any stale resume set. */
export function resetMediaState(): void {
  pausedByUs = []
}

// ── darwin ────────────────────────────────────────────────────────────────

// Scriptable players we know how to query. Interpolated fragments below come
// ONLY from this constant list (never user input) into execFile args — no shell.
const DARWIN_PLAYERS = ['Music', 'Spotify'] as const

async function osa(script: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: MEDIA_TIMEOUT_MS
  })
  return stdout.trim()
}

/** `tell application "Spotify"` LAUNCHES Spotify if it isn't running — always
 *  gate on this System Events process check first. */
async function darwinAppRunning(app: string): Promise<boolean> {
  return (await osa(`tell application "System Events" to (name of processes) contains "${app}"`)) === 'true'
}

async function pauseDarwin(): Promise<void> {
  for (const app of DARWIN_PLAYERS) {
    try {
      if (!(await darwinAppRunning(app))) continue
      if ((await osa(`tell application "${app}" to player state as string`)) !== 'playing') continue
      await osa(`tell application "${app}" to pause`)
      pausedByUs.push(app)
      console.log('[media] paused', app)
    } catch (err) {
      console.warn(`[media] pause check failed for ${app}:`, err instanceof Error ? err.message : err)
    }
  }
}

async function resumeDarwin(apps: string[]): Promise<void> {
  for (const app of apps) {
    try {
      if (!(await darwinAppRunning(app))) continue // user quit it — don't relaunch
      // Re-check: only resume if still paused (user may have resumed manually).
      if ((await osa(`tell application "${app}" to player state as string`)) !== 'paused') continue
      await osa(`tell application "${app}" to play`)
      console.log('[media] resumed', app)
    } catch (err) {
      console.warn(`[media] resume failed for ${app}:`, err instanceof Error ? err.message : err)
    }
  }
}

// ── linux (playerctl / MPRIS) ─────────────────────────────────────────────

async function playerctl(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('playerctl', args, { timeout: MEDIA_TIMEOUT_MS })
  return stdout.trim()
}

async function pauseLinux(): Promise<void> {
  let players: string[]
  try {
    players = (await playerctl(['--list-all'])).split('\n').filter(Boolean)
  } catch {
    return // no playerctl (ENOENT) or no players → no-op
  }
  for (const name of players) {
    try {
      if ((await playerctl(['-p', name, 'status'])) !== 'Playing') continue
      await playerctl(['-p', name, 'pause'])
      pausedByUs.push(name)
      console.log('[media] paused', name)
    } catch (err) {
      console.warn(`[media] pause failed for ${name}:`, err instanceof Error ? err.message : err)
    }
  }
}

async function resumeLinux(players: string[]): Promise<void> {
  for (const name of players) {
    try {
      // Re-check: only resume if still paused by us and untouched since.
      if ((await playerctl(['-p', name, 'status'])) !== 'Paused') continue
      await playerctl(['-p', name, 'play'])
      console.log('[media] resumed', name)
    } catch (err) {
      console.warn(`[media] resume failed for ${name}:`, err instanceof Error ? err.message : err)
    }
  }
}

// ── win32 (WinRT GlobalSystemMediaTransportControlsSessionManager) ────────

// Shared preamble: load the WinRT projection + an Await helper for
// IAsyncOperation<T>. Best-effort: any error anywhere → empty output → no-op.
const PS_PREAMBLE = `
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(); $t.Result }
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
`

// Pauses every Playing session; prints the AppUserModelId of each one paused.
const PS_PAUSE = `${PS_PREAMBLE}
foreach ($s in $mgr.GetSessions()) {
  if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') {
    $null = Await ($s.TryPauseAsync()) ([bool])
    Write-Output $s.SourceAppUserModelId
  }
}
`

// Resumes sessions whose AppUserModelId is in $env:MV_RESUME_IDS (newline-
// separated — env var, NOT string interpolation) and which are still Paused.
const PS_RESUME = `${PS_PREAMBLE}
$targets = $env:MV_RESUME_IDS -split "\`n"
foreach ($s in $mgr.GetSessions()) {
  if ($targets -contains $s.SourceAppUserModelId -and $s.GetPlaybackInfo().PlaybackStatus -eq 'Paused') {
    $null = Await ($s.TryPlayAsync()) ([bool])
  }
}
`

let winErrorLogged = false

async function runPs(script: string, env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
    timeout: MEDIA_TIMEOUT_MS,
    env: env ? { ...process.env, ...env } : process.env
  })
  return stdout.trim()
}

async function pauseWin(): Promise<void> {
  try {
    const out = await runPs(PS_PAUSE)
    pausedByUs = out.split(/\r?\n/).filter(Boolean)
    if (pausedByUs.length > 0) console.log('[media] paused', pausedByUs.length, 'session(s)')
  } catch (err) {
    if (!winErrorLogged) {
      winErrorLogged = true
      console.warn('[media] WinRT media control unavailable (no-op):', err instanceof Error ? err.message : err)
    }
  }
}

async function resumeWin(ids: string[]): Promise<void> {
  try {
    await runPs(PS_RESUME, { MV_RESUME_IDS: ids.join('\n') })
    console.log('[media] resume attempted for', ids.length, 'session(s)')
  } catch (err) {
    if (!winErrorLogged) {
      winErrorLogged = true
      console.warn('[media] WinRT media control unavailable (no-op):', err instanceof Error ? err.message : err)
    }
  }
}

// ── public API ────────────────────────────────────────────────────────────

/** Pause whatever is currently playing and remember exactly that set. */
export async function pausePlayingMedia(): Promise<void> {
  try {
    pausedByUs = []
    if (process.platform === 'darwin') await pauseDarwin()
    else if (process.platform === 'linux') await pauseLinux()
    else if (process.platform === 'win32') await pauseWin()
  } catch (err) {
    console.warn('[media] pause failed:', err instanceof Error ? err.message : err)
  }
}

/** Resume ONLY the set we paused (each re-checked as still paused); clears state. */
export async function resumePausedMedia(): Promise<void> {
  const toResume = pausedByUs
  pausedByUs = []
  if (toResume.length === 0) return
  try {
    if (process.platform === 'darwin') await resumeDarwin(toResume)
    else if (process.platform === 'linux') await resumeLinux(toResume)
    else if (process.platform === 'win32') await resumeWin(toResume)
  } catch (err) {
    console.warn('[media] resume failed:', err instanceof Error ? err.message : err)
  }
}
