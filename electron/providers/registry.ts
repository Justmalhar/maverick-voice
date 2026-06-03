// ─── Provider registry ───
// Maps provider ids → instances. The hard requirement: adding a provider is ONE
// new file (implementing TranscriptionProvider / LLMProvider) + ONE `.set(...)`
// line here. No keys here (callers inject), no IPC here.

import type { STTProviderId, LLMProviderId } from '../../shared/types'
import type { TranscriptionProvider, LLMProvider, ProviderRegistry } from './types'
import { groqProvider } from './stt/groq'
import { openaiProvider } from './llm/openai'
import { openrouterProvider } from './llm/openrouter'

// ─── Internal maps ───
const sttProviders = new Map<STTProviderId, TranscriptionProvider>()
const llmProviders = new Map<LLMProviderId, LLMProvider>()

// Register providers (the single point of extension).
sttProviders.set(groqProvider.id, groqProvider)
llmProviders.set(openaiProvider.id, openaiProvider)
llmProviders.set(openrouterProvider.id, openrouterProvider)

/** Resolve an STT provider by id. Throws a clear error on an unknown id. */
export function getTranscriptionProvider(id: STTProviderId): TranscriptionProvider {
  const provider = sttProviders.get(id)
  if (!provider) {
    throw new Error(`[registry] Unknown transcription provider: "${id}"`)
  }
  return provider
}

/** Resolve an LLM provider by id. Throws a clear error on an unknown id. */
export function getLLMProvider(id: LLMProviderId): LLMProvider {
  const provider = llmProviders.get(id)
  if (!provider) {
    throw new Error(`[registry] Unknown LLM provider: "${id}"`)
  }
  return provider
}

/** All registered STT providers (for Settings enumeration). */
export function listTranscriptionProviders(): TranscriptionProvider[] {
  return Array.from(sttProviders.values())
}

/** All registered LLM providers (for Settings enumeration). */
export function listLLMProviders(): LLMProvider[] {
  return Array.from(llmProviders.values())
}

/** The ProviderRegistry object (interface from providers/types.ts). */
export const registry: ProviderRegistry = {
  getTranscriptionProvider,
  getLLMProvider,
  listTranscriptionProviders,
  listLLMProviders,
}
