import type { AppConfig } from '../shared/types'

/** Tuned values ported from v1 — do not "tidy" (see AGENTS.md). */
export const APP_CONFIG: AppConfig = {
  version: '2.0.0-dev.0',
  chunking: {
    enabled: true,
    min_duration_ms: 30000,
    silence_threshold_rms: 0.015,
    silence_duration_ms: 400,
    hard_cap_ms: 45000,
    vad_poll_interval_ms: 100
  },
  junk_detection: {
    max_length: 2,
    pattern: '^[.\\s,!?;:]*$'
  }
}

/** The ONLY place timeout values exist (SYSTEM-DESIGN NFR7). */
export const TIMEOUTS = {
  request: 15_000, // single provider call
  transform: 15_000, // LLM transform budget
  audioArrival: 2_000, // stop → AUDIO_FINAL guard
  helperCommand: 500, // mac-helper stdin ack
  media: 1_500, // pause/resume media control external calls
  undoWindow: 3_000
} as const

export interface ModelPricing {
  perAudioHour?: number
  perMInputTokens?: number
  perMOutputTokens?: number
}

// Hardcoded estimates — WILL drift from provider pricing pages.
// A model absent here contributes $0.
export const PRICING: Record<string, ModelPricing> = {
  // STT (Groq)
  'whisper-large-v3-turbo': { perAudioHour: 0.04 },
  'whisper-large-v3': { perAudioHour: 0.111 },
  // STT (Deepgram)
  'nova-3': { perAudioHour: 0.258 },
  'nova-2': { perAudioHour: 0.258 },
  // STT (OpenAI)
  'whisper-1': { perAudioHour: 0.36 },
  'gpt-4o-transcribe': { perAudioHour: 0.36 },
  'gpt-4o-mini-transcribe': { perAudioHour: 0.18 },
  // LLM (Groq)
  'llama-3.3-70b-versatile': { perMInputTokens: 0.59, perMOutputTokens: 0.79 },
  'llama-3.1-8b-instant': { perMInputTokens: 0.05, perMOutputTokens: 0.08 },
  'openai/gpt-oss-120b': { perMInputTokens: 0.15, perMOutputTokens: 0.75 },
  // LLM (OpenAI)
  'gpt-4o-mini': { perMInputTokens: 0.15, perMOutputTokens: 0.6 },
  'gpt-4o': { perMInputTokens: 2.5, perMOutputTokens: 10.0 },
  'gpt-4.1-mini': { perMInputTokens: 0.4, perMOutputTokens: 1.6 },
  // LLM (OpenRouter slugs)
  'openai/gpt-4o-mini': { perMInputTokens: 0.15, perMOutputTokens: 0.6 },
  'anthropic/claude-3.5-sonnet': { perMInputTokens: 3.0, perMOutputTokens: 15.0 },
  'meta-llama/llama-3.3-70b-instruct': { perMInputTokens: 0.12, perMOutputTokens: 0.3 }
}
