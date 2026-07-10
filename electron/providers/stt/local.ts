// ─── Local STT provider — any OpenAI-compatible server on your machine ───
// (speaches / faster-whisper-server / LM Studio / whisper.cpp with an OAI
// shim). No API key required; STTSettings.baseUrl points at the server and
// the model name is free text (server-dependent).

import { createWhisperCompatibleProvider } from './whisperCompatible'

export const localSttProvider = createWhisperCompatibleProvider({
  id: 'local',
  label: 'Local',
  defaultBaseUrl: 'http://localhost:8000/v1',
  defaultModel: 'whisper-1',
  models: [], // server-dependent — Settings shows a free-text model input
  requiresKey: false
})
