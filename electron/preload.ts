import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ElectronAPI, Unsubscribe } from '../shared/types'

/**
 * Every subscription returns its unsubscriber (INTERFACES FR22) —
 * the renderer never touches channel strings or removeAllListeners.
 */
function subscribe(channel: string, cb: (...args: never[]) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
    ;(cb as (...a: unknown[]) => void)(...args)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ElectronAPI = {
  // Session / recording
  onRecordingStart: (cb) => subscribe(IPC.RECORDING_START, cb),
  onRecordingStop: (cb) => subscribe(IPC.RECORDING_STOP, cb),
  recordingAck: (sessionId) => ipcRenderer.send(IPC.RECORDING_ACK, sessionId),
  sendAudioChunk: (buffer, chunkIndex, mode, sessionId) =>
    ipcRenderer.send(IPC.AUDIO_CHUNK, buffer, chunkIndex, mode, sessionId),
  sendAudioFinal: (buffer, chunkIndex, totalChunks, duration, mode, sessionId) =>
    ipcRenderer.send(IPC.AUDIO_FINAL, buffer, chunkIndex, totalChunks, duration, mode, sessionId),
  sendAudioDiscarded: (mode, sessionId) => ipcRenderer.send(IPC.AUDIO_DISCARDED, mode, sessionId),
  onOutputReady: (cb) => subscribe(IPC.OUTPUT_READY, cb),
  onOutputFallback: (cb) => subscribe(IPC.OUTPUT_FALLBACK, cb),
  onOutputError: (cb) => subscribe(IPC.OUTPUT_ERROR, cb),
  onSessionCancelled: (cb) => subscribe(IPC.SESSION_CANCELLED, cb),
  onSessionTooShort: (cb) => subscribe(IPC.SESSION_TOO_SHORT, cb),
  onProcessingDiscardHint: (cb) => subscribe(IPC.PROCESSING_SHOW_DISCARD_HINT, cb),
  widgetStop: () => ipcRenderer.send(IPC.WIDGET_STOP),
  widgetCancel: () => ipcRenderer.send(IPC.WIDGET_CANCEL),
  widgetUndoCancel: () => ipcRenderer.send(IPC.WIDGET_UNDO_CANCEL),
  widgetReady: () => ipcRenderer.send(IPC.WIDGET_READY),
  onHudHide: (cb) => subscribe(IPC.HUD_HIDE, cb),
  hudExitDone: () => ipcRenderer.send(IPC.HUD_EXIT_DONE),

  // History / usage
  getSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST),
  retrySession: (sessionId) => ipcRenderer.invoke(IPC.SESSION_RETRY, sessionId),
  onRetryStatus: (cb) => subscribe(IPC.SESSION_RETRY_STATUS, cb),
  deleteSession: (sessionId) => ipcRenderer.invoke(IPC.SESSION_DELETE, sessionId),
  clearAllSessions: () => ipcRenderer.invoke(IPC.SESSION_CLEAR_ALL),
  getUsage: () => ipcRenderer.invoke(IPC.USAGE_GET),
  resetUsage: () => ipcRenderer.invoke(IPC.USAGE_RESET),

  // Provider keys / models
  getProviderKeyStatus: (provider) => ipcRenderer.invoke(IPC.KEY_STATUS, provider),
  setProviderKey: (provider, key) => ipcRenderer.invoke(IPC.KEY_SET, provider, key),
  testProviderKey: (provider, key) => ipcRenderer.invoke(IPC.KEY_TEST, provider, key),
  clearProviderKey: (provider) => ipcRenderer.send(IPC.KEY_CLEAR, provider),
  listModels: (provider, kind) => ipcRenderer.invoke(IPC.LIST_MODELS, provider, kind),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  onSettingsChanged: (cb) => subscribe(IPC.SETTINGS_CHANGED, cb),
  setWidgetPosition: (position) => ipcRenderer.send(IPC.SET_WIDGET_POSITION, position),
  setSoundFeedback: (enabled) => ipcRenderer.send(IPC.SET_SOUND_FEEDBACK, enabled),
  setChunkedTranscription: (enabled) => ipcRenderer.send(IPC.SET_CHUNKED_TRANSCRIPTION, enabled),
  setOutputMode: (mode) => ipcRenderer.send(IPC.SET_OUTPUT_MODE, mode),
  setInputDevice: (deviceId) => ipcRenderer.send(IPC.SET_INPUT_DEVICE, deviceId),
  setActivationMode: (mode) => ipcRenderer.send(IPC.SET_ACTIVATION_MODE, mode),
  setAutoFormat: (enabled) => ipcRenderer.send(IPC.SET_AUTO_FORMAT, enabled),
  setInstructionEnabled: (enabled) => ipcRenderer.send(IPC.SET_INSTRUCTION_ENABLED, enabled),
  setAppAwareFormatting: (enabled) => ipcRenderer.send(IPC.SET_APP_AWARE_FORMATTING, enabled),
  setPauseMediaDuringDictation: (enabled) => ipcRenderer.send(IPC.SET_PAUSE_MEDIA, enabled),
  setDictationBinding: (binding) => ipcRenderer.send(IPC.SET_DICTATION_BINDING, binding),
  setDictionary: (words) => ipcRenderer.invoke(IPC.SET_DICTIONARY, words),
  setReplacements: (entries) => ipcRenderer.invoke(IPC.SET_REPLACEMENTS, entries),
  setSnippets: (snippets) => ipcRenderer.invoke(IPC.SET_SNIPPETS, snippets),
  setRules: (rules) => ipcRenderer.invoke(IPC.SET_RULES, rules),
  setSTTSettings: (settings) => ipcRenderer.send(IPC.STT_SETTINGS_SET, settings),
  setLLMSettings: (settings) => ipcRenderer.send(IPC.LLM_SETTINGS_SET, settings),

  // Theme
  getTheme: () => ipcRenderer.invoke(IPC.THEME_GET),
  setTheme: (theme) => ipcRenderer.send(IPC.THEME_SET, theme),

  // Permissions / capability
  permissionsPreflight: () => ipcRenderer.invoke(IPC.PERM_PREFLIGHT),
  openPermissionPane: (pane) => ipcRenderer.send(IPC.PERM_OPEN_PANE, pane),
  requestMicPermission: () => ipcRenderer.invoke(IPC.PERM_REQUEST_MIC),
  getKeyCapability: () => ipcRenderer.invoke(IPC.KEY_CAPABILITY),

  // Misc
  getAppConfig: () => ipcRenderer.invoke(IPC.CONFIG_GET),
  openExternal: (url) => ipcRenderer.send(IPC.OPEN_EXTERNAL, url),
  onDevErrorLog: (cb) => subscribe(IPC.DEV_ERROR_LOG, cb)
}

contextBridge.exposeInMainWorld('electronAPI', api)
