/**
 * THE single source of truth for every cross-process shape,
 * including the ElectronAPI surface exposed by preload.
 * Main and renderer both import from here; nothing is redefined locally.
 */

// ── Core session shapes ──────────────────────────────────────────────────

export type SessionMode = 'dictation' | 'instruction'

export type FlowType = 'dictation' | 'transform' | 'quote' | 'context' | 'instruction'

export interface Session {
  id: string
  createdAt: number
  flowType: FlowType
  dictationTranscript?: string
  instructionTranscript?: string
  selectedText?: string
  selectedTextRole?: 'quote' | 'context'
  output?: string
  audioRef?: string
  status: 'done' | 'error'
  errorMessage?: string
}

export type RetryStatus = 'processing' | 'done' | 'error'

export type WidgetState =
  | 'hidden'
  | 'recording'
  | 'processing'
  | 'output'
  | 'fallback'
  | 'error'
  | 'too-short'
  | 'cancelled'

// ── Keys / activation ────────────────────────────────────────────────────

export type DictationKey = 'fn' | 'right-option' | 'right-ctrl' | 'right-alt'
export type InstructionKey = 'caps-lock'
export type ModifierKey = 'fn' | 'shift' | 'ctrl' | 'option' | 'cmd'
export type DictationBinding =
  | { type: 'key'; key: DictationKey }
  | { type: 'combo'; mods: ModifierKey[] }
export type ActivationMode = 'tap-toggle' | 'push-to-talk' | 'double-tap-push'

export interface KeyCapability {
  fnAvailable: boolean
  globeConflict: boolean
  defaultBinding: DictationBinding
}

// ── Providers ────────────────────────────────────────────────────────────

export type STTProviderId = 'deepgram' | 'openai' | 'groq' | 'local'
export type LLMProviderId = 'openai' | 'groq' | 'openrouter' | 'custom'
// 'openai' and 'groq' appear in both — ONE stored key serves both roles.
export type ProviderId = STTProviderId | LLMProviderId

/** Disambiguates LIST_MODELS for ids that exist in both registries. */
export type ProviderKind = 'stt' | 'llm'

export interface ProviderModel {
  id: string
  label: string
}

export interface STTSettings {
  provider: STTProviderId
  model: string
  language: string // 'auto' omits the hint
  baseUrl: string // '' = provider default; used by the Local server provider
}

export interface LLMSettings {
  provider: LLMProviderId
  model: string
  baseUrl: string // '' = provider default; any OpenAI-compatible endpoint
}

export interface ProviderKeyStatus {
  provider: ProviderId
  hasKey: boolean
  maskedKey: string | null
}

export interface SetProviderKeyResult {
  ok: boolean
  error?: string
}

export interface TestProviderKeyResult {
  ok: boolean
  error?: string
}

// ── Text pipeline ────────────────────────────────────────────────────────

/** Vocabulary word — biases STT toward this spelling; never rewrites text. */
export interface DictionaryWord {
  id: string
  word: string
}

/** from→to text replacement applied to transcripts after STT. */
export interface ReplacementEntry {
  id: string
  from: string
  to: string
}

export interface Snippet {
  id: string
  trigger: string
  content: string
}

/** User-authored always-on rule injected into LLM formatting prompts. */
export interface CustomRule {
  id: string
  name: string
  instruction: string
  enabled: boolean
}

/** Always-on formatting rules (built-in toggles + custom instructions). */
export interface RulesSettings {
  fixGrammar: boolean
  removeFillers: boolean
  smartPunctuation: boolean
  professionalTone: boolean
  custom: CustomRule[]
}

export type AppProfile =
  | 'default'
  | 'email'
  | 'chat-ai'
  | 'code-editor'
  | 'messaging'
  | 'notes'

// ── Settings / theme ─────────────────────────────────────────────────────

export type ThemeSetting = 'system' | 'light' | 'dark'
export type WidgetPosition = 'center' | 'right'
export type OutputMode = 'paste' | 'clipboard'

/** The batched settings snapshot the renderer reads once (SETTINGS_GET). */
export interface RendererSettings {
  theme: ThemeSetting
  widgetPosition: WidgetPosition
  soundFeedback: boolean
  chunkedTranscription: boolean
  outputMode: OutputMode
  inputDeviceId: string
  dictationBinding: DictationBinding
  instructionKey: InstructionKey
  activationMode: ActivationMode
  instructionEnabled: boolean
  autoFormat: boolean
  appAwareFormatting: boolean
  /** Pause system media playback while dictating; resume what we paused. */
  pauseMediaDuringDictation: boolean
  dictionary: DictionaryWord[]
  replacements: ReplacementEntry[]
  snippets: Snippet[]
  rules: RulesSettings
  sttSettings: STTSettings
  llmSettings: LLMSettings
}

// ── Usage ────────────────────────────────────────────────────────────────

export interface UsageWindow {
  sttSeconds: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  byModel: Record<string, { costUsd: number; sttSeconds?: number; inputTokens?: number; outputTokens?: number }>
}

export interface UsageSummary {
  today: UsageWindow
  month: UsageWindow
  allTime: UsageWindow
}

// ── Permissions ──────────────────────────────────────────────────────────

export type PermissionPane = 'mic' | 'accessibility' | 'input-monitoring' | 'automation' | 'keyboard'

export interface PermissionsReport {
  mic: 'granted' | 'denied' | 'not-determined'
  accessibility: boolean // AXIsProcessTrusted (darwin; true elsewhere)
  inputMonitoring: boolean // helper HEALTH (darwin; true elsewhere)
  automation: 'granted' | 'denied' | 'unknown'
  listenerAlive: boolean // listener spawned AND receiving events
  linux?: {
    sessionType: 'x11' | 'wayland' | 'unknown'
    xdotool: boolean
    secretService: boolean
  }
}

// ── App config (main → renderer, read-only) ──────────────────────────────

export interface AppConfig {
  version: string
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

// ── Errors ───────────────────────────────────────────────────────────────

export interface ErrorEntry {
  source: string
  message: string
  timestamp: string
}

// ── The preload bridge surface ───────────────────────────────────────────

/** Every subscription returns its unsubscriber — call it in effect cleanup. */
export type Unsubscribe = () => void

export interface ElectronAPI {
  // Session / recording (widget side)
  onRecordingStart(
    cb: (mode: SessionMode, sessionId: string, appName?: string, profile?: AppProfile) => void
  ): Unsubscribe
  onRecordingStop(cb: (sessionId: string) => void): Unsubscribe
  recordingAck(sessionId: string): void
  sendAudioChunk(buffer: ArrayBuffer, chunkIndex: number, mode: SessionMode, sessionId: string): void
  sendAudioFinal(
    buffer: ArrayBuffer,
    chunkIndex: number,
    totalChunks: number,
    duration: number,
    mode: SessionMode,
    sessionId: string
  ): void
  sendAudioDiscarded(mode: SessionMode, sessionId: string): void
  onOutputReady(cb: (text: string, sessionId: string) => void): Unsubscribe
  onOutputFallback(cb: (text: string, sessionId: string, message?: string) => void): Unsubscribe
  onOutputError(cb: (error: string, sessionId: string) => void): Unsubscribe
  onSessionCancelled(cb: () => void): Unsubscribe
  onSessionTooShort(cb: () => void): Unsubscribe
  onProcessingDiscardHint(cb: () => void): Unsubscribe
  widgetStop(): void
  widgetCancel(): void
  widgetUndoCancel(): void
  widgetReady(): void
  onHudHide(cb: () => void): Unsubscribe
  hudExitDone(): void

  // History / usage
  getSessions(): Promise<Session[]>
  retrySession(sessionId: string): Promise<void>
  onRetryStatus(cb: (sessionId: string, status: RetryStatus, data?: Partial<Session>) => void): Unsubscribe
  deleteSession(sessionId: string): Promise<void>
  clearAllSessions(): Promise<void>
  getUsage(): Promise<UsageSummary>
  resetUsage(): Promise<UsageSummary>

  // Provider keys / models
  getProviderKeyStatus(provider: ProviderId): Promise<ProviderKeyStatus>
  setProviderKey(provider: ProviderId, key: string): Promise<SetProviderKeyResult>
  testProviderKey(provider: ProviderId, key: string): Promise<TestProviderKeyResult>
  clearProviderKey(provider: ProviderId): void
  listModels(provider: ProviderId, kind: ProviderKind): Promise<ProviderModel[]>

  // Settings
  getSettings(): Promise<RendererSettings>
  onSettingsChanged(cb: (partial: Partial<RendererSettings>) => void): Unsubscribe
  setWidgetPosition(position: WidgetPosition): void
  setSoundFeedback(enabled: boolean): void
  setChunkedTranscription(enabled: boolean): void
  setOutputMode(mode: OutputMode): void
  setInputDevice(deviceId: string): void
  setActivationMode(mode: ActivationMode): void
  setAutoFormat(enabled: boolean): void
  setInstructionEnabled(enabled: boolean): void
  setAppAwareFormatting(enabled: boolean): void
  setPauseMediaDuringDictation(enabled: boolean): void
  setDictationBinding(binding: DictationBinding): void
  setDictionary(words: DictionaryWord[]): Promise<void>
  setReplacements(entries: ReplacementEntry[]): Promise<void>
  setSnippets(snippets: Snippet[]): Promise<void>
  setRules(rules: RulesSettings): Promise<void>

  // Logging (renderer → daily log file; message only, never transcript text)
  writeLog(level: 'log' | 'warn' | 'error', message: string): void
  setSTTSettings(settings: STTSettings): void
  setLLMSettings(settings: LLMSettings): void

  // Theme
  getTheme(): Promise<ThemeSetting>
  setTheme(theme: ThemeSetting): void

  // Permissions / capability
  permissionsPreflight(): Promise<PermissionsReport>
  openPermissionPane(pane: PermissionPane): void
  requestMicPermission(): Promise<boolean>
  getKeyCapability(): Promise<KeyCapability>

  // Misc
  getAppConfig(): Promise<AppConfig>
  openExternal(url: string): void
  onDevErrorLog(cb: (entry: ErrorEntry) => void): Unsubscribe
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
