// ─── Groq LLM provider — pure factory call (openaiCompatible.ts does the work) ───
// Same key as Groq STT (one 'groq' entry in the key vault serves both).

import { createOpenAICompatibleProvider } from '../openaiCompatible'

export const groqLlmProvider = createOpenAICompatibleProvider({
  id: 'groq',
  label: 'Groq',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  defaultModel: 'llama-3.3-70b-versatile',
  models: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' }
  ]
})
