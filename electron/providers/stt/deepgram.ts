// ─── Deepgram STT provider (TranscriptionProvider) ───
// Not OpenAI-compatible: raw audio body to /v1/listen with `Token` auth.
// Keys injected by the caller — providers NEVER read the key store.
// ponytail: opts.prompt (vocabulary hint) is not forwarded — Deepgram's
// equivalent is per-term `keyterm` params, nova-3 only; add when needed.

import { fetch as undiciFetch } from 'undici'
import { TIMEOUTS } from '../../config'
import { recordSttUsage } from '../../store/usage'
import { httpError, keepAliveAgent, withTimeout } from '../http'
import {
  NoApiKeyError,
  type KeyTestResult,
  type TranscribeOptions,
  type TranscribeResult,
  type TranscriptionProvider
} from '../types'

const LISTEN_URL = 'https://api.deepgram.com/v1/listen'
const AUTH_URL = 'https://api.deepgram.com/v1/auth/token'

async function transcribe(
  audio: Buffer,
  opts: TranscribeOptions,
  key: string,
  signal?: AbortSignal
): Promise<TranscribeResult> {
  if (!key) throw new NoApiKeyError('deepgram')

  const model = opts.model || deepgramProvider.defaultModel
  const params = new URLSearchParams({ model, smart_format: 'true' })
  if (opts.language && opts.language !== 'auto') params.set('language', opts.language)

  const t0 = Date.now()
  const { signal: timed, dispose } = withTimeout(signal, TIMEOUTS.request)
  try {
    const res = await undiciFetch(`${LISTEN_URL}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': opts.mimeType || 'audio/webm'
      },
      body: new Uint8Array(audio),
      signal: timed,
      dispatcher: keepAliveAgent
    })
    const body = await res.text()
    if (!res.ok) throw httpError('Deepgram transcription', res.status, body)
    const result = JSON.parse(body) as {
      metadata?: { duration?: number }
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
    }
    const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
    const duration = result.metadata?.duration
    if (typeof duration === 'number') recordSttUsage(model, duration)
    // Length only — transcript text never hits the logs.
    console.log(`[deepgram:stt] ${Date.now() - t0}ms | ${text.length} chars`)
    return { text, durationSeconds: typeof duration === 'number' ? duration : undefined }
  } catch (err) {
    // A caller-initiated cancel (session Escape) must re-throw, not be swallowed.
    if ((err as Error)?.name === 'AbortError') throw err
    throw err
  } finally {
    dispose()
  }
}

/** Validate a key against Deepgram's token-introspection endpoint. */
async function testKey(key: string): Promise<KeyTestResult> {
  const trimmed = (key || '').trim()
  if (!trimmed) return { ok: false, error: 'API key is empty' }
  try {
    const res = await undiciFetch(AUTH_URL, {
      headers: { Authorization: `Token ${trimmed}` },
      dispatcher: keepAliveAgent
    })
    if (res.ok) return { ok: true }
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Key test failed (${res.status}): ${body.substring(0, 200)}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export const deepgramProvider: TranscriptionProvider = {
  id: 'deepgram',
  label: 'Deepgram',
  requiresKey: true,
  defaultModel: 'nova-3',
  models: [
    { id: 'nova-3', label: 'Nova 3' },
    { id: 'nova-2', label: 'Nova 2' }
  ],
  transcribe,
  testKey
}
