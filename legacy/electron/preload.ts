// ════════════════════════════════════════════════════════════════════════
// electron/preload.ts — contextBridge bridge exposing window.electronAPI.
//
// Implements EXACTLY the ElectronAPI interface from shared/types.ts using the
// channel name constants from shared/ipc.ts. NEVER inline a channel string.
// This is the renderer's ONLY door to the main process.
// ════════════════════════════════════════════════════════════════════════

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  ElectronAPI,
  SessionMode,
  Session,
  UsageSummary,
  ProviderId,
  ProviderKeyStatus,
  SetProviderKeyResult,
  TestProviderKeyResult,
  STTSettings,
  LLMSettings,
  ProviderModel,
  AppConfig,
  DictationKey,
  DictationBinding,
  InstructionKey,
  ActivationMode,
  OutputMode,
  DictionaryEntry,
  Snippet,
  AppProfile,
  Theme
} from '../shared/types'

const electronAPI: ElectronAPI = {
  // ── Recording control ──
  onRecordingStart: (callback) => {
    ipcRenderer.on(
      IPC.RECORDING_START,
      (_e, mode: SessionMode, sessionId?: string, appName?: string, profile?: AppProfile) =>
        callback(mode, sessionId, appName, profile)
    )
  },
  onRecordingStop: (callback) => {
    ipcRenderer.on(IPC.RECORDING_STOP, () => callback())
  },

  // ── Audio streaming ──
  sendAudioReady: (buffer, duration, mode, sessionId) => {
    ipcRenderer.send(IPC.AUDIO_READY, buffer, duration, mode, sessionId)
  },
  sendAudioChunk: (buffer, chunkIndex, mode, sessionId) => {
    ipcRenderer.send(IPC.AUDIO_CHUNK, buffer, chunkIndex, mode, sessionId)
  },
  sendAudioFinalChunk: (buffer, chunkIndex, totalChunks, duration, mode, sessionId) => {
    ipcRenderer.send(IPC.AUDIO_FINAL_CHUNK, buffer, chunkIndex, totalChunks, duration, mode, sessionId)
  },
  sendAudioDiscarded: (mode, sessionId) => {
    ipcRenderer.send(IPC.AUDIO_DISCARDED, mode, sessionId)
  },

  // ── Output ──
  onOutputReady: (callback) => {
    ipcRenderer.on(IPC.OUTPUT_READY, (_e, text: string, sessionId: string) => callback(text, sessionId))
  },
  onOutputFallback: (callback) => {
    ipcRenderer.on(IPC.OUTPUT_FALLBACK, (_e, text: string, sessionId: string, message?: string) =>
      callback(text, sessionId, message)
    )
  },
  onOutputError: (callback) => {
    ipcRenderer.on(IPC.OUTPUT_ERROR, (_e, error: string, sessionId: string) => callback(error, sessionId))
  },

  // ── Sessions / history ──
  getSessions: (): Promise<Session[]> => ipcRenderer.invoke(IPC.SESSION_LIST),
  retrySession: (sessionId) => {
    ipcRenderer.send(IPC.SESSION_RETRY, sessionId)
  },
  onRetryStatus: (callback) => {
    ipcRenderer.on(
      IPC.SESSION_RETRY_STATUS,
      (_e, sessionId: string, status: 'processing' | 'done' | 'error', data?: Partial<Session>) =>
        callback(sessionId, status, data)
    )
  },

  // ── Widget control ──
  stopSession: () => {
    ipcRenderer.send(IPC.WIDGET_STOP)
  },
  cancelSession: () => {
    ipcRenderer.send(IPC.WIDGET_CANCEL)
  },
  undoCancel: () => {
    ipcRenderer.send(IPC.WIDGET_UNDO_CANCEL)
  },
  onSessionCancelled: (callback) => {
    ipcRenderer.on(IPC.SESSION_CANCELLED, () => callback())
  },
  onProcessingDiscardHint: (callback) => {
    ipcRenderer.on(IPC.PROCESSING_SHOW_DISCARD_HINT, () => callback())
  },
  onSessionTooShort: (callback) => {
    ipcRenderer.on(IPC.SESSION_TOO_SHORT, () => callback())
  },
  onEngineNotice: (callback) => {
    ipcRenderer.on(IPC.SESSION_ENGINE_NOTICE, (_e, reason: string) => callback(reason))
  },
  widgetReady: () => {
    ipcRenderer.send(IPC.WIDGET_READY)
  },

  // ── Usage ──
  getUsage: (): Promise<UsageSummary> => ipcRenderer.invoke(IPC.USAGE_GET),
  resetUsage: (): Promise<UsageSummary> => ipcRenderer.invoke(IPC.USAGE_RESET),

  // ── Per-provider API keys ──
  getProviderKeyStatus: (provider: ProviderId): Promise<ProviderKeyStatus> =>
    ipcRenderer.invoke(IPC.KEY_STATUS, provider),
  setProviderKey: (provider: ProviderId, key: string): Promise<SetProviderKeyResult> =>
    ipcRenderer.invoke(IPC.KEY_SET, provider, key),
  testProviderKey: (provider: ProviderId, key: string): Promise<TestProviderKeyResult> =>
    ipcRenderer.invoke(IPC.KEY_TEST, provider, key),
  clearProviderKey: (provider: ProviderId) => {
    ipcRenderer.send(IPC.KEY_CLEAR, provider)
  },

  // ── STT / LLM provider settings ──
  getSTTSettings: (): Promise<STTSettings> => ipcRenderer.invoke(IPC.STT_SETTINGS_GET),
  setSTTSettings: (settings: STTSettings) => {
    ipcRenderer.send(IPC.STT_SETTINGS_SET, settings)
  },
  getLLMSettings: (): Promise<LLMSettings> => ipcRenderer.invoke(IPC.LLM_SETTINGS_GET),
  setLLMSettings: (settings: LLMSettings) => {
    ipcRenderer.send(IPC.LLM_SETTINGS_SET, settings)
  },
  listModels: (provider: ProviderId): Promise<ProviderModel[]> =>
    ipcRenderer.invoke(IPC.LIST_MODELS, provider),

  // ── Permissions ──
  getMicPermissionStatus: (): Promise<string> => ipcRenderer.invoke(IPC.PERM_MIC_STATUS),
  requestMicPermission: (): Promise<boolean> => ipcRenderer.invoke(IPC.PERM_REQUEST_MIC),
  getAccessibilityStatus: (): Promise<boolean> => ipcRenderer.invoke(IPC.PERM_ACCESSIBILITY_STATUS),
  requestAccessibility: (): Promise<boolean> => ipcRenderer.invoke(IPC.PERM_REQUEST_ACCESSIBILITY),
  openMicSettings: () => {
    ipcRenderer.send(IPC.PERM_OPEN_MIC_SETTINGS)
  },
  openAccessibilitySettings: () => {
    ipcRenderer.send(IPC.PERM_OPEN_ACCESSIBILITY_SETTINGS)
  },
  openKeyboardSettings: () => {
    ipcRenderer.send(IPC.PERM_OPEN_KEYBOARD_SETTINGS)
  },

  // ── External links ──
  openExternal: (url: string) => {
    ipcRenderer.send(IPC.OPEN_EXTERNAL, url)
  },

  // ── Local app config ──
  getAppConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_GET),

  // ── Behaviour / appearance ──
  getTheme: (): Promise<Theme> => ipcRenderer.invoke(IPC.GET_THEME),
  setTheme: (theme: Theme) => {
    ipcRenderer.send(IPC.SET_THEME, theme)
  },
  setWidgetPosition: (position: 'center' | 'right') => {
    ipcRenderer.send(IPC.SET_WIDGET_POSITION, position)
  },
  getWidgetPosition: (): Promise<'center' | 'right'> => ipcRenderer.invoke(IPC.GET_WIDGET_POSITION),
  setSoundFeedback: (enabled: boolean) => {
    ipcRenderer.send(IPC.SET_SOUND_FEEDBACK, enabled)
  },
  getSoundFeedback: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_SOUND_FEEDBACK),
  setChunkedTranscription: (enabled: boolean) => {
    ipcRenderer.send(IPC.SET_CHUNKED_TRANSCRIPTION, enabled)
  },
  getChunkedTranscription: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_CHUNKED_TRANSCRIPTION),
  setOutputMode: (mode: OutputMode) => {
    ipcRenderer.send(IPC.SET_OUTPUT_MODE, mode)
  },
  getOutputMode: (): Promise<OutputMode> => ipcRenderer.invoke(IPC.GET_OUTPUT_MODE),
  setInputDevice: (deviceId: string) => {
    ipcRenderer.send(IPC.SET_INPUT_DEVICE, deviceId)
  },
  getInputDevice: (): Promise<string> => ipcRenderer.invoke(IPC.GET_INPUT_DEVICE),

  // ── AI auto-format ──
  getAutoFormat: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_AUTO_FORMAT),
  setAutoFormat: (enabled: boolean) => {
    ipcRenderer.send(IPC.SET_AUTO_FORMAT, enabled)
  },
  getAppAwareFormatting: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_APP_AWARE_FORMATTING),
  setAppAwareFormatting: (enabled: boolean) => {
    ipcRenderer.send(IPC.SET_APP_AWARE_FORMATTING, enabled)
  },

  // ── Instruction mode opt-in ──
  getInstructionEnabled: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_INSTRUCTION_ENABLED),
  setInstructionEnabled: (enabled: boolean) => {
    ipcRenderer.send(IPC.SET_INSTRUCTION_ENABLED, enabled)
  },

  // ── Dictionary ──
  getDictionary: (): Promise<DictionaryEntry[]> => ipcRenderer.invoke(IPC.GET_DICTIONARY),
  setDictionary: (entries: DictionaryEntry[]): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_DICTIONARY, entries),

  // ── Snippets ──
  getSnippets: (): Promise<Snippet[]> => ipcRenderer.invoke(IPC.GET_SNIPPETS),
  setSnippets: (snippets: Snippet[]): Promise<void> => ipcRenderer.invoke(IPC.SET_SNIPPETS, snippets),

  // ── Key bindings ──
  setDictationKey: (key: DictationKey) => {
    ipcRenderer.send(IPC.SET_DICTATION_KEY, key)
  },
  getDictationKey: (): Promise<DictationKey> => ipcRenderer.invoke(IPC.GET_DICTATION_KEY),
  getDictationBinding: (): Promise<DictationBinding> => ipcRenderer.invoke(IPC.GET_DICTATION_BINDING),
  setDictationBinding: (binding: DictationBinding) => {
    ipcRenderer.send(IPC.SET_DICTATION_BINDING, binding)
  },
  setInstructionKey: (key: InstructionKey) => {
    ipcRenderer.send(IPC.SET_INSTRUCTION_KEY, key)
  },
  getInstructionKey: (): Promise<InstructionKey> => ipcRenderer.invoke(IPC.GET_INSTRUCTION_KEY),
  setActivationMode: (mode: ActivationMode) => {
    ipcRenderer.send(IPC.SET_ACTIVATION_MODE, mode)
  },
  getActivationMode: (): Promise<ActivationMode> => ipcRenderer.invoke(IPC.GET_ACTIVATION_MODE),

  // ── Cleanup ──
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
