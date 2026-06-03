// ─── OpenAI LLM provider (LLMProvider) ───
// OpenAI-compatible chat/completions client. This is the canonical template
// (salvaged from the reference groqChat / localLLM.chat call shapes): POST
// {baseUrl}/chat/completions with a Bearer key, a system+user message pair, a
// temperature and a max_tokens cap, then parse choices[0].message.content.
//
// Keys are injected by the caller (sessionManager reads keyStore) — this module
// NEVER touches keyStore. A keep-alive undici Agent reuses connections across
// the back-to-back transform calls.

import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici'
import { REQUEST_TIMEOUT_MS } from '../../config'
import { recordLlmUsage } from '../../usageTracker'
import {
  NoApiKeyError,
  type LLMProvider,
  type CompleteOptions,
  type CompleteResult,
  type KeyTestResult,
} from '../types'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const agent = new UndiciAgent({
  keepAliveTimeout: 120_000,
  keepAliveMaxTimeout: 120_000,
  connections: 4,
  pipelining: 1,
})

/** Combine an optional caller signal with an internal timeout (ms). */
function withTimeout(timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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

/** Strip a trailing '/' so `${base}/chat/completions` never doubles the slash. */
function normalizeBaseUrl(baseUrl?: string): string {
  const base = (baseUrl && baseUrl.trim()) || DEFAULT_BASE_URL
  return base.replace(/\/+$/, '')
}

/** Run one chat completion. */
async function complete(
  opts: CompleteOptions,
  key: string,
  signal?: AbortSignal,
): Promise<CompleteResult> {
  if (!key) throw new NoApiKeyError('openai')

  const base = normalizeBaseUrl(opts.baseUrl)
  const url = `${base}/chat/completions`
  const model = opts.model || openaiProvider.defaultModel
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 4096,
  })

  const t0 = Date.now()
  const { signal: timed, clear } = withTimeout(timeoutMs, signal)
  try {
    const res = await undiciFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
      signal: timed,
      dispatcher: agent,
    } as any)
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`OpenAI chat failed (${res.status}): ${text.substring(0, 200)}`)
    }
    const result = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = result.choices?.[0]?.message?.content || ''
    // Token counts feed the local usage estimate. Best-effort; record with the
    // EXACT model string we sent so usageTracker can price it.
    let usage: CompleteResult['usage']
    if (result.usage) {
      const inputTokens = result.usage.prompt_tokens || 0
      const outputTokens = result.usage.completion_tokens || 0
      recordLlmUsage(model, inputTokens, outputTokens)
      usage = { inputTokens, outputTokens }
    }
    console.log(`[openai:chat] ${Date.now() - t0}ms | ${content.length} chars`)
    return { text: content, usage }
  } catch (err) {
    // A caller-initiated cancel must re-throw, not be swallowed.
    if ((err as Error)?.name === 'AbortError') throw err
    throw err
  } finally {
    clear()
  }
}

/** Validate a candidate API key with a lightweight GET {baseUrl}/models call. */
async function testKey(key: string, baseUrl?: string): Promise<KeyTestResult> {
  const trimmed = (key || '').trim()
  if (!trimmed) return { ok: false, error: 'Key is empty' }
  const url = `${normalizeBaseUrl(baseUrl)}/models`
  try {
    const res = await undiciFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${trimmed}` },
      dispatcher: agent,
    } as any)
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'Invalid API key' }
    return { ok: false, error: `OpenAI returned ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export const openaiProvider: LLMProvider = {
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultModel: 'gpt-4o-mini',
  models: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  ],
  complete,
  testKey,
}
