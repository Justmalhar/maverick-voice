// ─── Proxy STT provider ───
// Routes transcription through maverick-voice-proxy instead of calling
// Groq/Deepgram directly. The proxy holds all API keys server-side; the
// Electron app only needs a valid session JWT (managed by electron/auth.ts).
//
// On 401 the provider attempts one token refresh then retries. If the user
// is not logged in, transcription fails with an instructive error.

import { getAccessToken, refreshAccessToken } from '../../auth'
import {
  type TranscriptionProvider,
  type TranscribeOptions,
  type TranscribeResult,
  type KeyTestResult,
} from '../types'

const PROXY_BASE_URL = process.env.PROXY_BASE_URL ?? 'https://proxy.getmaverick.sh'

/** POST raw audio to the proxy STT endpoint. */
async function transcribeWithToken(
  audio: Buffer,
  opts: TranscribeOptions,
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  const mimeType = opts.mimeType ?? 'audio/webm'
  return fetch(`${PROXY_BASE_URL}/api/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
      'x-model': 'stt-standard',
      ...(opts.language && opts.language !== 'auto' ? { 'x-language': opts.language } : {}),
    },
    body: audio,
    signal,
  })
}

async function transcribe(
  audio: Buffer,
  opts: TranscribeOptions,
  _key: string,           // ignored — token comes from auth.ts
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  let token = await getAccessToken()
  if (!token) throw new Error('Not signed in. Open Settings → Account and sign in with Google.')

  let res = await transcribeWithToken(audio, opts, token, signal)

  // One retry after token refresh on 401.
  if (res.status === 401) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) throw new Error('Session expired. Please sign in again.')
    token = refreshed
    res = await transcribeWithToken(audio, opts, token, signal)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Proxy STT failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const data = await res.json() as { text?: string }
  return { text: (data.text ?? '').trim() }
}

async function testKey(_key: string): Promise<KeyTestResult> {
  const token = await getAccessToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch(`${PROXY_BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok ? { ok: true } : { ok: false, error: 'Session invalid or expired' }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export const proxySTTProvider: TranscriptionProvider = {
  id: 'proxy',
  label: 'Maverick (managed)',
  defaultModel: 'stt-standard',
  models: [{ id: 'stt-standard', label: 'Standard (Groq Whisper)' }],
  transcribe,
  testKey,
}
