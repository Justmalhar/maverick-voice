# Maverick Voice — INTERFACES.md (THE CONTRACT)

Authoritative module contract for all parallel builders. Every module below has:
exact path, exact exports with TypeScript signatures, who imports it, the IPC
channels it owns, and behavioral notes. **Conform exactly.** If two modules
disagree, this file wins. Channel name strings live ONLY in `shared/ipc.ts`
(`IPC.*`) — never inline. Cross-process shapes live ONLY in `shared/types.ts`.

## Global conventions (all builders)

- **Idioms:** EventEmitter managers, singleton exports (`export const fooManager = new FooManager()`), `console.log('[module] ...')` prefixes. Match the reference verbatim where the reference is kept.
- **Platform branch:** `process.platform === 'darwin'` vs `'win32'`. macOS permission/window/tray specifics must have win32-safe fallbacks (granted/no-op).
- **EPIPE guards:** `main.ts` keeps the `process.stdout`/`process.stderr` EPIPE swallow guards at top of file (cross-platform safe).
- **Imports:** main-process modules may import `shared/types.ts` + `shared/ipc.ts`. Renderer imports `shared/types.ts` only (via `window.electronAPI`); it must NOT import `shared/ipc.ts` or any `electron/**`.
- **No speculative abstraction.** Strip everything the spec strips: local whisper.cpp/faster-whisper, localLLM/llama, cartesia/sarvam/dual-whisper, Cloudflare server-config fetch, auth-token/deep-link, quota, auto-update, feature flags. Do NOT create `featureFlags.ts` or `autoUpdater.ts`.

---

## SHARED (already written by architect — do not modify, import only)

- `shared/types.ts` — all cross-process types incl. `ElectronAPI`, `Session`, `WidgetState`, `UsageSummary`/`UsageWindow`, `AppConfig`, `SessionMode`, `ActivationMode`, `DictationKey`, `InstructionKey`, `STTProviderId`/`LLMProviderId`/`ProviderId`, `STTSettings`, `LLMSettings`, `ProviderModel`, `ProviderKeyStatus`/`SetProviderKeyResult`/`TestProviderKeyResult`.
- `shared/ipc.ts` — `export const IPC = { ... } as const` and `type IpcChannel`. Every channel grouped with direction + payload.
- `electron/preload.ts` — full contextBridge implementation of `ElectronAPI`. Done.
- `electron/providers/types.ts` — `TranscriptionProvider`, `LLMProvider`, `TranscribeOptions`/`TranscribeResult`, `CompleteOptions`/`CompleteResult`, `KeyTestResult`, `ProviderRegistry`, `NoApiKeyError`. Keys are injected by callers — providers never read keyStore.
- `renderer/styles/tokens.css` — design tokens, glass materials (`.mv-glass-widget`, `.mv-glass-card`), 3D buttons (`.btn-glass`, `.btn-glass--primary`, `.kbd-3d`), all keyframes (incl. `slide-in-up`). Imported first by `renderer/styles.css`.

---

# MAIN-PROCESS MODULES

## `electron/config.ts`

**Owner:** config builder. **Imports:** `shared/types.ts` (`AppConfig`).
**Imported by:** `main.ts`, `sessionManager.ts`, `usageTracker.ts`, all provider files, `keyboard.ts` (chain window).

```ts
export const APP_CONFIG: AppConfig // version, transform.timeout_ms:15000,
  // chunking{enabled:true,min_duration_ms:30000,silence_threshold_rms:0.015,
  //   silence_duration_ms:400,hard_cap_ms:45000,vad_poll_interval_ms:100},
  // junk_detection{max_length:2,pattern:'^[.\\s,!?;:]*$'}

export const REQUEST_TIMEOUT_MS: number          // 15000 (single provider call)

export interface ModelPricing { perAudioHour?: number; perMInputTokens?: number; perMOutputTokens?: number }

// Provider-scoped pricing. Keyed by EXACT model string each provider records.
// A model absent here contributes $0. Hardcoded — verify vs provider pricing pages.
export const STT_PRICING: Record<string, ModelPricing>  // { 'whisper-large-v3-turbo': { perAudioHour: 0.04 } }
export const LLM_PRICING: Record<string, ModelPricing>  // OpenAI + OpenRouter 2026 rates, e.g.
  // 'gpt-4o-mini': { perMInputTokens: 0.15, perMOutputTokens: 0.60 },
  // 'gpt-4o':      { perMInputTokens: 2.50, perMOutputTokens: 10.00 },
  // 'openai/gpt-4o-mini': { perMInputTokens: 0.15, perMOutputTokens: 0.60 }, // openrouter slug
  // (set sensible 2026 values; usageTracker resolves by model string)

// Convenience merged view for usageTracker.
export const PRICING: Record<string, ModelPricing> // { ...STT_PRICING, ...LLM_PRICING }
```

**Notes:** This is the local-constant replacement for the reference Cloudflare `ServerConfig`. KEEP the "pricing is hardcoded and drifts" warning comment. STRIP `STT_CLOUD_TIMEOUT_MS` and `LOCAL_STT_IDLE_SHUTDOWN_MS` (local fallback removed). Do NOT put Groq chat config here — LLM endpoints live in the provider files. `main.ts` may layer electron-store overrides on top of `APP_CONFIG` when answering `IPC.CONFIG_GET`, but the defaults live here.

---

## `electron/keyStore.ts`

**Owner:** keyStore builder. **Imports:** `electron` (`app`, `safeStorage`), `node:path`, `node:fs`, `shared/types.ts` (`ProviderId`).
**Imported by:** `main.ts` (key IPC handlers), `sessionManager.ts` (to inject keys into provider calls).

```ts
export function getApiKey(provider: ProviderId): string | null
export function hasApiKey(provider: ProviderId): boolean
export function setApiKey(provider: ProviderId, key: string): void // empty => clears; throws if !safeStorage.isEncryptionAvailable()
export function clearApiKey(provider: ProviderId): void
export function getMaskedKey(provider: ProviderId): string | null  // e.g. 'gsk_••••1234' / 'sk-••••1234'
```

**Notes:** Per-provider files at `userData/${provider}-key.enc` (`groq-key.enc`, `openai-key.enc`, `openrouter-key.enc`). Cache is a `Map<ProviderId, string|null>` with per-provider load-once. KEEP `safeStorage.encryptString/decryptString`, the `isEncryptionAvailable()` guard, `[keyStore]` log prefixes. Mask prefix: detect `gsk_`/`sk-or-`/`sk-`, else slice(0,4). **.env dev seed:** when no stored key, fall back to `process.env.GROQ_API_KEY` (groq) / `OPENAI_API_KEY` (openai) / `OPENROUTER_API_KEY` (openrouter), read-only, never written. `setApiKey` trims and primes cache to avoid a re-read. Works on macOS (Keychain) + Windows (DPAPI), no platform branch.

---

## `electron/providers/registry.ts`

**Owner:** providers builder. **Imports:** `providers/types.ts`, `providers/stt/groq.ts`, `providers/llm/openai.ts`, `providers/llm/openrouter.ts`, `shared/types.ts`.
**Imported by:** `sessionManager.ts`, `main.ts` (`listModels`, key-test routing).

```ts
export const registry: ProviderRegistry
export function getTranscriptionProvider(id: STTProviderId): TranscriptionProvider
export function getLLMProvider(id: LLMProviderId): LLMProvider
export function listTranscriptionProviders(): TranscriptionProvider[]
export function listLLMProviders(): LLMProvider[]
```

**Notes:** Internal `Map<id, provider>` populated by registering `groqProvider`, `openaiProvider`, `openrouterProvider`. **Adding a provider = one new file + one `.set(...)` line here.** `get*` throws a clear error on unknown id. No IPC. No keys (callers inject).

---

## `electron/providers/stt/groq.ts`

**Owner:** providers builder. **Imports:** `undici` (`Agent`, `fetch`), `providers/types.ts`, `config.ts` (`REQUEST_TIMEOUT_MS`), `usageTracker.ts` (`recordSttUsage`).
**Imported by:** `providers/registry.ts`.

```ts
export const groqProvider: TranscriptionProvider
// id:'groq', label:'Groq', defaultModel:'whisper-large-v3-turbo',
// models:[{id:'whisper-large-v3-turbo',label:'Whisper Large v3 Turbo'},
//         {id:'whisper-large-v3',label:'Whisper Large v3'}]
```

**Notes:** Endpoint `https://api.groq.com/openai/v1/audio/transcriptions`. Multipart: file Blob type `audio/webm` filename `audio.webm`, `model`, `temperature:'0'`, `response_format:'verbose_json'`, `language` only if provided (NOT 'auto'). **DO NOT send Whisper `prompt`** (parrots back on silence — keep the comment). Read billed `duration` from verbose_json → `recordSttUsage(model, duration)` then return `{text, durationSeconds:duration}`. KEEP the undici keep-alive `Agent` (keepAliveTimeout/MaxTimeout 120000, connections:4, pipelining:1), the `withTimeout(signal)` combining caller signal + `REQUEST_TIMEOUT_MS`, the `[groq:stt]` latency/char-count log, `as any` dispatcher cast, error-body `.substring(0,200)`. `testKey(key)` → GET `https://api.groq.com/openai/v1/models` → `{ok}`. Throw `NoApiKeyError('groq')` if `key` empty. AbortError must re-throw.

---

## `electron/providers/llm/openai.ts`

**Owner:** providers builder. **Imports:** `undici`, `providers/types.ts`, `config.ts`, `usageTracker.ts` (`recordLlmUsage`).
**Imported by:** `providers/registry.ts`.

```ts
export const openaiProvider: LLMProvider
// id:'openai', label:'OpenAI', defaultBaseUrl:'https://api.openai.com/v1',
// defaultModel:'gpt-4o-mini',
// models:[{id:'gpt-4o-mini',label:'GPT-4o mini'},{id:'gpt-4o',label:'GPT-4o'},
//         {id:'gpt-4.1-mini',label:'GPT-4.1 mini'}]
```

**Notes:** POST `{baseUrl||defaultBaseUrl}/chat/completions`, `Authorization: Bearer {key}`. Body `{ model, messages:[{role:'system',content:system},{role:'user',content:user}], temperature, max_tokens:maxTokens }`. Parse `choices[0].message.content` → `text`; `usage.prompt_tokens`/`usage.completion_tokens` → `recordLlmUsage(model, in, out)` then return `{text, usage:{inputTokens,outputTokens}}`. `timeoutMs` from `CompleteOptions` (default `REQUEST_TIMEOUT_MS`). `testKey(key, baseUrl?)` → GET `{baseUrl||default}/models`. Throw `NoApiKeyError('openai')` on empty key. `[openai:chat]` log prefix. AbortError re-throws. This body shape is the canonical OpenAI-compatible template (salvaged from reference `groqChat`/`localLLM.chat`).

---

## `electron/providers/llm/openrouter.ts`

**Owner:** providers builder. **Imports:** same as openai.ts.
**Imported by:** `providers/registry.ts`.

```ts
export const openrouterProvider: LLMProvider
// id:'openrouter', label:'OpenRouter', defaultBaseUrl:'https://openrouter.ai/api/v1',
// defaultModel:'openai/gpt-4o-mini',
// models:[{id:'openai/gpt-4o-mini',label:'OpenAI GPT-4o mini'},
//         {id:'anthropic/claude-3.5-sonnet',label:'Claude 3.5 Sonnet'},
//         {id:'meta-llama/llama-3.3-70b-instruct',label:'Llama 3.3 70B'}]
```

**Notes:** Identical request/response shape to openai.ts (OpenAI-compatible). Additionally send `HTTP-Referer: https://maverickvoice.app` and `X-Title: Maverick Voice` headers (OpenRouter convention; harmless). `[openrouter:chat]` log prefix. Same usage recording, same `NoApiKeyError('openrouter')`, same AbortError re-throw.

---

## `electron/prompts.ts`

**Owner:** prompts builder. **Imports:** none (pure strings).
**Imported by:** `sessionManager.ts` (assembles messages before calling `LLMProvider.complete`).

```ts
export interface AssembledMessages { system: string; user: string; temperature: number }
export type FlowType = 'dictation' | 'transform' | 'quote' | 'context' | 'instruction'
export function assembleTransformMessages(
  flowType: FlowType,
  content: string | null,
  context: string | null,
  instruction: string | null,
  chunked?: boolean
): AssembledMessages
```

**Notes:** Port the 4 in-scope system prompts VERBATIM (DICTATION, CONTEXT, TRANSFORM, INSTRUCTION) + a FALLBACK. **Return `{system, user, temperature}`** (NOT a messages array) — `LLMProvider.complete` takes `system` + `user` separately. Temperature rule: dictation `0.1`; instruction-or-has-instruction `0.3`; else `0.1`. User assembly per flow: dictation wraps `TRANSCRIPT: <<< ... >>>` (chunked appends merge instruction); context `[SELECTED TEXT]:..\n\n[COMMAND]:..`; transform `[DICTATED CONTENT]:..[COMMAND]:..` (+ optional `[REFERENCE TEXT]:`); instruction `[INSTRUCTION]:..`; default FALLBACK. STRIP Hinglish + Quick-Chat prompts (out of product spec). These prompts encode "text-transform engine that NEVER answers, never wraps in quotes". `'quote'` flow has no LLM (handled in sessionManager) so it falls to FALLBACK if ever reached.

---

## `electron/errorUtils.ts`

**Owner:** errors builder. **Imports:** none. **Imported by:** `sessionManager.ts`.

```ts
export function simplifyError(rawError: string): string
```

**Notes:** Pure keyword-match, first-match-wins (PRESERVE ORDER). RETUNE copy for BYO-key (no auth/sign-in): auth/token/401 → **'Check your API key in Settings.'**; rate limit/429/usage limit → 'Usage limit reached. Check your provider dashboard.'; transcription/whisper/no audio → "Couldn't process audio. Try again."; fetch/network/econnrefused/timeout/enotfound/socket → 'Connection error. Check your internet.'; api error/500/502/503 → 'Service temporarily unavailable.'; not configured/no api key → **'Add your API key in Settings.'**; mic/microphone/notallowederror/permission → 'Mic error. Check permissions.'; default → 'Something went wrong. Try again.'

---

## `electron/errorLogger.ts`

**Owner:** errors builder. **Imports:** `electron` (`BrowserWindow` type), `shared/ipc.ts`.
**Imported by:** `main.ts` (init + getRecentErrors handler if a Developer view is built), `sessionManager.ts` (broadcastError).

```ts
export interface ErrorEntry { source: string; message: string; timestamp: string }
export function initErrorLogger(getMainWindow: () => BrowserWindow | null): void
export function broadcastError(source: string, message: string): void
export function getRecentErrors(): ErrorEntry[]
```

**Notes:** Port verbatim. In-memory ring `MAX_ERRORS=50`, `[error-log]` console prefix, sends each entry to main window via `IPC.DEV_ERROR_LOG`. `sessionManager` calls `broadcastError('session', msg)` and `broadcastError('provider', msg)` (the old 'pipeline' source is renamed 'provider'). `main.ts` calls `initErrorLogger(() => getMainWindow())` at startup.

---

## `electron/db.ts`

**Owner:** db builder. **Imports:** `better-sqlite3`, `electron` (`app`), `node:path`. **Imported by:** `main.ts`, `usageTracker.ts`.

```ts
export interface DBSession { id; created_at:number; flow_type; dictation_transcript:string|null; instruction_transcript:string|null; selected_text:string|null; selected_text_role:string|null; output:string|null; audio_file_path:string|null; status; error_message:string|null }
export interface UsageRow { date:string; model:string; stt_seconds:number; input_tokens:number; output_tokens:number }
export function initDB(): void
export function addUsage(date: string, model: string, delta: { sttSeconds?: number; inputTokens?: number; outputTokens?: number }): void
export function getUsageRows(): UsageRow[]
export function clearUsage(): void
export function saveSession(session: { sessionId; flowType; dictationTranscript; instructionTranscript; selectedText; selectedTextRole; output; audioFilePath?; status; errorMessage; createdAt }): void
export function getSessions(limit?: number): Record<string, unknown>[] // default 50; snake->camel mapped
export function getSession(id: string): DBSession | undefined
export function updateSessionResult(sessionId: string, updates: { dictationTranscript; output; status; errorMessage; flowType? }): void
export function deleteSession(id: string): void
export function clearAllSessions(): void
export function closeDB(): void
```

**Notes:** Port verbatim. **CHANGE db filename `unmute.db` → `maverickvoice.db`.** WAL mode. Two tables: `sessions` (PK id TEXT, idx on created_at DESC) + `usage_daily` (composite PK (date,model), REAL stt_seconds, INTEGER input/output tokens). `cleanupSessions()` deletes created_at < now-24h AND caps to newest 100 rows; runs on initDB + after each saveSession. `usage_daily` NEVER cleaned. `addUsage` stores RAW units (UPSERT additive ON CONFLICT(date,model)); dollars computed at read time in usageTracker. `getSessions` maps snake_case→camelCase to match `Session`. Cross-platform (prebuilt darwin-arm64 + win-x64).

---

## `electron/usageTracker.ts`

**Owner:** usage builder. **Imports:** `db.ts` (`addUsage`,`getUsageRows`,`clearUsage`,`UsageRow`), `config.ts` (`PRICING`, `ModelPricing`), `shared/types.ts` (`UsageSummary`,`UsageWindow`).
**Imported by:** providers (`recordSttUsage`/`recordLlmUsage`), `main.ts` (usage IPC).

```ts
export function recordSttUsage(model: string, seconds: number): void   // ignores non-finite/<=0
export function recordLlmUsage(model: string, inputTokens: number, outputTokens: number): void
export function getUsageSummary(): UsageSummary  // today=exact date, month=startsWith 'YYYY-MM', allTime=all
export function resetUsage(): void
```

**Notes:** Port verbatim, swap `GROQ_PRICING` → `PRICING` (config.ts). `rowCost` keys purely on `row.model` — providers MUST record the EXACT model string they sent. STT cost = `seconds/3600 * perAudioHour`; LLM cost = `tokens/1e6 * perMTokens`. `localDateStr` = 'YYYY-MM-DD' local. Every path try/catch (usage logging never breaks the pipeline). `UsageSummary`/`UsageWindow` come from `shared/types.ts` (NOT redefined here).

---

## `electron/audio.ts`

**Owner:** audio builder. **Imports:** `electron` (`app`), `node:fs`, `node:path`. **Imported by:** `sessionManager.ts`, `main.ts` (retry loads audio).

```ts
export function saveAudioFile(sessionId: string, buffer: Buffer): string
export function getAudioFilePath(sessionId: string): string | null
export function loadAudioFile(sessionId: string): Buffer | null
export function deleteAudioFile(sessionId: string): void
export function clearAllAudioFiles(): void
export function saveAudioChunk(sessionId: string, chunkIndex: number, buffer: Buffer, isFinal?: boolean): string
```

**Notes:** Port VERBATIM (cross-platform). Writes to `userData/audio` as `.webm`. `MAX_AUDIO_SESSIONS=5` whole-session pruning grouped by `SESSION_ID_RE` UUID. Chunk filename zero-padded 4 digits (`<id>-chunk-0001.webm` / `<id>-final-chunk-0001.webm`) so lexical sort == numeric. `sessionManager` calls `saveAudioFile(sessionId+'-'+mode)`, `saveAudioFile(sessionId+'-dictation-final')`, `saveAudioChunk(...)`. **Retry naming convention:** `main.ts retrySessionFromAudio` loads `sessionId+'-dictation'` || `sessionId+'-instruction'` — keep this suffix convention.

---

## `electron/ffmpeg.ts`

**Owner:** audio builder. **Imports:** `electron` (`app`), `node:fs`, `node:path`. **Imported by:** any module probing/decoding audio (optional in v1; keep for parity).

```ts
export function getFFmpegPath(): string | null
```

**Notes:** Candidate list: dev `node_modules/ffmpeg-static/<bin>`, packaged `app.asar.unpacked/.../<bin>`, `process.resourcesPath/<bin>`. `<bin>` = `process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'`. **Drop the /usr/local + /opt/homebrew fallbacks on win32.** CRITICAL: skip any candidate whose path contains `app.asar${path.sep}` (existsSync lies inside asar; spawning throws ENOTDIR) — use the `.unpacked` location. `electron-builder` asarUnpacks `ffmpeg-static` (configured in package.json).

---

## `electron/clipboard.ts`

**Owner:** input builder. **Imports:** `electron` (`clipboard`), `node:child_process` (`execFile`), `node:util`. **Imported by:** `sessionManager.ts`.

```ts
export async function captureSelectedText(useClipboardFallback?: boolean): Promise<string | null> // default false
export async function injectOutput(text: string): Promise<void>
export function copyToClipboard(text: string): void
```

**Notes:** `simulateKeyCombo(key,modifier)` branches on platform.
- **darwin:** `execFile('/usr/bin/osascript', ['-e', \`tell application "System Events" to keystroke "${key}" using ${modifier} down\`])`. This is the ONLY reliable path (CGEvent drops silently when packaged — comment it).
- **win32:** clipboard already holds text; simulate paste/copy via `execFile('powershell', ['-NoProfile','-Command', "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"])` (use `^c` for copy). For COPY, send `^c` first, then read clipboard.

`captureSelectedText` sequence (KEEP EXACT): read+save clipboard → write '' → simulate Cmd/Ctrl+C → `sleep(150)` (load-bearing async settle) → read → RESTORE saved clipboard → return null if empty/whitespace; on simulate failure restore + return savedClipboard only when `useClipboardFallback`. `injectOutput`: `clipboard.writeText(text)` FIRST (manual paste works even if auto-paste fails), then simulate Cmd/Ctrl+V, swallow errors. `useClipboardFallback` is TRUE only for instruction mode, FALSE for dictation. `[clipboard]` log prefix. Modifier name: darwin `command`, win32 uses `^` SendKeys prefix.

---

## `electron/keyboard.ts`

**Owner:** input builder. **Imports:** `node:events` (EventEmitter), `shared/types.ts` (`SessionMode`,`ActivationMode`,`DictationKey`,`InstructionKey`), `keyListener.ts` (`KeyEvent` type). **Imported by:** `main.ts` (wires `'keyboard'` events to sessionManager), `keyListener.ts` is its source.

```ts
export type KeyboardEvent =
  | { type: 'session-start'; mode: SessionMode }
  | { type: 'session-stop'; mode: SessionMode }
  | { type: 'chain-start'; mode: SessionMode }
  | { type: 'chain-expired' }
export const keyboardManager: KeyboardManager // EventEmitter singleton; emits 'keyboard'(KeyboardEvent)
// class KeyboardManager:
//   start(): void; stop(): void; resetState(): void
//   setChainWindow(ms: number): void
//   setDictationKey(key: DictationKey): void; getDictationKey(): DictationKey
//   setInstructionKey(key: InstructionKey): void; getInstructionKey(): InstructionKey
//   setActivationMode(mode: ActivationMode): void; getActivationMode(): ActivationMode
//   handleKey(event: KeyEvent): void
```

**Notes:** Port the activation-mode + chaining + debounce state machine VERBATIM (platform-agnostic). Constants `DEBOUNCE_MS=300`, `chainWindowMs=2000`, `DUAL_HOLD_MS=400`, `DUAL_DOUBLE_TAP_MS=400`. Debounce is per-logical-key, gates START only (never STOP). `resetState()` MUST clear EVERY field influencing the next keystroke (including new instruction-key state). `setActivationMode` resets dual state.

**Key vocabulary (CRITICAL — platform-invariant):** `handleKey` consumes `KeyEvent` strings (dashed-lowercase) from `keyListener`. The DICTATION key (whichever the platform/config maps) arrives as `'dictation-down'`/`'dictation-up'` — i.e. **keyListener normalizes the physical dictation key to a logical `dictation-down/up`**, so keyboard.ts is platform-unaware for dictation. INSTRUCTION arrives as `'instruction-down'`/`'instruction-up'`. Handle instruction toggle on **`instruction-down` only** (Right Shift is momentary; trigger on down, ignore up). Caps Lock (macOS option) also normalizes to `instruction-down`/`instruction-up` but keyListener collapses its LED dual-fire into a single logical `instruction-down` (see keyListener notes). `[keyboard]` log prefix. STRIP `authToken` references seen in reference logging.

---

## `electron/keyListener.ts`

**Owner:** input builder (PLATFORM SEAM). **Imports:** `node:events`, `node:child_process` (darwin spawn), `electron` (`app`), `node:fs`, `node:path`, `uiohook-napi` (win32 — `uIOhook`, `UiohookKey`), `shared/types.ts` (`DictationKey`,`InstructionKey`). **Imported by:** `keyboard.ts` source, `main.ts` (start/stop), `sessionManager.ts` (NOT — clipboard.ts owns paste).

```ts
export type KeyEvent = 'dictation-down' | 'dictation-up' | 'instruction-down' | 'instruction-up'
export const keyListener: KeyListener // EventEmitter singleton; emits 'key'(KeyEvent), 'error'(Error)
// class KeyListener:
//   getBinaryPath(): string | null            // darwin globe-listener resolution
//   start(): boolean                            // darwin spawn helper | win32 uIOhook
//   stop(): void
//   isRunning(): boolean
//   setDictationKey(key: DictationKey): void   // remap which physical key => dictation
//   setInstructionKey(key: InstructionKey): void
//   sendCommand(command: 'PASTE' | 'COPY'): Promise<void> // darwin only; reject/no-op win32
```

**Notes:** This is the platform abstraction. **It emits the SAME normalized `KeyEvent` strings on both platforms** so `keyboard.ts` needs zero platform awareness.

- **darwin:** spawn `resources/bin/globe-listener` (binary already in repo). Parse its stdout protocol (verbatim below) and TRANSLATE raw tokens → normalized KeyEvents based on the configured `dictationKey`/`instructionKey`:
  - `FN_DOWN`/`FN_UP` → `dictation-down`/`dictation-up` IFF dictationKey==='fn'
  - `RIGHT_OPTION_DOWN`/`RIGHT_OPTION_UP` → `dictation-down`/`dictation-up` IFF dictationKey==='right-option'
  - `CAPS_DOWN`+`CAPS_UP` → collapse to a SINGLE `instruction-down` per physical press IFF instructionKey==='caps-lock' (LED toggle: both tokens fire for one press; emit one `instruction-down` and synthesize a matching `instruction-up`, OR just emit `instruction-down` and let keyboard.ts ignore up — keyboard.ts triggers on down only, so emit `instruction-down` on the first of the pair).
  - Right Shift on macOS: the shipped globe-listener.swift does NOT emit a right-shift token. For the macOS default `instruction-key='right-shift'`, the macOS path currently has NO native right-shift source. **Resolution:** on darwin, if `instructionKey==='right-shift'`, the helper cannot detect it without a Swift recompile — so on darwin DEFAULT the instruction key to `'caps-lock'` mapping for the native source while still labeling 'right-shift' in UI is WRONG. Instead: keyListener on darwin maps `instructionKey==='right-shift'` to the CAPS_* tokens is also wrong. **Decision for v1:** darwin instruction source = Caps Lock (`CAPS_*`). The Settings/Onboarding UI on darwin offers instruction key = Caps Lock (default on mac) OR Right Shift; if Right Shift is chosen on darwin, keyListener logs a warning that native Right-Shift requires the optional Swift recompile (keyCode 60) and falls back to Caps Lock. On win32, Right Shift works natively via uiohook. (This keeps the shipped binary unchanged per the architect's "protocol identical" note.)
  - KEEP: 3-candidate `getBinaryPath()` (`process.resourcesPath/bin`, `app.getAppPath()/resources/bin`, `__dirname/../../resources/bin`), `fs.chmodSync(0o755)`, manual line-buffer split ("keep last incomplete line"), auto-restart only for `code!==0 && code!==null` with 2s delay + restarting guard, EPIPE swallow, `sendCommand` 500ms timeout + listener cleanup.

- **win32:** `import { uIOhook, UiohookKey } from 'uiohook-napi'`. On `start()`: register `uIOhook.on('keydown', e => ...)` and `'keyup'`, then `uIOhook.start()`. Map `e.keycode` against `UiohookKey` **by NAME** (do NOT use raw numbers):
  | Logical | DictationKey value | uiohook constant |
  |---|---|---|
  | dictation | `'right-ctrl'` | `UiohookKey.CtrlRight` |
  | dictation | `'right-alt'`  | `UiohookKey.AltRight` |
  | instruction (default) | `'right-shift'` | `UiohookKey.ShiftRight` |
  Emit `dictation-down`/`dictation-up`/`instruction-down`/`instruction-up` accordingly. `stop()` calls `uIOhook.stop()`. `sendCommand` rejects/no-ops on win32. `getBinaryPath()` returns null on win32 (harmless).

### globe-listener stdout protocol (VERBATIM — darwin)
One uppercase token per newline-terminated line, stdout unbuffered (`setbuf(stdout,nil)`):
```
FN_DOWN
FN_UP
CAPS_DOWN
CAPS_UP
RIGHT_OPTION_DOWN
RIGHT_OPTION_UP
PASTE_OK        (ack for stdin "PASTE")
COPY_OK         (ack for stdin "COPY")
```
stderr: `PASTE_ERROR:<msg>`, `COPY_ERROR:<msg>`. stdin commands (newline-terminated): `PASTE`, `COPY`. Key codes: kVK_V=9, kVK_C=8; Right Option = keyCode 61; (optional Right Shift = keyCode 60). Caps Lock fires on LED toggle (both DOWN+UP per press). Parse on trimmed exact-string match; `PASTE_OK`/`COPY_OK`/unknown lines ignored by the main parser (handled only inside `sendCommand`).

---

## `electron/windowManager.ts`

**Owner:** windows builder. **Imports:** `electron` (`BrowserWindow`,`screen`,`app`), `node:path`. **Imported by:** `main.ts`, `tray.ts` (getMainWindow), `sessionManager.ts` (`getWidgetWindow`, `showHUD`/`hideHUD`/`setHUDPosition`/`cancelPendingHide`).

```ts
export function createMainWindow(): BrowserWindow
export function showMainWindow(): void
export function getMainWindow(): BrowserWindow | null
export function getWidgetWindow(): BrowserWindow | null   // alias name sessionManager depends on
export function createHUDWindow(): BrowserWindow
export const createWidgetWindow: typeof createHUDWindow   // alias
export function setHUDPosition(position: 'center' | 'right'): void
export function showHUD(): Promise<void>
export function hideHUD(): void
export function cancelPendingHide(): void
export function markHUDReady(): void   // called from IPC.WIDGET_READY handler
```

**Notes:** Port near-verbatim. Main window: 900x640, `minWidth:700`, `minHeight:500`, contextIsolation, preload `../preload/preload.js`, loads `index.html`. HUD: 520x140 frameless transparent always-on-top, loads `index.html#/widget`. **CHANGE `backgroundColor` to pure black (`#000000`).** KEEP the readiness handshake: `hudReadyPromise` resolved by `markHUDReady()`, awaited by `showHUD()`; `resetHUDReady()` rebound on hudWindow `did-start-loading`. KEEP `showHUD`'s **double `cancelPendingHide()`** (before AND after the await). KEEP `hideHUD`'s **220ms** setTimeout (matches `.animate-hud-exit` 200ms + buffer). KEEP `showInactive()` + `setAlwaysOnTop('floating')` + `moveTop()` ordering. `getHUDBounds` uses `screen.getPrimaryDisplay().workArea` (center vs right, 12px right inset, 6px top) + `display-metrics-changed` reposition listener.

**Cross-platform gating (wrap in `process.platform === 'darwin'`):** `type:'panel'`, `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})`, `setFullScreenable(false)`, `titleBarStyle:'hiddenInset'`, `hasShadow:false`. On win32: omit `type:'panel'`; use `titleBarStyle:'hidden'` (or `frame:false`) for main window; transparent frameless HUD still works.

---

## `electron/tray.ts`

**Owner:** windows builder. **Imports:** `electron` (`Tray`,`Menu`,`nativeImage`,`app`), `windowManager.ts` (`showMainWindow`), `node:path`,`node:fs`. **Imported by:** `main.ts`, `sessionManager.ts` (setTrayRecording/setTrayIdle).

```ts
export function createTray(): void
export function setTrayRecording(mode: 'dictation' | 'instruction'): void
export function setTrayIdle(): void
export function getTray(): Tray | null
```

**Notes:** Port the procedural alpha glyph + 8-frame sine pulse (ICON_SIZE=18, FRAME_COUNT=8, SCALE=2), `setTrayRecording` 120ms interval cycling frames, `setTrayIdle` restore. **Ship a Maverick Voice mono `menubar-icon.png`** at `resources/icons/menubar-icon.png`; update `getMenubarSourcePath` candidates. Tooltip `'Maverick Voice'`, menu label `'Open Maverick Voice'` / `'Quit'`. **Cross-platform:** `setTemplateImage(true)` only on darwin (auto tint); on win32 supply a normal white-on-transparent icon (template images render wrong on Windows) — branch on platform for both `setTemplateImage` and asset.

---

## `electron/sessionManager.ts`

**Owner:** sessionManager builder (the core). **Imports:** `node:events`?(no — class with public callbacks), `uuid` (`v4`), `shared/types.ts`, `config.ts` (`APP_CONFIG`,`REQUEST_TIMEOUT_MS`), `providers/registry.ts` (`getTranscriptionProvider`,`getLLMProvider`), `keyStore.ts` (`getApiKey`,`hasApiKey`), `prompts.ts` (`assembleTransformMessages`,`FlowType`), `audio.ts`, `clipboard.ts` (`captureSelectedText`,`injectOutput`,`copyToClipboard`), `windowManager.ts` (`getWidgetWindow`,`showHUD`,`hideHUD`,`cancelPendingHide`), `tray.ts` (`setTrayRecording`,`setTrayIdle`), `errorLogger.ts` (`broadcastError`), `errorUtils.ts` (`simplifyError`), `shared/ipc.ts`.
**Imported by:** `main.ts` (wires IPC + keyboard + callbacks).

```ts
export function cleanTranscript(text: string): string
export const sessionManager: SessionManager
// class SessionManager:
//   get processing(): boolean
//   setOutputMode(mode: 'paste' | 'clipboard'): void
//   setSTTSettings(s: STTSettings): void; getSTTSettings(): STTSettings
//   setLLMSettings(s: LLMSettings): void; getLLMSettings(): LLMSettings
//   startSession(mode: SessionMode): void
//   chainSession(mode: SessionMode): void
//   stopRecording(mode: SessionMode): Promise<void>
//   receiveAudio(buffer: Buffer, duration: number, mode: SessionMode, sessionId?: string): void
//   receiveAudioChunk(buffer: Buffer, chunkIndex: number, mode: SessionMode, sessionId?: string): void
//   receiveAudioFinalChunk(buffer: Buffer, chunkIndex: number, totalChunks: number, duration: number, mode: SessionMode, sessionId?: string): void
//   processSession(): Promise<void>
//   processAndStartNew(mode: SessionMode): Promise<void>
//   discardSession(sessionId?: string): void
//   cancelSession(): void
//   cancelSessionWithUndo(): void
//   undoCancel(): void
//   getCurrentSession(): SessionState | null
//   // public callbacks (main.ts assigns):
//   onSessionComplete: ((s: SessionState) => void) | null
//   onRecordingStarted: (() => void) | null
//   onRecordingStopped: (() => void) | null
//   onSessionEnded: (() => void) | null
//   onSessionRejected: (() => void) | null
```

**Notes:** Port the SessionState machine + `FlowType` + `determineFlowType` + `cleanTranscript` + `WHISPER_SENTINELS_RE` + `stitchChunks` + `isLLMRefusal` + junk guard + undo-cancel (3s) + auto-hide timers + isProcessing lock + AbortController + per-request timeout + foreign/stale-audio guard + two grace polls (no-audio 20×10ms=200ms; instruction-audio 10×50ms=500ms) + parallel chunk transcription + ordered stitch + `<10KB` final-chunk skip + paste/clipboard output branch + all public callbacks.

**Pipeline (SEQUENTIAL ONLY — strip the fast path):** transcribe via `getTranscriptionProvider(stt.provider).transcribe(buffer, {model:stt.model, language: stt.language==='auto'?undefined:stt.language, mimeType:'audio/webm'}, getApiKey(stt.provider)!, signal)`. Pure dictation → `cleanTranscript` only, NEVER hits LLM. transform/context/instruction → `assembleTransformMessages(...)` then `getLLMProvider(llm.provider).complete({model:llm.model, system, user, temperature, maxTokens:APP_CONFIG... (use 4096), baseUrl:llm.baseUrl||undefined, timeoutMs:APP_CONFIG.transform.timeout_ms}, getApiKey(llm.provider)!, signal)`. On LLM empty/refusal/error → fall back to raw transcript, `output:fallback` with `formattingNotice()`. `quote` flow = `'> '+selectedText`, no LLM. Key presence: check `hasApiKey(provider)` before calling; surface `NoApiKeyError` via `simplifyError`.

**GOTCHAS (preserve):** (1) `showHUD()` fires BEFORE `captureSelection` (osascript Cmd+C disrupts macOS window ordering); capture is delayed `setTimeout(...,50)`. (2) `isProcessing=true` BEFORE the grace await. (3) audio can arrive post-cancel — `receiveAudio` checks cancelledSession; `isForeignSessionAudio` lenient (absent sessionId accepted). (4) every `onSessionComplete?.()` in try/catch. (5) `cleanTranscript` strips trailing STT hallucinations ('thank you','thanks for watching','please subscribe'). `setOutputMode` default `'paste'`.

**IPC it drives (via main.ts wiring, sends through `getWidgetWindow().webContents.send`):** `IPC.RECORDING_START/RECORDING_STOP/OUTPUT_READY/OUTPUT_FALLBACK/OUTPUT_ERROR/SESSION_CANCELLED/PROCESSING_SHOW_DISCARD_HINT/SESSION_TOO_SHORT/SESSION_ENGINE_NOTICE`. STRIP `authToken`, `backendProvider`, `pipeline`, `setServerConfig`, quota, local-llm/whisper branches, `getEffectiveSTTProvider` auto-routing.

---

## `electron/main.ts`

**Owner:** main builder (orchestration hub). **Imports:** `electron` (`app`,`ipcMain`,`globalShortcut`,`shell`,`systemPreferences`,`BrowserWindow`), `electron-store`, `shared/ipc.ts`, `shared/types.ts`, `config.ts`, `windowManager.ts`, `tray.ts`, `sessionManager.ts`, `keyboard.ts`, `keyListener.ts`, `db.ts`, `usageTracker.ts`, `errorLogger.ts`, `keyStore.ts`, `audio.ts`, `providers/registry.ts`. **No exports** (entry).

**Boot order (app.whenReady):** `initDB()` → restore settings from electron-store → `createMainWindow()` → `createWidgetWindow()` → `createTray()` → `initErrorLogger(() => getMainWindow())` → setupSessionPersistence → setupIPC → setupKeyboard (try/catch). IPC before keyboard so a key-listener crash doesn't block IPC.

**Settings persistence:** electron-store. Keys: `widgetPosition`('center'), `soundFeedback`(true), `chunkedTranscription`(true), `dictationKey`(platform default: darwin `'fn'`, win32 `'right-ctrl'`), `instructionKey`('right-shift'; darwin may resolve to caps-lock per keyListener notes), `activationMode`('tap-toggle'), `sttSettings`({provider:'groq',model:'whisper-large-v3-turbo',language:'en'}), `llmSettings`({provider:'openai',model:'gpt-4o-mini',baseUrl:''}). On restore, push into sessionManager + keyboardManager + windowManager.

**Keyboard wiring:** `keyListener.start()`; `keyListener` emits `'key'` → `keyboardManager.handleKey`; `keyboardManager.on('keyboard', e => switch)`: `session-start`→`sessionManager.startSession(mode)`; `chain-start`→`chainSession(mode)`; `session-stop`→`stopRecording(mode)`; `chain-expired`→ if `!sessionManager.processing` then `processSession()` (the chain-expired processing guard).

**Escape-owner machine:** `let escapeOwner:'none'|'dictation'='none'`. `onRecordingStarted`→register Escape via `globalShortcut` (cancelSessionWithUndo while recording vs cancelSession while processing). `onRecordingStopped` does NOT unregister (Esc works through processing). `onSessionEnded`→unregister + `keyboardManager.resetState()`. `onSessionRejected`→`keyboardManager.resetState()` only (leave Esc). `onSessionComplete`→`db.saveSession(...)`.

**retrySessionFromAudio(sessionId):** dedupe `Set<string>`, load audio by `sessionId+'-dictation'` || `+'-instruction'`, emit `IPC.SESSION_RETRY_STATUS` processing/done/error.

**IPC handlers to register (every channel in shared/ipc.ts that is R->M or R<->M):**
`AUDIO_READY/AUDIO_CHUNK/AUDIO_FINAL_CHUNK/AUDIO_DISCARDED` → sessionManager.receive*; `WIDGET_CANCEL`→cancelSession; `WIDGET_UNDO_CANCEL`→undoCancel; `WIDGET_READY`→`markHUDReady()`; `SESSION_RETRY`→retrySessionFromAudio; `SESSION_LIST`→db.getSessions; `USAGE_GET`→getUsageSummary; `USAGE_RESET`→resetUsage+getUsageSummary; `KEY_STATUS/KEY_SET/KEY_TEST/KEY_CLEAR` → keyStore + provider.testKey routing; `STT_SETTINGS_GET/SET`,`LLM_SETTINGS_GET/SET`→store+sessionManager; `LIST_MODELS`→registry provider.models; `CONFIG_GET`→APP_CONFIG (+store overrides); `SET/GET_WIDGET_POSITION`→setHUDPosition+store; `SET/GET_SOUND_FEEDBACK`,`SET/GET_CHUNKED_TRANSCRIPTION`→store; `SET/GET_DICTATION_KEY`→keyboardManager+keyListener+store; `SET/GET_INSTRUCTION_KEY`→keyboardManager+keyListener+store; `SET/GET_ACTIVATION_MODE`→keyboardManager+store; `OPEN_EXTERNAL`→shell (http/https only); permission handlers (`PERM_*`) — darwin uses `systemPreferences`, win32 returns 'granted'/true/no-op.

**before-quit:** `globalShortcut.unregisterAll()` + `keyListener.stop()` + `closeDB()`. `window-all-closed`: only `app.quit()` on non-darwin. KEEP EPIPE guards at top. STRIP: server-config refresh loop, quota, `auth:token`/`setAsDefaultProtocolClient`/`open-url`, isDevVerified gates, all whisper/faster-whisper/local-llm handlers, features.localModels, updater handlers.

---

# RENDERER MODULES

All renderer files import types from `shared/types.ts` and call `window.electronAPI` only. Styling uses classes from `renderer/styles/tokens.css` (imported by `styles.css`). Monochrome black-glass everywhere — NO cream/ink/red/gold.

## `renderer/index.html`
Title `Maverick Voice`. `#root` + `<script type="module" src="/main.tsx">`. STRIP Google Fonts links (native fonts only).

## `renderer/styles.css`
`@import "./styles/tokens.css";` then `@import "tailwindcss";` then a Tailwind `@theme` block mirroring the `--mv-*` tokens for utility generation, then component classes (the glass pill, processing/output states). Re-skin the reference dashboard entirely in black glass.

## `renderer/main.tsx`
Hash route: `#/widget` → `WidgetApp`, else `App`. `createRoot(#root).render(<StrictMode><RootApp/></StrictMode>)`. Import `./styles.css`.

## `renderer/app/App.tsx`
Default export `App()`. View machine loading→onboarding→main, gated by `localStorage['maverickvoice_onboarding_complete']`. Sidebar tabs: History / Features / Settings / Privacy (tab key `voice`→label "Features"). STRIP auto-update banner. Brand: "Maverick Voice". Pro-tip uses dynamic dictation key from `getDictationKey()`; instruction default Right Shift.

## `renderer/app/Settings.tsx`
Default `Settings({ onDictationKeyChange? })`. Sections: Permissions (mic + accessibility live status w/ window-focus recheck; win32 auto-granted/hidden), **Provider keys** (per-provider cards for Groq STT / OpenAI / OpenRouter via `getProviderKeyStatus`/`setProviderKey`/`testProviderKey`/`clearProviderKey`; OpenAI+OpenRouter cards also edit model dropdown via `listModels` + baseUrl input via `getLLMSettings`/`setLLMSettings`; Groq card edits STT model + language via `getSTTSettings`/`setSTTSettings`), Usage (`getUsage`/`resetUsage`, per-provider cost), Keyboard Shortcuts (dictation key segmented control — platform-aware: darwin Fn/Right-Option, win32 Right-Ctrl/Right-Alt; instruction key Right Shift default + Caps Lock on darwin; activation mode), Audio (enumerate mic devices), Behavior (output paste|clipboard if exposed, sound feedback, chunked transcription), Appearance (widget position center|right), Help (replay onboarding). STRIP all whisper/local-model UI + cloud-vs-local STT toggle + Hinglish. Use `.btn-glass`, `.kbd-3d`, glass cards.

## `renderer/app/History.tsx`
Default `History()`. `getSessions` on mount; `onRetryStatus` live patch (cleanup `removeAllListeners(IPC string 'session:retry-status')` — renderer uses the literal since it can't import ipc.ts; document the literal). Copy output, `retrySession`. FLOW_CONFIG colors → monochrome white-alpha tiers. Empty-state kbd uses dynamic dictation key. Uses `.animate-slide-in-up` (now defined in tokens.css).

## `renderer/app/Onboarding.tsx`
Default `Onboarding({ onComplete })`. Steps: Welcome, How it works, Privacy, Provider key(s) (Groq/OpenAI/OpenRouter; STRIP skip-to-on-device), Mic permission, Accessibility permission (auto-skip/granted on win32), Shortcuts (platform-aware), Ready. Window-focus permission recheck. On complete: set localStorage + `onComplete()`.

## `renderer/app/Privacy.tsx`
Default `Privacy()`. Static. Copy: dictations local, key encrypted via Electron safeStorage (Keychain on macOS / DPAPI on Windows), audio sent only to the configured provider (Groq for STT; OpenAI/OpenRouter for transforms), no accounts/tracking. Black glass.

## `renderer/app/Voice.tsx`
Default `Voice({ dictationKey })`. Static Features explainer for the 3 modes (Pure Dictation, AI Instruction, Dictate-to-Instruct chaining). Use `.kbd-3d` for key badges. Monochrome.

## `renderer/widget/WidgetApp.tsx`
Default `WidgetApp()`. Binds IPC via `window.electronAPI` to `WidgetState` + `useAudioRecorder`. Owns Web Audio click sounds (`playClickSound('start'|'stop')`, 880/660Hz), auto-hide timers, `widgetReady()` handshake. Binds: onRecordingStart/Stop, onOutputReady/Fallback/Error, onSessionCancelled, onProcessingDiscardHint, onSessionTooShort, onEngineNotice; cleanup `removeAllListeners` for all bound channels. `handleCancel/handleStop/handleUndo`. Adds `body.widget-body` (transparent). KEEP `widgetReady()` (gates showHUD). engineNotice = provider-fallback notice (not on-device).

## `renderer/widget/Widget.tsx`
Default `Widget({ state, analyserNode, maxDurationSeconds, outputPreview, fallbackMessage, errorMessage, showDiscardHint, engineNotice, onCancel, onStop, onUndo })`. Pure presentational; all `WidgetState` cases; own elapsed timer + entry/exit (200ms, matches hud-exit). Recording dot/glow = white-alpha intensities (dictation dim, instruction bright) via `.animate-radiate-dim`/`.animate-radiate-bright`/`.animate-dot-pulse`. Output ack = `.animate-success-pop` near-white check. Optionally render `<Waveform analyserNode={analyserNode}/>` in the recording state.

## `renderer/widget/Waveform.tsx`
Default `Waveform({ analyserNode, color?, width?, height? })`. Canvas freq-bar visualizer, DPR-scaled, rAF. Default `color='rgba(255,255,255,0.75)'`. Port verbatim.

## `renderer/widget/useAudioRecorder.ts`
`export function useAudioRecorder(): UseAudioRecorderReturn`. `type RecordingMode = SessionMode`. Returns `{ isRecording, analyserNode, maxDurationSeconds, startRecording(deviceId?,mode?,sessionId?), stopRecording() }`. Port the VAD/chunking engine VERBATIM (MediaRecorder `audio/webm;codecs=opus` start(250), AnalyserNode fftSize 128, RMS speech detection, silence/hard-cap chunk splitting). **CHANGE:** replace `getServerConfig()` with `window.electronAPI.getAppConfig()` reading `config.chunking.*`; read `getChunkedTranscription()`. STRIP Sarvam/cloud-vs-local branches. PRESERVE every guard: `audioSentRef`, frozen `mode`/`sessionId` refs, `emitChunk` VAD pause (`isEmittingChunkRef`), `heardSpeechRef` gate (silent → `sendAudioDiscarded`), `MIN_DURATION_MS=500`, final-chunk `totalChunks` (may send `ArrayBuffer(0)`). `[audio]`/`[audio:vad]` log prefixes.

---

# uiohook-napi reference (win32)

Use `UiohookKey` constants BY NAME (the enum), never raw numeric keycodes:
- `UiohookKey.CtrlRight` — win32 dictation option
- `UiohookKey.AltRight` — win32 dictation option
- `UiohookKey.ShiftRight` — win32 instruction default
- `UiohookKey.Escape` — if needed for renderer-side; Escape cancel is handled in main via globalShortcut, so not required here.

Event handlers: `uIOhook.on('keydown', (e) => { if (e.keycode === UiohookKey.ShiftRight) emit('key','instruction-down') ... })` and `'keyup'`. Start once with `uIOhook.start()`, stop with `uIOhook.stop()`. Right Shift on win32 is momentary (down/up), so keyboard.ts triggers on `instruction-down` only.

---

# Feature delta (June 2026): Dictionary / Snippets / AutoFormat / InstructionEnabled

New contract surface added to `shared/types.ts` (`DictionaryEntry`, `Snippet`, 8 `ElectronAPI` methods), `shared/ipc.ts` (8 channels), and `electron/preload.ts` (8 implementations). Channel constants (use `IPC.*` — never inline):

- `IPC.SET_AUTO_FORMAT` `'settings:auto-format'` (R->M), `IPC.GET_AUTO_FORMAT` `'settings:get-auto-format'` (R<->M)
- `IPC.SET_INSTRUCTION_ENABLED` `'settings:instruction-enabled'` (R->M), `IPC.GET_INSTRUCTION_ENABLED` `'settings:get-instruction-enabled'` (R<->M)
- `IPC.SET_DICTIONARY` `'settings:dictionary'` (R<->M, returns void), `IPC.GET_DICTIONARY` `'settings:get-dictionary'` (R<->M)
- `IPC.SET_SNIPPETS` `'settings:snippets'` (R<->M, returns void), `IPC.GET_SNIPPETS` `'settings:get-snippets'` (R<->M)

Note: `setDictionary`/`setSnippets` are `Promise<void>` (`ipcMain.handle`, whole-list set — lists are small). `setAutoFormat`/`setInstructionEnabled` are fire-and-forget `void` (`ipcMain.on`). Renderer generates entry/snippet `id`s with `crypto.randomUUID()`.

## `electron/keyboard.ts` — new export

```ts
//   setInstructionEnabled(enabled: boolean): void
```
When `false`, `handleKey` IGNORES ALL instruction-derived events (`instruction-down`/`instruction-up`) — dictation and Escape are unaffected. Default OFF. `resetState()` must NOT clear the enabled flag (it is a persisted setting, not per-keystroke state). `main.ts` restoreSettings applies it at boot AND the `SET_INSTRUCTION_ENABLED` IPC handler applies it live.

## `electron/sessionManager.ts` — new pipeline hooks

Add setters/state the core reads during transcript processing (apply to BOTH dictation and instruction transcripts unless noted):

```ts
//   setAutoFormat(enabled: boolean): void; getAutoFormat(): boolean
//   setDictionary(entries: DictionaryEntry[]): void; getDictionary(): DictionaryEntry[]
//   setSnippets(snippets: Snippet[]): void; getSnippets(): Snippet[]
```

Transcript pipeline ORDER (dictation flow): STT transcript -> existing `cleanTranscript` -> **Dictionary replacement** -> **Snippet expansion** -> if `autoFormat` on, **LLM AUTO_FORMAT pass**. Instruction flow applies Dictionary + Snippet replacement to its transcript too (NO auto-format).

- **Dictionary replacement:** for each `from`->`to`, case-insensitive, word-boundary match tolerant of adjacent punctuation, escape regex specials in `from`, apply LONGEST `from` first.
- **Snippet expansion:** after dictionary, expand spoken `trigger`->`content`, case-insensitive, tolerant of surrounding/trailing punctuation, LONGEST `trigger` first.
- **AUTO_FORMAT LLM pass:** uses the configured LLM provider+model via `getLLMProvider(llm.provider)`, key from `keyStore.getApiKey(llm.provider)`, system prompt `AUTO_FORMAT` from `prompts.ts`, sensible timeout (`APP_CONFIG.transform.timeout_ms`). On ANY failure (no key, network, timeout, empty/refusal) fall back gracefully to the unformatted text and emit the existing `IPC.OUTPUT_FALLBACK` with a short message — NEVER blocks the paste. Track tokens via `usageTracker.recordLlmUsage` like instruction transforms.
- **STT vocabulary biasing:** pass dictionary `to` values (joined, capped ~200 chars) as `opts.prompt` to `TranscriptionProvider.transcribe` so Groq biases recognition. Wire it where sessionManager calls `transcribe`. (NOTE: this re-introduces a Whisper `prompt` for biasing — bounded by the dictionary, distinct from the reference's silence-parroting concern.)

## `electron/prompts.ts` — new export

```ts
export const AUTO_FORMAT: string
```
System prompt: fix grammar, punctuation, capitalization, sentence breaks, paragraphing of a raw dictation transcript; NEVER change meaning, NEVER add content, NEVER alter URLs/emails/proper nouns; output ONLY the corrected text with no preamble.

## `electron/main.ts` — new electron-store keys + IPC handlers

New persisted keys (with defaults), pushed into managers on restore:
- `instructionEnabled` (default `false`) -> `keyboardManager.setInstructionEnabled(...)`
- `autoFormat` (default `false`) -> `sessionManager.setAutoFormat(...)`
- `dictionary` (default `[]`, `DictionaryEntry[]`) -> `sessionManager.setDictionary(...)`
- `snippets` (default `[]`, `Snippet[]`) -> `sessionManager.setSnippets(...)`

New IPC handlers:
- `GET_INSTRUCTION_ENABLED` -> store; `SET_INSTRUCTION_ENABLED` -> `keyboardManager.setInstructionEnabled` + store.
- `GET_AUTO_FORMAT` -> store; `SET_AUTO_FORMAT` -> `sessionManager.setAutoFormat` + store.
- `GET_DICTIONARY` -> store; `SET_DICTIONARY` -> `sessionManager.setDictionary` + store (handle, returns void).
- `GET_SNIPPETS` -> store; `SET_SNIPPETS` -> `sessionManager.setSnippets` + store (handle, returns void).

The electron-store schema in `main.ts` adds `instructionEnabled: boolean`, `autoFormat: boolean`, `dictionary: DictionaryEntry[]`, `snippets: Snippet[]`.
