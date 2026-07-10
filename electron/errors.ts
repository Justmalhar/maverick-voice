// ─── electron/errors.ts — user-facing error simplification + dev error log ───
// simplifyError ports legacy/electron/errorUtils.ts's keyword map VERBATIM,
// order preserved (first-match-wins — do NOT reorder). BYO-key copy: this app
// has no auth/sign-in, so auth-shaped errors point at the API key and
// "not configured" points at adding one in Settings. Copy ported from
// legacy/shared/copy.ts ERRORS (v2 has no shared/copy.ts yet, inlined here).
//
// reportError keeps a ring buffer of the last 50 entries and broadcasts each
// one to every window via DEV_ERROR_LOG — NEVER transcript/output text, only
// short diagnostic messages (session ids / stage names).

import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { ErrorEntry } from '../shared/types'

const ERRORS = {
  INVALID_API_KEY: 'Your API key looks wrong — check it in Settings.',
  RATE_LIMIT: 'Usage limit reached — check your provider dashboard.',
  AUDIO_FAILED: "Couldn't transcribe audio — try speaking again.",
  NO_INTERNET: 'No internet connection — check your network.',
  SERVICE_DOWN: 'Service temporarily unavailable — try again soon.',
  NO_API_KEY: 'Add your API key in Settings to get started.',
  MIC_DENIED: 'Microphone access denied — check System Settings.',
  GENERIC: 'Something went wrong — please try again.'
} as const

/** First-match-wins keyword map — order is load-bearing, do not reorder. */
export function simplifyError(raw: string): string {
  const lower = raw.toLowerCase()

  if (
    lower.includes('not authenticated') ||
    lower.includes('auth') ||
    lower.includes('token') ||
    lower.includes('unauthorized') ||
    lower.includes('401')
  ) {
    return ERRORS.INVALID_API_KEY
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('limit reached') ||
    lower.includes('usage limit') ||
    lower.includes('daily limit')
  ) {
    return ERRORS.RATE_LIMIT
  }

  if (lower.includes('transcription failed') || lower.includes('whisper') || lower.includes('no audio')) {
    return ERRORS.AUDIO_FAILED
  }

  if (
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout') ||
    lower.includes('enotfound') ||
    lower.includes('socket')
  ) {
    return ERRORS.NO_INTERNET
  }

  if (
    lower.includes('api error') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('internal server error') ||
    lower.includes('service unavailable')
  ) {
    return ERRORS.SERVICE_DOWN
  }

  if (lower.includes('not configured') || lower.includes('url not configured') || lower.includes('no api key')) {
    return ERRORS.NO_API_KEY
  }

  if (
    lower.includes('mic') ||
    lower.includes('microphone') ||
    lower.includes('notallowederror') ||
    lower.includes('permission')
  ) {
    return ERRORS.MIC_DENIED
  }

  return ERRORS.GENERIC
}

const RING_SIZE = 50
const ring: ErrorEntry[] = []

/** Record + broadcast a dev-facing diagnostic to every window. Never pass
 *  transcript/output text — `message` is a short diagnostic string only. */
export function reportError(source: string, message: string): void {
  const entry: ErrorEntry = { source, message, timestamp: new Date().toISOString() }
  ring.push(entry)
  if (ring.length > RING_SIZE) ring.shift()
  console.error(`[${source}] ${message}`)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.DEV_ERROR_LOG, entry)
  }
}
