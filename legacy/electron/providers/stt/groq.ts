// ─── Groq STT provider (TranscriptionProvider) ───
// Maverick Voice calls Groq directly from the main process using the user's own
// key (injected by the caller — providers NEVER read keyStore). No proxy, no
// server. A keep-alive undici Agent reuses TCP+TLS connections to shave the
// handshake latency off back-to-back requests.
//
// Ported from unmute-dictation/electron/groq.ts → groqTranscribe, adapted into
// the provider-agnostic TranscriptionProvider shape from providers/types.ts.

import { Agent as UndiciAgent, fetch as undiciFetch, FormData as UndiciFormData } from 'undici'
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

const STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODELS_URL = 'https://api.groq.com/openai/v1/models'

const agent = new UndiciAgent({
  keepAliveTimeout: 120_000,
  keepAliveMaxTimeout: 120_000,
  connections: 4,
  pipelining: 1,
})

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

/** Transcribe one audio buffer via Groq Whisper. */
async function transcribe(
  audio: Buffer,
  opts: TranscribeOptions,
  key: string,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  if (!key) throw new NoApiKeyError('groq')

  const model = opts.model || groqProvider.defaultModel
  const mimeType = opts.mimeType || 'audio/webm'

  const form = new UndiciFormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'audio.webm')
  form.append('model', model)
  form.append('temperature', '0')
  form.append('response_format', 'verbose_json')
  // Vocabulary-biasing prompt: the caller passes a dictionary-bounded hint
  // (the user's corrected `to` spellings, capped to ~200 chars). This is safe
  // to forward — the silence/noise parroting risk applies to ARBITRARY prompts
  // (e.g. "What is the spoken audio?"), not to a short list of domain terms.
  // Whisper biases toward these spellings without parroting on silence.
  if (opts.prompt) form.append('prompt', opts.prompt)
  if (opts.language && opts.language !== 'auto') form.append('language', opts.language)

  const t0 = Date.now()
  const { signal: timed, clear } = withTimeout(signal)
  try {
    const res = await undiciFetch(STT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: timed,
      dispatcher: agent,
    } as any)
    const body = await res.text()
    if (!res.ok) {
      throw new Error(`Groq transcription failed (${res.status}): ${body.substring(0, 200)}`)
    }
    const result = JSON.parse(body) as { text?: string; duration?: number }
    // `verbose_json` reports the billed audio duration (seconds) — feed the
    // local usage estimate. Best-effort; never blocks the transcript.
    if (typeof result.duration === 'number') recordSttUsage(model, result.duration)
    const text = result.text || ''
    console.log(`[groq:stt] ${Date.now() - t0}ms | ${text.length} chars`)
    return { text, durationSeconds: typeof result.duration === 'number' ? result.duration : undefined }
  } catch (err) {
    // A caller-initiated cancel must propagate, not be masked.
    if ((err as Error)?.name === 'AbortError') throw err
    throw err
  } finally {
    clear()
  }
}

/** Validate a candidate API key with a lightweight GET /models call. */
async function testKey(key: string): Promise<KeyTestResult> {
  const trimmed = (key || '').trim()
  if (!trimmed) return { ok: false, error: KEY_TEST.EMPTY }
  try {
    const res = await undiciFetch(MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${trimmed}` },
      dispatcher: agent,
    } as any)
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, error: KEY_TEST.INVALID }
    return { ok: false, error: KEY_TEST.SERVICE_ERROR }
  } catch (err) {
    return { ok: false, error: KEY_TEST.NETWORK_ERROR }
  }
}

export const groqProvider: TranscriptionProvider = {
  id: 'groq',
  label: 'Groq',
  defaultModel: 'whisper-large-v3-turbo',
  models: [
    { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo' },
    { id: 'whisper-large-v3', label: 'Whisper Large v3' },
  ],
  transcribe,
  testKey,
}
