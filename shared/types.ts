// ════════════════════════════════════════════════════════════════════════
// shared/types.ts — SINGLE SOURCE OF TRUTH for cross-process domain types.
//
// Imported by BOTH the main process (electron/**) and the renderer
// (renderer/**). MUST stay free of any runtime imports (no electron, no node,
// no React) — types/interfaces only, so it compiles under both tsconfigs.
//
// The IPC channel NAME strings live in shared/ipc.ts (not here). This file
// defines the SHAPES that travel over those channels plus the ElectronAPI
// surface the preload bridge exposes as window.electronAPI.
// ════════════════════════════════════════════════════════════════════════

// ─── Activation / key configuration ──────────────────────────────────────

/** A recording session is one of two logical modes. */
export type SessionMode = 'dictation' | 'instruction'

/** How a hotkey press maps to start/stop. See keyboard.ts state machine. */
export type ActivationMode = 'tap-toggle' | 'push-to-talk' | 'double-tap-push'

/** How a completed result is delivered: pasted at the cursor or left on the clipboard. */
export type OutputMode = 'paste' | 'clipboard'

/**
 * Dashboard appearance preference. DEFAULT 'system'.
 *  - 'light' / 'dark' — pin the theme.
 *  - 'system' — follow prefers-color-scheme, updating live on OS theme change.
 * The renderer resolves 'system' to 'dark'|'light' (via matchMedia) before
 * applying the `data-theme` attribute on <html> (see renderer/theme.ts). The
 * HUD widget window is ALWAYS dark regardless of this setting.
 */
export type Theme = 'light' | 'dark' | 'system'

/**
 * The physical key that triggers DICTATION.
 *  - darwin: 'fn' (Globe) | 'right-option'
 *  - win32:  'right-ctrl' | 'right-alt'
 * The renderer Settings UI shows only the keys valid for the running platform.
 */
export type DictationKey = 'fn' | 'right-option' | 'right-ctrl' | 'right-alt'

/**
 * The physical key that triggers INSTRUCTION (opt-in feature).
 * Caps Lock is the sole binding on both platforms — Right Shift was removed
 * entirely (it collided with system shortcuts and fired during Shift+Enter).
 */
export type InstructionKey = 'caps-lock'

/**
 * A single modifier key usable in a dictation COMBO binding.
 *  - darwin: 'cmd' | 'ctrl' | 'option' | 'shift' | 'fn'
 *  - win32:  resolver maps cmd->Win(Meta), option->Alt; 'fn' is darwin-only.
 * Left/right variants are equivalent (the resolver treats them as the same modifier).
 */
export type ModifierKey = 'cmd' | 'ctrl' | 'option' | 'shift' | 'fn'

/**
 * How dictation is triggered. Either a single physical key (legacy default)
 * or a COMBINATION of >=2 held modifiers (Discord-style PTT, conflict-free).
 *  - { type: 'key';   key }  — the existing single-key behavior.
 *  - { type: 'combo'; mods } — fires while the held modifier set is a superset
 *    of `mods` (exact-or-superset match; MINIMUM 2 modifiers, enforced in UI
 *    AND the resolver — single modifiers are the conflict class that got
 *    Right Shift removed).
 * Migrated at boot from the legacy `dictationKey` store value
 * (=> { type: 'key', key: stored }).
 */
export type DictationBinding =
  | { type: 'key'; key: DictationKey }
  | { type: 'combo'; mods: ModifierKey[] }

/**
 * Per-app formatting profile chosen for the AI Auto-Format pass. Detected from
 * the frontmost application at dictation-session START. 'default' = BASE RULES
 * only (browsers included). See electron/appProfiles.ts for the mapping table.
 */
export type AppProfile = 'email' | 'chat-ai' | 'code-editor' | 'messaging' | 'notes' | 'default'

// ─── Provider identifiers ─────────────────────────────────────────────────

/** Speech-to-text provider ids. Registry keys. 'groq' is the only v1 STT. */
export type STTProviderId = 'groq'

/** LLM provider ids. Registry keys. All are OpenAI-compatible chat APIs.
 *  'groq' doubles as the STT id — one Groq key powers both speech + chat. */
export type LLMProviderId = 'groq' | 'openai' | 'openrouter'

/** Union used by the per-provider key APIs (key storage is keyed by id). */
export type ProviderId = STTProviderId | LLMProviderId

/** STT runtime settings persisted in electron-store. */
export interface STTSettings {
  provider: STTProviderId
  /** Exact model string sent to the provider AND used for usage pricing. */
  model: string
  /**
   * STT language hint. An ISO-639-1 code (e.g. 'en', 'hi', 'gu') forwarded
   * verbatim to the provider, OR 'auto' to let the model detect. Whisper
   * large-v3 supports ~99 languages; the Settings dropdown lists them all.
   * The Groq STT provider skips the hint when 'auto'.
   */
  language: string
}

/** LLM runtime settings persisted in electron-store. */
export interface LLMSettings {
  provider: LLMProviderId
  /** Exact model string sent to the provider AND used for usage pricing. */
  model: string
  /**
   * OpenAI-compatible base URL. Empty string => use the provider's default
   * (openai: https://api.openai.com/v1, openrouter: https://openrouter.ai/api/v1).
   * Set this to point at ANY OpenAI-compatible endpoint.
   */
  baseUrl: string
}

/** One selectable model entry returned by listModels(provider). */
export interface ProviderModel {
  /** Exact model id string (what gets sent to the API + priced). */
  id: string
  /** Human label for the Settings dropdown. */
  label: string
}

// ─── Local app config (replaces the former Cloudflare ServerConfig fetch) ──

/**
 * AppConfig is the local-constant replacement for the reference ServerConfig.
 * Sourced from electron/config.ts (with electron-store overrides). The renderer
 * reads `chunking` at recording start to drive VAD; sessionManager reads
 * `transform.timeout_ms` and `junk_detection`.
 */
export interface AppConfig {
  version: number
  transform: {
    timeout_ms: number
  }
  chunking: {
    enabled: boolean
    min_duration_ms: number
    silence_threshold_rms: number
    silence_duration_ms: number
    hard_cap_ms: number
    vad_poll_interval_ms: number
  }
  junk_detection: {
    max_length: number
    pattern: string
  }
}

// ─── Usage / cost estimation ──────────────────────────────────────────────

/** Estimated cost plus the raw units behind it, for one time window. */
export interface UsageWindow {
  /** Estimated USD spent in this window. */
  cost: number
  inputTokens: number
  outputTokens: number
  /** Seconds of audio transcribed. */
  sttSeconds: number
}

export interface UsageSummary {
  today: UsageWindow
  month: UsageWindow
  allTime: UsageWindow
}

// ─── Session history ──────────────────────────────────────────────────────

export interface Session {
  id: string
  createdAt: number
  flowType: 'dictation' | 'transform' | 'quote' | 'context' | 'instruction'
  dictationTranscript: string | null
  instructionTranscript: string | null
  selectedText: string | null
  selectedTextRole: 'quote' | 'context' | null
  output: string | null
  audioFilePath: string | null
  status: 'done' | 'error'
  errorMessage: string | null
}

// ─── Widget / HUD state machine ───────────────────────────────────────────

export type WidgetState =
  | 'hidden'
  | 'dictation-active'
  | 'instruction-active'
  | 'chained'
  | 'processing'
  | 'output'
  | 'output-fallback'
  | 'error'
  | 'cancelled'
  | 'too-short'

// ─── Dictionary / Snippets (text-replacement pipeline) ────────────────────

/**
 * A spoken-word fix applied to dictation AND instruction transcripts.
 * When `to` is provided: replaces `from` with `to` in the transcript.
 * When `to` is absent: teaches the STT model the correct spelling of `from`
 * (vocabulary hint) without replacing anything.
 */
export interface DictionaryEntry {
  id: string
  from: string
  to?: string
}

/** A spoken trigger expanded inline into longer `content` (e.g. "my linkedin" -> a URL). */
export interface Snippet {
  id: string
  trigger: string
  content: string
}

// ─── Per-provider key API result shapes ───────────────────────────────────

export interface ProviderKeyStatus {
  hasKey: boolean
  masked: string | null
}

export interface SetProviderKeyResult {
  success: boolean
  masked?: string | null
  error?: string
}

export interface TestProviderKeyResult {
  ok: boolean
  error?: string
}

// ─── The complete preload bridge surface (window.electronAPI) ─────────────
//
// Builders: preload.ts MUST implement EXACTLY this interface using the channel
// names from shared/ipc.ts. The renderer consumes ONLY this surface.

export interface ElectronAPI {
  // ── Recording control (main -> renderer) ──
  /**
   * RECORDING_START. Trailing positional args extend the legacy signature
   * (backward-compatible): the HUD may show an app chip from `appName`/`profile`.
   * Both are absent for instruction/chained flows or when detection is
   * unresolved/disabled.
   */
  onRecordingStart: (
    callback: (mode: SessionMode, sessionId?: string, appName?: string, profile?: AppProfile) => void
  ) => void
  onRecordingStop: (callback: () => void) => void

  // ── Audio streaming (renderer -> main) ──
  sendAudioReady: (buffer: ArrayBuffer, duration: number, mode: SessionMode, sessionId?: string) => void
  sendAudioChunk: (buffer: ArrayBuffer, chunkIndex: number, mode: SessionMode, sessionId?: string) => void
  sendAudioFinalChunk: (
    buffer: ArrayBuffer,
    chunkIndex: number,
    totalChunks: number,
    duration: number,
    mode: SessionMode,
    sessionId?: string
  ) => void
  sendAudioDiscarded: (mode: SessionMode, sessionId?: string) => void

  // ── Output (main -> renderer) ──
  onOutputReady: (callback: (text: string, sessionId: string) => void) => void
  onOutputFallback: (callback: (text: string, sessionId: string, message?: string) => void) => void
  onOutputError: (callback: (error: string, sessionId: string) => void) => void

  // ── Sessions / history (renderer <-> main) ──
  getSessions: () => Promise<Session[]>
  retrySession: (sessionId: string) => void
  onRetryStatus: (
    callback: (sessionId: string, status: 'processing' | 'done' | 'error', data?: Partial<Session>) => void
  ) => void

  // ── Widget control (renderer -> main) + state (main -> renderer) ──
  /** HUD Stop button: stop the active recording and process it now. */
  stopSession: () => void
  cancelSession: () => void
  undoCancel: () => void
  onSessionCancelled: (callback: () => void) => void
  onProcessingDiscardHint: (callback: () => void) => void
  onSessionTooShort: (callback: () => void) => void
  /** Provider-fallback notice (e.g. LLM offline -> raw transcript pasted). */
  onEngineNotice: (callback: (reason: string) => void) => void
  /** Widget mount handshake — main gates showHUD() on this. */
  widgetReady: () => void

  // ── Usage (renderer <-> main) ──
  getUsage: () => Promise<UsageSummary>
  resetUsage: () => Promise<UsageSummary>

  // ── Per-provider API keys (renderer <-> main, safeStorage-backed) ──
  getProviderKeyStatus: (provider: ProviderId) => Promise<ProviderKeyStatus>
  setProviderKey: (provider: ProviderId, key: string) => Promise<SetProviderKeyResult>
  testProviderKey: (provider: ProviderId, key: string) => Promise<TestProviderKeyResult>
  clearProviderKey: (provider: ProviderId) => void

  // ── STT / LLM provider settings (renderer <-> main) ──
  getSTTSettings: () => Promise<STTSettings>
  setSTTSettings: (settings: STTSettings) => void
  getLLMSettings: () => Promise<LLMSettings>
  setLLMSettings: (settings: LLMSettings) => void
  /** Static model list a provider advertises for the Settings dropdown. */
  listModels: (provider: ProviderId) => Promise<ProviderModel[]>

  // ── Permissions (macOS; resolve granted/no-op on win32) ──
  getMicPermissionStatus: () => Promise<string>
  requestMicPermission: () => Promise<boolean>
  getAccessibilityStatus: () => Promise<boolean>
  requestAccessibility: () => Promise<boolean>
  openMicSettings: () => void
  openAccessibilitySettings: () => void
  openKeyboardSettings: () => void

  // ── External links ──
  openExternal: (url: string) => void

  // ── Local app config (renderer reads chunking/VAD at record start) ──
  getAppConfig: () => Promise<AppConfig>

  // ── Behaviour / appearance settings (renderer <-> main) ──
  /** Dashboard theme preference (default 'system'). Renderer applies it live; the HUD widget stays dark. */
  getTheme: () => Promise<Theme>
  setTheme: (theme: Theme) => void
  setWidgetPosition: (position: 'center' | 'right') => void
  getWidgetPosition: () => Promise<'center' | 'right'>
  setSoundFeedback: (enabled: boolean) => void
  getSoundFeedback: () => Promise<boolean>
  setChunkedTranscription: (enabled: boolean) => void
  getChunkedTranscription: () => Promise<boolean>
  /** How a completed result is delivered (paste at cursor vs left on clipboard). */
  setOutputMode: (mode: OutputMode) => void
  getOutputMode: () => Promise<OutputMode>
  /** Chosen microphone input device id ('' = system default). */
  setInputDevice: (deviceId: string) => void
  getInputDevice: () => Promise<string>

  // ── AI auto-format (renderer <-> main) ──
  /** Whether the LLM auto-format pass runs on raw dictation transcripts (default false). */
  getAutoFormat: () => Promise<boolean>
  setAutoFormat: (enabled: boolean) => void
  /**
   * Whether the auto-format prompt adapts to the frontmost app (default true).
   * Only has effect when autoFormat is on.
   */
  getAppAwareFormatting: () => Promise<boolean>
  setAppAwareFormatting: (enabled: boolean) => void

  // ── Instruction mode opt-in (renderer <-> main) ──
  /** Whether instruction (edit-selected-text) key events are honored at all (default false). */
  getInstructionEnabled: () => Promise<boolean>
  setInstructionEnabled: (enabled: boolean) => void

  // ── Dictionary (renderer <-> main; whole-list set) ──
  getDictionary: () => Promise<DictionaryEntry[]>
  setDictionary: (entries: DictionaryEntry[]) => Promise<void>

  // ── Snippets (renderer <-> main; whole-list set) ──
  getSnippets: () => Promise<Snippet[]>
  setSnippets: (snippets: Snippet[]) => Promise<void>

  // ── Key bindings (renderer <-> main) ──
  /** Legacy single-key dictation accessor; kept for back-compat. Settings uses the binding API below. */
  setDictationKey: (key: DictationKey) => void
  getDictationKey: () => Promise<DictationKey>
  /**
   * Dictation trigger as a single key OR a >=2-modifier combo. Supersedes the
   * legacy key accessor in Settings. Boot-migrated from the stored dictationKey.
   */
  getDictationBinding: () => Promise<DictationBinding>
  setDictationBinding: (binding: DictationBinding) => void
  setInstructionKey: (key: InstructionKey) => void
  getInstructionKey: () => Promise<InstructionKey>
  setActivationMode: (mode: ActivationMode) => void
  getActivationMode: () => Promise<ActivationMode>

  // ── Cleanup (renderer-local) ──
  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
