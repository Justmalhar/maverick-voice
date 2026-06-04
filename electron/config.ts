// ════════════════════════════════════════════════════════════════════════
// electron/config.ts — LOCAL app configuration + provider pricing tables.
//
// This is the local-constant replacement for the reference unmute Cloudflare
// `ServerConfig` fetch. Maverick Voice is a fully-local, bring-your-own-key
// app, so there is no remote backend and no config worker — everything the
// pipeline needs lives here as plain constants (main.ts may layer electron-store
// overrides on top when answering IPC.CONFIG_GET, but these are the defaults).
//
// Imported by: main.ts, sessionManager.ts, usageTracker.ts, all provider files,
// keyboard.ts (chain window). Compiles under tsconfig.node.json.
// ════════════════════════════════════════════════════════════════════════

import type { AppConfig } from '../shared/types'

// ─── App-wide tunables (was the Cloudflare ServerConfig) ───
// `transform.timeout_ms`     — budget for a single LLM transform call.
// `chunking.*`               — read by the renderer at recording start to drive
//                              the VAD silence-splitting engine for long clips.
// `junk_detection.*`         — a transcript this short AND matching this pattern
//                              (only punctuation/whitespace) is treated as
//                              silence and produces no output.
export const APP_CONFIG: AppConfig = {
  version: 1,
  transform: {
    timeout_ms: 15_000,
  },
  chunking: {
    enabled: true,
    min_duration_ms: 30_000,
    silence_threshold_rms: 0.015,
    silence_duration_ms: 400,
    hard_cap_ms: 45_000,
    vad_poll_interval_ms: 100,
  },
  junk_detection: {
    max_length: 2,
    pattern: '^[.\\s,!?;:]*$',
  },
}

// ─── Request timeout for a single provider call (STT or LLM) ───
export const REQUEST_TIMEOUT_MS = 15_000

// ─── Provider pricing (for the local usage/cost estimate) ───
// Neither Groq nor OpenAI-compatible APIs report dollars-per-request, so
// Maverick Voice estimates spend locally: it multiplies the exact usage each
// response reports (audio seconds for STT, token counts for LLM) by the rates
// below. usageTracker resolves a row's price by the EXACT model string the
// provider recorded, so the keys here MUST match what each provider sends.
//
// ⚠️  These rates are HARDCODED and will silently DRIFT if a provider changes
// its pricing. Verify against the provider pricing pages — last checked 2026-06:
//   Groq    <https://groq.com/pricing>
//   OpenAI  <https://openai.com/api/pricing>
//   OpenRouter <https://openrouter.ai/models>
// A model with no entry here contributes $0 to the estimate (e.g. an unknown
// OpenRouter slug estimates at $0).
export interface ModelPricing {
  /** USD per hour of transcribed audio (STT models). */
  perAudioHour?: number
  /** USD per 1M input/prompt tokens (chat models). */
  perMInputTokens?: number
  /** USD per 1M output/completion tokens (chat models). */
  perMOutputTokens?: number
}

// Groq STT (Whisper) — billed per second of audio, expressed here per hour.
export const STT_PRICING: Record<string, ModelPricing> = {
  'whisper-large-v3-turbo': { perAudioHour: 0.04 },
  'whisper-large-v3': { perAudioHour: 0.111 },
}

// OpenAI + OpenRouter LLM rates (USD per 1M tokens). OpenRouter slugs are keyed
// separately because the provider records the exact slug it sent.
export const LLM_PRICING: Record<string, ModelPricing> = {
  // ── Groq production chat models (console.groq.com/docs/models, per 1M tokens) ──
  'llama-3.3-70b-versatile': { perMInputTokens: 0.59, perMOutputTokens: 0.79 },
  'llama-3.1-8b-instant': { perMInputTokens: 0.05, perMOutputTokens: 0.08 },
  'openai/gpt-oss-120b': { perMInputTokens: 0.15, perMOutputTokens: 0.6 },
  'openai/gpt-oss-20b': { perMInputTokens: 0.075, perMOutputTokens: 0.3 },

  // ── OpenAI ──
  'gpt-4o-mini': { perMInputTokens: 0.15, perMOutputTokens: 0.6 },
  'gpt-4o': { perMInputTokens: 2.5, perMOutputTokens: 10.0 },
  'gpt-4.1-mini': { perMInputTokens: 0.4, perMOutputTokens: 1.6 },

  // ── OpenRouter (provider/model slugs) ──
  'openai/gpt-4o-mini': { perMInputTokens: 0.15, perMOutputTokens: 0.6 },
  'anthropic/claude-3.5-sonnet': { perMInputTokens: 3.0, perMOutputTokens: 15.0 },
  'meta-llama/llama-3.3-70b-instruct': { perMInputTokens: 0.12, perMOutputTokens: 0.3 },
}

// Convenience merged view consumed by usageTracker.rowCost (one lookup table).
export const PRICING: Record<string, ModelPricing> = {
  ...STT_PRICING,
  ...LLM_PRICING,
}
