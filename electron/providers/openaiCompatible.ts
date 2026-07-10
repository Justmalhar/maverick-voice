// ════════════════════════════════════════════════════════════════════════
// electron/providers/openaiCompatible.ts — the LLM provider factory.
// The request body is the CANONICAL OpenAI-compatible shape (system+user
// messages, temperature, max_tokens → choices[0].message.content), so any
// baseUrl that speaks the protocol plugs in. A concrete provider is one
// ~10-line factory call (see llm/openai.ts, llm/openrouter.ts) — this file
// replaces v1's ~450 duplicated lines (LEGACY-ISSUES A2).
//
// Invariants (INTERFACES.md §providers): keys injected by callers, NEVER read
// from the key store here; empty key → NoApiKeyError; AbortError re-throws;
// usage recorded with the EXACT model string sent.
// ════════════════════════════════════════════════════════════════════════

import { fetch as undiciFetch } from 'undici'
import type { LLMProviderId, ProviderModel } from '../../shared/types'
import { TIMEOUTS } from '../config'
import { recordLlmUsage } from '../store/usage'
import { httpError, keepAliveAgent, normalizeBaseUrl, testKeyViaModels, withTimeout } from './http'
import {
  NoApiKeyError,
  type CompleteOptions,
  type CompleteResult,
  type KeyTestResult,
  type LLMProvider
} from './types'

export interface OpenAICompatibleConfig {
  id: LLMProviderId
  label: string
  defaultBaseUrl: string
  defaultModel: string
  models: ProviderModel[]
  /** Provider-convention headers (e.g. OpenRouter attribution). */
  extraHeaders?: Record<string, string>
}

export function createOpenAICompatibleProvider(cfg: OpenAICompatibleConfig): LLMProvider {
  /** Empty/blank override → provider default (the provider-agnostic seam). */
  const resolveBase = (baseUrl?: string): string => {
    const raw = baseUrl && baseUrl.trim() ? baseUrl : cfg.defaultBaseUrl
    // The Custom provider has no default — a clear error beats a request to "https://".
    if (!raw.trim()) throw new Error(`${cfg.label}: enter a base URL first`)
    return normalizeBaseUrl(raw)
  }

  async function complete(opts: CompleteOptions, key: string, signal?: AbortSignal): Promise<CompleteResult> {
    if (!key) throw new NoApiKeyError(cfg.id)

    const url = `${resolveBase(opts.baseUrl)}/chat/completions`
    const model = opts.model || cfg.defaultModel
    const timeoutMs = opts.timeoutMs ?? TIMEOUTS.request

    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 4096
    })

    const t0 = Date.now()
    const { signal: timed, dispose } = withTimeout(signal, timeoutMs)
    try {
      const res = await undiciFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...cfg.extraHeaders
        },
        body,
        signal: timed,
        dispatcher: keepAliveAgent
      })
      const text = await res.text()
      if (!res.ok) throw httpError(`${cfg.label} chat`, res.status, text)
      const result = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = result.choices?.[0]?.message?.content || ''
      // Token counts feed the local usage estimate. Best-effort; record with
      // the EXACT model string we sent so pricing resolution can key on it.
      let usage: CompleteResult['usage']
      if (result.usage) {
        const inputTokens = result.usage.prompt_tokens || 0
        const outputTokens = result.usage.completion_tokens || 0
        recordLlmUsage(model, inputTokens, outputTokens)
        usage = { inputTokens, outputTokens }
      }
      // Length only — output text never hits the logs.
      console.log(`[${cfg.id}:chat] ${Date.now() - t0}ms | ${content.length} chars`)
      return { text: content, usage }
    } catch (err) {
      // A caller-initiated cancel (session Escape) must re-throw, not be swallowed.
      if ((err as Error)?.name === 'AbortError') throw err
      throw err
    } finally {
      dispose()
    }
  }

  function testKey(key: string, baseUrl?: string): Promise<KeyTestResult> {
    return testKeyViaModels(`${resolveBase(baseUrl)}/models`, key, cfg.extraHeaders)
  }

  /** Chat-capable filter: /models catalogs also list embeddings, TTS, STT, image, etc. */
  const NON_CHAT_RE = /(embed|whisper|tts|audio|dall-e|image|moderation|transcribe|transcription|realtime|guard|rerank|distil)/i

  async function listModels(key: string, baseUrl?: string): Promise<ProviderModel[]> {
    const { signal, dispose } = withTimeout(undefined, TIMEOUTS.request)
    try {
      const res = await undiciFetch(`${resolveBase(baseUrl)}/models`, {
        headers: {
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...cfg.extraHeaders
        },
        signal,
        dispatcher: keepAliveAgent
      })
      if (!res.ok) return cfg.models
      const body = (await res.json()) as { data?: Array<{ id?: string }> }
      const ids = (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .filter((id) => !NON_CHAT_RE.test(id))
        .sort()
      return ids.length ? ids.map((id) => ({ id, label: id })) : cfg.models
    } catch {
      // No base URL (custom, unset), network error, timeout — static fallback.
      return cfg.models
    } finally {
      dispose()
    }
  }

  return {
    id: cfg.id,
    label: cfg.label,
    defaultBaseUrl: cfg.defaultBaseUrl,
    defaultModel: cfg.defaultModel,
    models: cfg.models,
    complete,
    testKey,
    listModels
  }
}
