// ─── Custom LLM provider — any OpenAI-compatible endpoint ───
// No default base URL or model: the user supplies both in Settings
// (LLMSettings.baseUrl / .model) alongside an optional API key.

import { createOpenAICompatibleProvider } from '../openaiCompatible'

export const customLlmProvider = createOpenAICompatibleProvider({
  id: 'custom',
  label: 'Custom',
  defaultBaseUrl: '', // must come from LLMSettings.baseUrl
  defaultModel: '',
  models: [] // free-text model input in Settings
})
