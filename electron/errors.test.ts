import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWindows: { webContents: { send: ReturnType<typeof vi.fn> } }[] = []

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => mockWindows)
  }
}))

import { simplifyError, reportError } from './errors'
import { BrowserWindow } from 'electron'

describe('simplifyError', () => {
  it('matches the auth/token/401 family first', () => {
    expect(simplifyError('401 Unauthorized: invalid token')).toBe(
      'Your API key looks wrong — check it in Settings.'
    )
    expect(simplifyError('not authenticated')).toBe('Your API key looks wrong — check it in Settings.')
  })

  it('matches rate-limit phrasing', () => {
    expect(simplifyError('429 daily limit reached')).toBe('Usage limit reached — check your provider dashboard.')
  })

  it('matches transcription/whisper failures', () => {
    expect(simplifyError('Transcription failed: no audio')).toBe(
      "Couldn't transcribe audio — try speaking again."
    )
    expect(simplifyError('whisper crashed')).toBe("Couldn't transcribe audio — try speaking again.")
  })

  it('matches network-shaped errors', () => {
    expect(simplifyError('ECONNREFUSED')).toBe('No internet connection — check your network.')
    expect(simplifyError('request timeout')).toBe('No internet connection — check your network.')
    expect(simplifyError('ENOTFOUND')).toBe('No internet connection — check your network.')
    expect(simplifyError('socket hang up')).toBe('No internet connection — check your network.')
    expect(simplifyError('fetch failed')).toBe('No internet connection — check your network.')
  })

  it('matches 5xx / service-down errors', () => {
    expect(simplifyError('502 Bad Gateway')).toBe('Service temporarily unavailable — try again soon.')
    expect(simplifyError('Internal Server Error')).toBe('Service temporarily unavailable — try again soon.')
    expect(simplifyError('service unavailable')).toBe('Service temporarily unavailable — try again soon.')
  })

  it('matches missing-key phrasing', () => {
    expect(simplifyError('no api key configured')).toBe('Add your API key in Settings to get started.')
    expect(simplifyError('url not configured')).toBe('Add your API key in Settings to get started.')
  })

  it('matches microphone/permission errors', () => {
    expect(simplifyError('NotAllowedError: mic denied')).toBe(
      'Microphone access denied — check System Settings.'
    )
    expect(simplifyError('permission denied')).toBe('Microphone access denied — check System Settings.')
  })

  it('falls back to the generic message for anything unmatched', () => {
    expect(simplifyError('totally unrecognized failure')).toBe('Something went wrong — please try again.')
  })

  it('resolves the first matching category when multiple keywords are present (order load-bearing)', () => {
    // Contains both "auth" (would match INVALID_API_KEY) and "500" (SERVICE_DOWN) — auth wins, it's checked first.
    expect(simplifyError('auth error, 500 upstream')).toBe('Your API key looks wrong — check it in Settings.')
  })
})

describe('reportError', () => {
  beforeEach(() => {
    mockWindows.length = 0
    vi.clearAllMocks()
  })

  it('broadcasts a diagnostic entry to every window', () => {
    const send = vi.fn()
    mockWindows.push({ webContents: { send } })
    reportError('session', 'boom')
    expect(send).toHaveBeenCalledWith('dev:error-log', expect.objectContaining({ source: 'session', message: 'boom' }))
  })

  it('trims the ring buffer beyond 50 entries', () => {
    for (let i = 0; i < 55; i++) reportError('src', `msg-${i}`)
    // No window registered this call — just verifying it never throws while pruning.
    expect(BrowserWindow.getAllWindows).toHaveBeenCalled()
  })
})
