// ════════════════════════════════════════════════════════════════════════
// electron/providers/registry.ts — Map-based provider registry.
//
// Adding a provider is ONE file + ONE `.set(...)` line below (SYSTEM-DESIGN
// NFR5). Unknown id => throw a clear Error (never a silent undefined).
// 'openai' and 'groq' exist in BOTH maps (STT + LLM roles, one shared key).
// ════════════════════════════════════════════════════════════════════════

import type { STTProviderId, LLMProviderId } from '../../shared/types'
import type { TranscriptionProvider, LLMProvider } from './types'
import { deepgramProvider } from './stt/deepgram'
import { groqSttProvider } from './stt/groq'
import { localSttProvider } from './stt/local'
import { openaiSttProvider } from './stt/openai'
import { customLlmProvider } from './llm/custom'
import { groqLlmProvider } from './llm/groq'
import { openaiProvider } from './llm/openai'
import { openrouterProvider } from './llm/openrouter'

const sttProviders = new Map<STTProviderId, TranscriptionProvider>()
const llmProviders = new Map<LLMProviderId, LLMProvider>()

// ── Registrations go here — one import + one `.set()` line per provider ──
sttProviders.set('deepgram', deepgramProvider)
sttProviders.set('openai', openaiSttProvider)
sttProviders.set('groq', groqSttProvider)
sttProviders.set('local', localSttProvider)
llmProviders.set('openai', openaiProvider)
llmProviders.set('groq', groqLlmProvider)
llmProviders.set('openrouter', openrouterProvider)
llmProviders.set('custom', customLlmProvider)

export function getTranscriptionProvider(id: STTProviderId): TranscriptionProvider {
  const provider = sttProviders.get(id)
  if (!provider) throw new Error(`Unknown transcription provider: "${id}"`)
  return provider
}

export function getLLMProvider(id: LLMProviderId): LLMProvider {
  const provider = llmProviders.get(id)
  if (!provider) throw new Error(`Unknown LLM provider: "${id}"`)
  return provider
}

export function listTranscriptionProviders(): TranscriptionProvider[] {
  return [...sttProviders.values()]
}

export function listLLMProviders(): LLMProvider[] {
  return [...llmProviders.values()]
}
