// ─── OpenAI LLM provider — pure factory call (openaiCompatible.ts does the work) ───

import { createOpenAICompatibleProvider } from '../openaiCompatible'

export const openaiProvider = createOpenAICompatibleProvider({
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  models: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' }
  ]
})
