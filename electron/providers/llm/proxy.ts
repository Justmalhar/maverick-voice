// ─── Proxy LLM provider ───
// Routes chat completions through maverick-voice-proxy (Groq Llama 3.1 8B).
// The proxy handles model selection server-side via the 'voice-transform' key.
// Token management is handled by electron/auth.ts.

import { getAccessToken, refreshAccessToken } from '../../auth'
import {
  type LLMProvider,
  type CompleteOptions,
  type CompleteResult,
  type KeyTestResult,
} from '../types'

const PROXY_BASE_URL = process.env.PROXY_BASE_URL ?? 'https://proxy.getmaverick.sh'

async function completeWithToken(opts: CompleteOptions, token: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${PROXY_BASE_URL}/api/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voice-transform',
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 4096,
      stream: false,
    }),
    signal,
  })
}

async function complete(
  opts: CompleteOptions,
  _key: string,           // ignored — token comes from auth.ts
  signal?: AbortSignal,
): Promise<CompleteResult> {
  let token = await getAccessToken()
  if (!token) throw new Error('Not signed in. Open Settings → Account and sign in with Google.')

  let res = await completeWithToken(opts, token, signal)

  if (res.status === 401) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) throw new Error('Session expired. Please sign in again.')
    token = refreshed
    res = await completeWithToken(opts, token, signal)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Proxy LLM failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  const usage = data.usage
    ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
    : undefined
  return { text, usage }
}

async function testKey(_key: string): Promise<KeyTestResult> {
  const token = await getAccessToken()
  if (!token) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch(`${PROXY_BASE_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
    return res.ok ? { ok: true } : { ok: false, error: 'Session invalid or expired' }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export const proxyLLMProvider: LLMProvider = {
  id: 'proxy',
  label: 'Maverick (managed)',
  defaultBaseUrl: PROXY_BASE_URL,
  defaultModel: 'voice-transform',
  models: [{ id: 'voice-transform', label: 'Llama 3.1 8B (managed)' }],
  complete,
  testKey,
}
