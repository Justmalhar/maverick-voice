// ─── Deepgram STT provider (TranscriptionProvider) ───
// Maverick Voice calls Deepgram directly from the main process using the user's
// own key (injected by the caller — providers NEVER read keyStore). A keep-alive
// undici Agent reuses TCP+TLS connections to shave handshake latency off
// back-to-back requests.
//
// Endpoint: POST https://api.deepgram.com/v1/listen
// Auth: Authorization: Token <key>
//
// Dictionary vocabulary hint: sessionManager passes a bounded comma-separated
// prompt via opts.prompt (distinct Dictionary `to` values, ~200 chars). Nova-3
// accepts `keyterm` query params; Nova-2 uses `keywords`. Groq's Whisper
// `prompt` param is NOT forwarded — Deepgram uses separate boosting APIs.

import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici'
import { REQUEST_TIMEOUT_MS } from '../../config'
import { recordSttUsage } from '../../usageTracker'
import {
  NoApiKeyError,
  type TranscriptionProvider,
  type TranscribeOptions,
  type TranscribeResult,
  type KeyTestResult,
} from '../types'
import { KEY_TEST } from '../../../shared/copy'

const STT_URL = 'https://api.deepgram.com/v1/listen'
const AUTH_TEST_URL = 'https://api.deepgram.com/v1/auth/token'

const agent = new UndiciAgent({
  keepAliveTimeout: 120_000,
  keepAliveMaxTimeout: 120_000,
  connections: 4,
  pipelining: 1,
})

interface DeepgramListenResponse {
  metadata?: { duration?: number }
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string }>
    }>
  }
}

/** Combine an optional caller signal with an internal timeout. */
function withTimeout(signal?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/** Split the dictionary-bounded hint into individual boost terms. */
function parseDictionaryHint(prompt: string): string[] {
  return prompt
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
}

/** Build listen URL query params for model, language, and vocabulary boosting. */
function buildListenUrl(opts: TranscribeOptions): string {
  const model = opts.model || deepgramProvider.defaultModel
  const params = new URLSearchParams()
  params.set('model', model)
  params.set('punctuate', 'true')
  params.set('smart_format', 'true')
  if (opts.language && opts.language !== 'auto') params.set('language', opts.language)

  if (opts.prompt) {
    const terms = parseDictionaryHint(opts.prompt)
    if (model.startsWith('nova-3')) {
      for (const term of terms) params.append('keyterm', term)
    } else {
      for (const term of terms) params.append('keywords', term)
    }
  }

  return `${STT_URL}?${params.toString()}`
}

/** Transcribe one audio buffer via Deepgram pre-recorded listen. */
async function transcribe(
  audio: Buffer,
  opts: TranscribeOptions,
  key: string,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  if (!key) throw new NoApiKeyError('deepgram')

  const model = opts.model || deepgramProvider.defaultModel
  const mimeType = opts.mimeType || 'audio/webm'
  const url = buildListenUrl(opts)

  const t0 = Date.now()
  const { signal: timed, clear } = withTimeout(signal)
  try {
    const res = await undiciFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': mimeType,
      },
      body: new Uint8Array(audio),
      signal: timed,
      dispatcher: agent,
    } as any)
    const body = await res.text()
    if (!res.ok) {
      throw new Error(`Deepgram transcription failed (${res.status}): ${body.substring(0, 200)}`)
    }
    const result = JSON.parse(body) as DeepgramListenResponse
    const duration = result.metadata?.duration
    if (typeof duration === 'number') recordSttUsage(model, duration)
    const text =
      result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
    console.log(`[deepgram:stt] ${Date.now() - t0}ms | ${text.length} chars`)
    return { text, durationSeconds: typeof duration === 'number' ? duration : undefined }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw err
  } finally {
    clear()
  }
}

/** Validate a candidate API key with GET /v1/auth/token. */
async function testKey(key: string): Promise<KeyTestResult> {
  const trimmed = (key || '').trim()
  if (!trimmed) return { ok: false, error: KEY_TEST.EMPTY }
  try {
    const res = await undiciFetch(AUTH_TEST_URL, {
      method: 'GET',
      headers: { Authorization: `Token ${trimmed}` },
      dispatcher: agent,
    } as any)
    if (res.ok) return { ok: true }
    if (res.status === 401 || res.status === 403) return { ok: false, error: KEY_TEST.INVALID }
    return { ok: false, error: KEY_TEST.SERVICE_ERROR }
  } catch {
    return { ok: false, error: KEY_TEST.NETWORK_ERROR }
  }
}

export const deepgramProvider: TranscriptionProvider = {
  id: 'deepgram',
  label: 'Deepgram',
  defaultModel: 'nova-3',
  models: [
    { id: 'nova-3', label: 'Nova-3' },
    { id: 'nova-2', label: 'Nova-2' },
  ],
  transcribe,
  testKey,
}
