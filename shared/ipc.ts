// ════════════════════════════════════════════════════════════════════════
// shared/ipc.ts — THE SINGLE SOURCE OF TRUTH for every IPC channel name.
//
// Imported by BOTH electron/preload.ts, electron/main.ts (and any main-process
// module that sends to the renderer) AND nowhere in the renderer directly
// (the renderer only ever touches window.electronAPI). Builders MUST import
// these constants — NEVER inline a channel string. Adding/renaming a channel
// happens here once.
//
// Direction legend:
//   M->R  main process sends, renderer listens (ipcMain webContents.send / preload ipcRenderer.on)
//   R->M  renderer sends, main listens via ipcMain.on   (fire-and-forget)
//   R<->M renderer invokes, main handles via ipcMain.handle (request/response Promise)
//
// Runtime-import-free (plain const object) so it compiles under both tsconfigs.
// ════════════════════════════════════════════════════════════════════════

export const IPC = {
  // ── Recording lifecycle ────────────────────────────────────────────────
  /** M->R  (mode: SessionMode, sessionId: string) — tell HUD to begin capture. */
  RECORDING_START: 'recording:start',
  /** M->R  () — tell HUD to stop capture and flush audio. */
  RECORDING_STOP: 'recording:stop',

  // ── Audio streaming ─────────────────────────────────────────────────────
  /** R->M  (buffer: ArrayBuffer, duration: number, mode, sessionId?) — full non-chunked clip. */
  AUDIO_READY: 'audio:ready',
  /** R->M  (buffer: ArrayBuffer, chunkIndex: number, mode, sessionId?) — mid-recording VAD macro-chunk. */
  AUDIO_CHUNK: 'audio:chunk',
  /** R->M  (buffer: ArrayBuffer, chunkIndex, totalChunks, duration, mode, sessionId?) — last chunk; buffer may be ArrayBuffer(0). */
  AUDIO_FINAL_CHUNK: 'audio:final-chunk',
  /** R->M  (mode, sessionId?) — too-short/silent clip; no STT call made. */
  AUDIO_DISCARDED: 'audio:discarded',

  // ── Output delivery ─────────────────────────────────────────────────────
  /** M->R  (text: string, sessionId: string) — success; text already pasted. */
  OUTPUT_READY: 'output:ready',
  /** M->R  (text: string, sessionId: string, message?: string) — LLM formatting failed, raw transcript pasted. */
  OUTPUT_FALLBACK: 'output:fallback',
  /** M->R  (error: string, sessionId: string) — simplifyError'd message. */
  OUTPUT_ERROR: 'output:error',

  // ── Session control / status ────────────────────────────────────────────
  /** R<->M (sessionId: string) -> void — re-process from saved audio. (handle) */
  SESSION_RETRY: 'session:retry',
  /** M->R  (sessionId: string, status: 'processing'|'done'|'error', data?: Partial<Session>) */
  SESSION_RETRY_STATUS: 'session:retry-status',
  /** R->M  () — user clicked the HUD Stop button: stop recording + process now. */
  WIDGET_STOP: 'widget:stop',
  /** R->M  () — user pressed Escape during recording (undo-able cancel). */
  WIDGET_CANCEL: 'widget:cancel',
  /** R->M  () — user clicked undo within the 3s window. */
  WIDGET_UNDO_CANCEL: 'widget:undo-cancel',
  /** M->R  () — show the cancelled+undo state in the HUD. */
  SESSION_CANCELLED: 'session:cancelled',
  /** M->R  () — show "Esc to discard" hint while processing. */
  PROCESSING_SHOW_DISCARD_HINT: 'processing:show-discard-hint',
  /** M->R  () — no audio after grace period / discarded. */
  SESSION_TOO_SHORT: 'session:too-short',
  /** M->R  (reason: string) — provider fallback notice (e.g. raw transcript used). */
  SESSION_ENGINE_NOTICE: 'session:engine-notice',
  /** R->M  () — widget React tree mounted; gates showHUD() readiness. */
  WIDGET_READY: 'widget:ready',

  // ── Session history ──────────────────────────────────────────────────────
  /** R<->M () -> Session[] (handle). */
  SESSION_LIST: 'session:list',

  // ── Usage / cost ──────────────────────────────────────────────────────────
  /** R<->M () -> UsageSummary (handle). */
  USAGE_GET: 'usage:get',
  /** R<->M () -> UsageSummary (handle) — clears usage_daily then returns empty summary. */
  USAGE_RESET: 'usage:reset',

  // ── Per-provider API keys (safeStorage) ────────────────────────────────────
  /** R<->M (provider: ProviderId) -> ProviderKeyStatus (handle). */
  KEY_STATUS: 'key:status',
  /** R<->M (provider: ProviderId, key: string) -> SetProviderKeyResult (handle). */
  KEY_SET: 'key:set',
  /** R<->M (provider: ProviderId, key: string) -> TestProviderKeyResult (handle). */
  KEY_TEST: 'key:test',
  /** R->M  (provider: ProviderId) — clear stored key for a provider. */
  KEY_CLEAR: 'key:clear',

  // ── STT / LLM provider settings ────────────────────────────────────────────
  /** R<->M () -> STTSettings (handle). */
  STT_SETTINGS_GET: 'settings:get-stt',
  /** R->M  (settings: STTSettings). */
  STT_SETTINGS_SET: 'settings:set-stt',
  /** R<->M () -> LLMSettings (handle). */
  LLM_SETTINGS_GET: 'settings:get-llm',
  /** R->M  (settings: LLMSettings). */
  LLM_SETTINGS_SET: 'settings:set-llm',
  /** R<->M (provider: ProviderId) -> ProviderModel[] (handle). */
  LIST_MODELS: 'settings:list-models',

  // ── Permissions ────────────────────────────────────────────────────────────
  /** R<->M () -> string ('granted'|'denied'|'restricted'|'not-determined'|'unknown'); 'granted' on win32. */
  PERM_MIC_STATUS: 'permissions:mic-status',
  /** R<->M () -> boolean (askForMediaAccess); true on win32. */
  PERM_REQUEST_MIC: 'permissions:request-mic',
  /** R<->M () -> boolean (isTrustedAccessibilityClient(false)); true on win32. */
  PERM_ACCESSIBILITY_STATUS: 'permissions:accessibility-status',
  /** R<->M () -> boolean (isTrustedAccessibilityClient(true) prompts); true on win32. */
  PERM_REQUEST_ACCESSIBILITY: 'permissions:request-accessibility',
  /** R->M  () — open macOS Privacy>Microphone; no-op on win32. */
  PERM_OPEN_MIC_SETTINGS: 'permissions:open-mic-settings',
  /** R->M  () — open macOS Privacy>Accessibility; no-op on win32. */
  PERM_OPEN_ACCESSIBILITY_SETTINGS: 'permissions:open-accessibility-settings',
  /** R->M  () — open macOS Keyboard settings (free up Fn key); no-op on win32. */
  PERM_OPEN_KEYBOARD_SETTINGS: 'permissions:open-keyboard-settings',

  // ── External links ──────────────────────────────────────────────────────────
  /** R->M  (url: string) — shell.openExternal (http/https only). */
  OPEN_EXTERNAL: 'open-external',

  // ── Local app config ──────────────────────────────────────────────────────────
  /** R<->M () -> AppConfig (handle) — local constant + electron-store overrides. */
  CONFIG_GET: 'config:get',

  // ── Behaviour / appearance settings ────────────────────────────────────────────
  /** R<->M () -> Theme ('light'|'dark'|'system', default 'system') (handle). */
  GET_THEME: 'settings:get-theme',
  /** R->M  (theme: Theme) -> persist; renderer applies live (no relaunch). */
  SET_THEME: 'settings:theme',
  /** R->M  (position: 'center'|'right') -> setHUDPosition + persist. */
  SET_WIDGET_POSITION: 'settings:widget-position',
  /** R<->M () -> 'center'|'right' (default 'center') (handle). */
  GET_WIDGET_POSITION: 'settings:get-widget-position',
  /** R->M  (enabled: boolean) -> persist. */
  SET_SOUND_FEEDBACK: 'settings:sound-feedback',
  /** R<->M () -> boolean (default true) (handle). */
  GET_SOUND_FEEDBACK: 'settings:get-sound-feedback',
  /** R->M  (enabled: boolean) -> persist. */
  SET_CHUNKED_TRANSCRIPTION: 'settings:chunked-transcription',
  /** R<->M () -> boolean (default true) (handle). */
  GET_CHUNKED_TRANSCRIPTION: 'settings:get-chunked-transcription',
  /** R->M  (mode: 'paste'|'clipboard') -> sessionManager.setOutputMode + persist. */
  SET_OUTPUT_MODE: 'settings:output-mode',
  /** R<->M () -> 'paste'|'clipboard' (default 'paste') (handle). */
  GET_OUTPUT_MODE: 'settings:get-output-mode',
  /** R->M  (deviceId: string) -> persist the chosen microphone input device ('' = system default). */
  SET_INPUT_DEVICE: 'settings:input-device',
  /** R<->M () -> string (deviceId; '' = system default) (handle). */
  GET_INPUT_DEVICE: 'settings:get-input-device',

  // ── AI auto-format ────────────────────────────────────────────────────────────────
  /** R->M  (enabled: boolean) -> persist; sessionManager runs the LLM auto-format pass when on. */
  SET_AUTO_FORMAT: 'settings:auto-format',
  /** R<->M () -> boolean (default false) (handle). */
  GET_AUTO_FORMAT: 'settings:get-auto-format',
  /** R->M  (enabled: boolean) -> sessionManager.setAppAwareFormatting + persist; effective only when autoFormat is on. */
  SET_APP_AWARE_FORMATTING: 'settings:app-aware-formatting',
  /** R<->M () -> boolean (default true) (handle). */
  GET_APP_AWARE_FORMATTING: 'settings:get-app-aware-formatting',

  // ── Instruction mode opt-in ────────────────────────────────────────────────────────────────
  /** R->M  (enabled: boolean) -> keyboardManager.setInstructionEnabled + persist. */
  SET_INSTRUCTION_ENABLED: 'settings:instruction-enabled',
  /** R<->M () -> boolean (default false) (handle). */
  GET_INSTRUCTION_ENABLED: 'settings:get-instruction-enabled',

  // ── Dictionary ────────────────────────────────────────────────────────────────
  /** R<->M (entries: DictionaryEntry[]) -> void (handle) — persist the whole list. */
  SET_DICTIONARY: 'settings:dictionary',
  /** R<->M () -> DictionaryEntry[] (default []) (handle). */
  GET_DICTIONARY: 'settings:get-dictionary',

  // ── Snippets ────────────────────────────────────────────────────────────────
  /** R<->M (snippets: Snippet[]) -> void (handle) — persist the whole list. */
  SET_SNIPPETS: 'settings:snippets',
  /** R<->M () -> Snippet[] (default []) (handle). */
  GET_SNIPPETS: 'settings:get-snippets',

  // ── Key bindings ────────────────────────────────────────────────────────────────
  /** R->M  (key: DictationKey) -> keyboardManager.setDictationKey + persist. */
  SET_DICTATION_KEY: 'settings:dictation-key',
  /** R<->M () -> DictationKey (platform-aware default) (handle). */
  GET_DICTATION_KEY: 'settings:get-dictation-key',
  /** R->M  (binding: DictationBinding) -> keyListener.setDictationBinding + persist. */
  SET_DICTATION_BINDING: 'settings:dictation-binding',
  /** R<->M () -> DictationBinding (migrated from dictationKey) (handle). */
  GET_DICTATION_BINDING: 'settings:get-dictation-binding',
  /** R->M  (key: InstructionKey) -> keyboardManager.setInstructionKey + persist. */
  SET_INSTRUCTION_KEY: 'settings:instruction-key',
  /** R<->M () -> InstructionKey (default 'caps-lock') (handle). */
  GET_INSTRUCTION_KEY: 'settings:get-instruction-key',
  /** R->M  (mode: ActivationMode) -> setActivationMode + persist. */
  SET_ACTIVATION_MODE: 'settings:activation-mode',
  /** R<->M () -> ActivationMode (default 'tap-toggle') (handle). */
  GET_ACTIVATION_MODE: 'settings:get-activation-mode',

  // ── Developer error log ───────────────────────────────────────────────────────────
  /** M->R  (entry: ErrorEntry) — errorLogger.broadcastError to main window Developer view. */
  DEV_ERROR_LOG: 'dev:error-log'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
