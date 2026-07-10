// ─── OpenRouter LLM provider — pure factory call (openaiCompatible.ts does the work) ───
// OpenAI-compatible; only the base URL, model slugs, and two OpenRouter
// attribution-convention headers differ.

import { createOpenAICompatibleProvider } from '../openaiCompatible'

export const openrouterProvider = createOpenAICompatibleProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-4o-mini',
  models: [
    { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o mini' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' }
  ],
  extraHeaders: {
    'HTTP-Referer': 'https://getmaverick.sh',
    'X-Title': 'Maverick Voice'
  }
})
