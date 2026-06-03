// ════════════════════════════════════════════════════════════════════════
// electron/providers/types.ts — PROVIDER-AGNOSTIC interfaces + registry types.
//
// The hard requirement: adding a provider = ONE new file implementing one of
// these interfaces + ONE registry entry. Keys are injected by callers (read
// from keyStore) — providers NEVER read or store keys themselves.
//
// Imported by: providers/registry.ts, providers/stt/groq.ts,
// providers/llm/openai.ts, providers/llm/openrouter.ts, sessionManager.ts.
// ════════════════════════════════════════════════════════════════════════

import type { ProviderModel, STTProviderId, LLMProviderId } from '../../shared/types'

// ─── Transcription (STT) ──────────────────────────────────────────────────

export interface TranscribeOptions {
  /** Exact model id to send (e.g. 'whisper-large-v3-turbo'). */
  model: string
  /** Language hint; omit/undefined for auto-detect. Maps from STTSettings.language ('auto' => undefined). */
  language?: string
  /**
   * Optional Whisper vocabulary-biasing prompt. Callers pass a
   * dictionary-bounded hint (the user's corrected spellings, capped to ~200
   * chars); the Groq provider forwards it so Whisper biases toward those
   * spellings. Keep it bounded — Whisper parrots ARBITRARY prompt text back on
   * silence/noise, so never pass a free-form instruction here.
   */
  prompt?: string
  /** MIME type of the audio buffer. Renderer MediaRecorder emits 'audio/webm'. */
  mimeType?: string
}

export interface TranscribeResult {
  /** The transcribed text (provider returns raw; cleanTranscript runs later). */
  text: string
  /**
   * Billed audio seconds (Groq verbose_json reports `duration`). Fed to
   * usageTracker.recordSttUsage. Omit if the provider cannot report it.
   */
  durationSeconds?: number
}

export interface KeyTestResult {
  ok: boolean
  error?: string
}

export interface TranscriptionProvider {
  readonly id: STTProviderId
  readonly label: string
  /** Default model used when STTSettings has no model yet. */
  readonly defaultModel: string
  /** Static models advertised for the Settings dropdown. */
  readonly models: ProviderModel[]
  /**
   * Transcribe one audio buffer. `key` is the decrypted API key injected by the
   * caller. `signal` propagates session cancellation (AbortError must re-throw,
   * NOT be swallowed). Throws on missing key / network / API errors.
   */
  transcribe(
    audio: Buffer,
    opts: TranscribeOptions,
    key: string,
    signal?: AbortSignal
  ): Promise<TranscribeResult>
  /** Validate a key against the provider (e.g. GET /models). */
  testKey(key: string): Promise<KeyTestResult>
}

// ─── LLM (chat/completions, OpenAI-compatible) ─────────────────────────────

export interface CompleteOptions {
  /** Exact model id to send (e.g. 'gpt-4o-mini'). */
  model: string
  /** System prompt. */
  system: string
  /** Fully-assembled user message content (from prompts.ts). */
  user: string
  /** Sampling temperature (prompts.ts decides: dictation 0.1, instruction 0.3). */
  temperature?: number
  /** Max completion tokens. */
  maxTokens?: number
  /**
   * Per-provider base URL override. Empty string => provider default. Lets ANY
   * OpenAI-compatible endpoint plug in (this is the provider-agnostic seam).
   */
  baseUrl?: string
  /** Request timeout in ms (AppConfig.transform.timeout_ms). */
  timeoutMs?: number
}

export interface CompleteResult {
  /** The model's text output. */
  text: string
  /** Token usage, if the API reported it. Fed to usageTracker.recordLlmUsage. */
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface LLMProvider {
  readonly id: LLMProviderId
  readonly label: string
  /** Default OpenAI-compatible base URL (e.g. https://api.openai.com/v1). */
  readonly defaultBaseUrl: string
  /** Default model used when LLMSettings has no model yet. */
  readonly defaultModel: string
  /** Static models advertised for the Settings dropdown. */
  readonly models: ProviderModel[]
  /**
   * Run one chat completion. `key` is the decrypted API key injected by the
   * caller. AbortError must re-throw (caller cancel). Records token usage with
   * the EXACT model string on success. Throws on missing key / network / API.
   */
  complete(opts: CompleteOptions, key: string, signal?: AbortSignal): Promise<CompleteResult>
  /** Validate a key against the provider (e.g. GET {baseUrl}/models). */
  testKey(key: string, baseUrl?: string): Promise<KeyTestResult>
}

// ─── Registry ───────────────────────────────────────────────────────────────

export interface ProviderRegistry {
  getTranscriptionProvider(id: STTProviderId): TranscriptionProvider
  getLLMProvider(id: LLMProviderId): LLMProvider
  /** All registered STT providers (for Settings enumeration). */
  listTranscriptionProviders(): TranscriptionProvider[]
  /** All registered LLM providers (for Settings enumeration). */
  listLLMProviders(): LLMProvider[]
}

/** Thrown by providers when no key is available for the selected provider. */
export class NoApiKeyError extends Error {
  constructor(public readonly providerId: string) {
    super(`No API key set for "${providerId}". Add your key in Settings.`)
    this.name = 'NoApiKeyError'
  }
}
