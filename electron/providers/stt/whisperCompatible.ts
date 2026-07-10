// ════════════════════════════════════════════════════════════════════════
// electron/providers/stt/whisperCompatible.ts — the STT provider factory for
// OpenAI-compatible /audio/transcriptions endpoints (OpenAI, Groq, and any
// local server such as speaches / faster-whisper-server). Mirrors
// ../openaiCompatible.ts for LLMs: a concrete provider is one ~10-line
// factory call.
//
// Invariants (INTERFACES.md §providers): keys injected by callers, NEVER read
// from the key store here; missing key → NoApiKeyError (unless requiresKey is
// false); AbortError re-throws; usage recorded with the EXACT model string.
// ════════════════════════════════════════════════════════════════════════

import { FormData, fetch as undiciFetch } from 'undici'
import type { ProviderModel, STTProviderId } from '../../../shared/types'
import { TIMEOUTS } from '../../config'
import { recordSttUsage } from '../../store/usage'
import { httpError, keepAliveAgent, normalizeBaseUrl, testKeyViaModels, withTimeout } from '../http'
import {
  NoApiKeyError,
  type KeyTestResult,
  type TranscribeOptions,
  type TranscribeResult,
  type TranscriptionProvider
} from '../types'

export interface WhisperCompatibleConfig {
  id: STTProviderId
  label: string
  defaultBaseUrl: string
  defaultModel: string
  models: ProviderModel[]
  /** false => no key needed (Local server); a key is still sent when present. */
  requiresKey?: boolean
  /**
   * Whether a model supports response_format=verbose_json (billed-duration
   * reporting). Default: all do (Groq/local whisper). OpenAI's gpt-4o-*
   * transcribe models only accept json.
   */
  verboseJson?: (model: string) => boolean
}

export function createWhisperCompatibleProvider(cfg: WhisperCompatibleConfig): TranscriptionProvider {
  const resolveBase = (baseUrl?: string): string =>
    normalizeBaseUrl(baseUrl && baseUrl.trim() ? baseUrl : cfg.defaultBaseUrl)

  async function transcribe(
    audio: Buffer,
    opts: TranscribeOptions,
    key: string,
    signal?: AbortSignal
  ): Promise<TranscribeResult> {
    if (cfg.requiresKey !== false && !key) throw new NoApiKeyError(cfg.id)

    const url = `${resolveBase(opts.baseUrl)}/audio/transcriptions`
    const model = opts.model || cfg.defaultModel
    const mimeType = opts.mimeType || 'audio/webm'
    const wantVerbose = cfg.verboseJson?.(model) ?? true

    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'audio.webm')
    form.append('model', model)
    form.append('temperature', '0')
    form.append('response_format', wantVerbose ? 'verbose_json' : 'json')
    // Vocabulary-biasing prompt: the caller passes a dictionary-bounded hint
    // (the user's vocabulary + corrected spellings, capped to ~200 chars).
    // This is safe to forward — the silence/noise parroting risk applies to
    // ARBITRARY prompts, not to a short list of domain terms. NEVER append
    // any other prompt text here.
    if (opts.prompt) form.append('prompt', opts.prompt)
    if (opts.language && opts.language !== 'auto') form.append('language', opts.language)

    const t0 = Date.now()
    const { signal: timed, dispose } = withTimeout(signal, TIMEOUTS.request)
    try {
      const res = await undiciFetch(url, {
        method: 'POST',
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        body: form,
        signal: timed,
        dispatcher: keepAliveAgent
      })
      const body = await res.text()
      if (!res.ok) throw httpError(`${cfg.label} transcription`, res.status, body)
      const result = JSON.parse(body) as { text?: string; duration?: number }
      // verbose_json reports the billed audio duration (seconds) — feed the
      // local usage estimate with the EXACT model string sent. Best-effort;
      // never blocks the transcript.
      if (typeof result.duration === 'number') recordSttUsage(model, result.duration)
      const text = result.text || ''
      // Length only — transcript text never hits the logs.
      console.log(`[${cfg.id}:stt] ${Date.now() - t0}ms | ${text.length} chars`)
      return { text, durationSeconds: typeof result.duration === 'number' ? result.duration : undefined }
    } catch (err) {
      // A caller-initiated cancel (session Escape) must re-throw, not be swallowed.
      if ((err as Error)?.name === 'AbortError') throw err
      throw err
    } finally {
      dispose()
    }
  }

  /** Validate a candidate API key with a lightweight GET /models call. */
  function testKey(key: string): Promise<KeyTestResult> {
    return testKeyViaModels(`${resolveBase()}/models`, key)
  }

  return {
    id: cfg.id,
    label: cfg.label,
    requiresKey: cfg.requiresKey ?? true,
    defaultModel: cfg.defaultModel,
    models: cfg.models,
    transcribe,
    testKey
  }
}
