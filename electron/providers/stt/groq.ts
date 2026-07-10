// ─── Groq STT provider — pure factory call (whisperCompatible.ts does the work) ───

import { createWhisperCompatibleProvider } from './whisperCompatible'

export const groqSttProvider = createWhisperCompatibleProvider({
  id: 'groq',
  label: 'Groq',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  defaultModel: 'whisper-large-v3-turbo',
  models: [
    { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo' },
    { id: 'whisper-large-v3', label: 'Whisper Large v3' }
  ]
})
