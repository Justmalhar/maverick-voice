/**
 * THE single source of truth for IPC channel names.
 * Never inline a channel string anywhere else — main imports IPC.*,
 * the renderer never needs strings at all (preload returns unsubscribers).
 */
export const IPC = {
  // ── Session / recording (M→R unless noted) ────────────────────────────
  RECORDING_START: 'recording:start', // (mode, sessionId, appName?, profile?)
  RECORDING_ACK: 'recording:ack', // R→M (sessionId) — recorder actually rolling
  RECORDING_STOP: 'recording:stop', // (sessionId)
  AUDIO_CHUNK: 'audio:chunk', // R→M (buffer, chunkIndex, mode, sessionId)
  AUDIO_FINAL: 'audio:final', // R→M (buffer, chunkIndex, totalChunks, duration, mode, sessionId)
  AUDIO_DISCARDED: 'audio:discarded', // R→M (mode, sessionId)
  OUTPUT_READY: 'output:ready', // (text, sessionId)
  OUTPUT_FALLBACK: 'output:fallback', // (text, sessionId, message?)
  OUTPUT_ERROR: 'output:error', // (error, sessionId)
  SESSION_CANCELLED: 'session:cancelled',
  SESSION_TOO_SHORT: 'session:too-short',
  PROCESSING_SHOW_DISCARD_HINT: 'processing:show-discard-hint',

  // ── Widget controls (R→M) ─────────────────────────────────────────────
  WIDGET_STOP: 'widget:stop',
  WIDGET_CANCEL: 'widget:cancel',
  WIDGET_UNDO_CANCEL: 'widget:undo-cancel',
  WIDGET_READY: 'widget:ready', // gates showHUD()
  HUD_HIDE: 'hud:hide', // M→R — play exit animation
  HUD_EXIT_DONE: 'hud:exit-done', // R→M — replaces v1's 220ms timer

  // ── History / usage (R↔M) ─────────────────────────────────────────────
  SESSION_LIST: 'session:list',
  SESSION_RETRY: 'session:retry',
  SESSION_RETRY_STATUS: 'session:retry-status', // M→R
  SESSION_DELETE: 'session:delete',
  SESSION_CLEAR_ALL: 'session:clear-all',
  USAGE_GET: 'usage:get',
  USAGE_RESET: 'usage:reset',

  // ── Provider keys / models (R↔M) ──────────────────────────────────────
  KEY_STATUS: 'key:status',
  KEY_SET: 'key:set',
  KEY_TEST: 'key:test',
  KEY_CLEAR: 'key:clear', // R→M
  LIST_MODELS: 'settings:list-models',

  // ── Settings ──────────────────────────────────────────────────────────
  SETTINGS_GET: 'settings:get', // R↔M — ONE batched read
  SETTINGS_CHANGED: 'settings:changed', // M→R (partial) — live push
  SET_WIDGET_POSITION: 'settings:widget-position',
  SET_SOUND_FEEDBACK: 'settings:sound-feedback',
  SET_CHUNKED_TRANSCRIPTION: 'settings:chunked-transcription',
  SET_OUTPUT_MODE: 'settings:output-mode',
  SET_INPUT_DEVICE: 'settings:input-device',
  SET_ACTIVATION_MODE: 'settings:activation-mode',
  SET_AUTO_FORMAT: 'settings:auto-format',
  SET_INSTRUCTION_ENABLED: 'settings:instruction-enabled',
  SET_APP_AWARE_FORMATTING: 'settings:app-aware-formatting',
  SET_PAUSE_MEDIA: 'settings:pause-media',
  SET_DICTATION_BINDING: 'settings:dictation-binding',
  SET_DICTIONARY: 'settings:dictionary', // R↔M (whole-list set)
  SET_REPLACEMENTS: 'settings:replacements', // R↔M (whole-list set)
  SET_SNIPPETS: 'settings:snippets', // R↔M (whole-list set)
  SET_RULES: 'settings:rules', // R↔M (whole-object set)
  STT_SETTINGS_SET: 'settings:set-stt',
  LLM_SETTINGS_SET: 'settings:set-llm',

  // ── Theme ─────────────────────────────────────────────────────────────
  THEME_GET: 'theme:get',
  THEME_SET: 'theme:set',

  // ── Permissions / capability ──────────────────────────────────────────
  PERM_PREFLIGHT: 'permissions:preflight', // R↔M → PermissionsReport
  PERM_OPEN_PANE: 'permissions:open-pane', // R→M (pane)
  PERM_REQUEST_MIC: 'permissions:request-mic', // R↔M → boolean
  KEY_CAPABILITY: 'keys:capability', // R↔M → KeyCapability

  // ── Misc ──────────────────────────────────────────────────────────────
  CONFIG_GET: 'config:get',
  OPEN_EXTERNAL: 'open-external',
  DEV_ERROR_LOG: 'dev:error-log' // M→R
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
