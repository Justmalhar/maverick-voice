// ════════════════════════════════════════════════════════════════════════
// electron/providers/http.ts — shared undici plumbing for ALL providers.
// One keep-alive Agent (TCP+TLS reuse shaves handshake latency off
// back-to-back requests), a timeout+cancel signal combinator, base-URL
// normalization, and uniform error/key-test helpers. v1 copy-pasted ~450
// lines of this across three provider files (LEGACY-ISSUES A2) — every
// provider imports from here instead.
// ════════════════════════════════════════════════════════════════════════

import { Agent, fetch as undiciFetch } from 'undici'
import type { KeyTestResult } from './types'

/** The one keep-alive Agent — every provider request rides the same pool. */
export const keepAliveAgent = new Agent({
  keepAliveTimeout: 120_000,
  keepAliveMaxTimeout: 120_000,
  connections: 4,
  pipelining: 1
})

/**
 * Combine an optional caller AbortSignal (session cancellation rides it) with
 * an internal timeout. Callers MUST call dispose() in a finally block.
 */
export function withTimeout(
  signal: AbortSignal | undefined,
  ms: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** Trim trailing '/' (so `${base}/chat/completions` never doubles the slash) and ensure a protocol. */
export function normalizeBaseUrl(url: string): string {
  let base = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`
  return base
}

/** Build an Error from a failed response — body truncated to 200 chars. */
export function httpError(what: string, status: number, body: string): Error {
  return new Error(`${what} failed (${status}): ${body.substring(0, 200)}`)
}

/** Uniform key validation: GET a /models endpoint with the candidate key. */
export async function testKeyViaModels(
  modelsUrl: string,
  key: string,
  extraHeaders?: Record<string, string>
): Promise<KeyTestResult> {
  const trimmed = (key || '').trim()
  if (!trimmed) return { ok: false, error: 'API key is empty' }
  try {
    const res = await undiciFetch(modelsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${trimmed}`, ...extraHeaders },
      dispatcher: keepAliveAgent
    })
    if (res.ok) return { ok: true }
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Key test failed (${res.status}): ${body.substring(0, 200)}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
