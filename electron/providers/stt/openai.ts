// ─── OpenAI STT provider — pure factory call (whisperCompatible.ts does the work) ───
// gpt-4o-*-transcribe models only accept response_format=json (no billed
// duration); whisper-1 supports verbose_json.

import { createWhisperCompatibleProvider } from './whisperCompatible'

export const openaiSttProvider = createWhisperCompatibleProvider({
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini-transcribe',
  models: [
    { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe' },
    { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
    { id: 'whisper-1', label: 'Whisper' }
  ],
  verboseJson: (model) => model.startsWith('whisper')
})
