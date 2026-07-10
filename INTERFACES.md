# Maverick Voice v2 — INTERFACES.md (THE CONTRACT)

Authoritative module contract for the v2 rewrite. Exact paths, exports,
signatures, IPC ownership. **Conform exactly.** Channel-name strings live ONLY
in `shared/ipc.ts`; cross-process shapes ONLY in `shared/types.ts`. If any doc
disagrees with this file, this file wins; if this file disagrees with
`shared/types.ts` / `shared/ipc.ts` once written, those win.

`legacy/` is semantic reference only — port tuned constants and behavior,
never structure. Consult `LEGACY-ISSUES.md` before porting anything.

## Global conventions

- **File-size budget:** no module > ~400 lines. Split before you exceed it.
- **Idioms:** typed EventEmitter (or plain callback registry) singletons;
  `console.log('[module] …')` prefixes; **never log transcript/output text**
  (session ids + stage names only).
- **Platform branch:** `process.platform === 'darwin' | 'win32' | 'linux'`,
  with a safe fallback (granted/no-op/degrade-with-notice) for every
  platform-specific path. Platform branching is confined to
  `keys/listener.ts`, `output/*`, `windows/*`, `permissions.ts`. Linux
  additionally branches on session type (`XDG_SESSION_TYPE` x11 vs wayland)
  inside those same modules only.
- **Imports:** main modules may import `shared/types.ts` + `shared/ipc.ts`.
  Renderer imports `shared/types.ts` only and talks through
  `window.electronAPI`. Renderer NEVER needs raw channel strings — every
  preload subscription returns an unsubscribe function.
- **Async persistence only.** No `*Sync` fs/DB calls anywhere in main except
  process-exit flush.
- **Events, not sleeps.** A `setTimeout` may implement UX timing (auto-hide,
  undo window) or act as a *guard* around an awaited ack — never as the
  primary mechanism for a cross-process handoff.
- **Timeout policy lives in `electron/config.ts` alone** (`TIMEOUTS` object).
  No module defines its own timeout constant.

---

## SHARED

### `shared/types.ts`
All cross-process types: `ElectronAPI`, `Session`, `WidgetState`,
`UsageSummary`/`UsageWindow`, `AppConfig`, `SessionMode`, `ActivationMode`,
`DictationBinding` (`{type:'key', key: DictationKey} | {type:'combo', mods: ModifierKey[]}`),
`InstructionKey` (`'caps-lock'`), `STTProviderId`/`LLMProviderId`/`ProviderId`,
`STTSettings`, `LLMSettings`, `ProviderModel`, key-status result types,
`DictionaryEntry`, `Snippet`, `AppProfile`, `ThemeSetting`
(`'system'|'light'|'dark'`), `PermissionsReport`, `KeyCapability`.

```ts
export interface PermissionsReport {
  mic: 'granted'|'denied'|'not-determined'
  accessibility: boolean          // AXIsProcessTrusted (darwin; true elsewhere)
  inputMonitoring: boolean        // helper HEALTH / IOHIDCheckAccess (darwin; true elsewhere)
  automation: 'granted'|'denied'|'unknown'
  listenerAlive: boolean          // listener spawned AND receiving events (all platforms)
  linux?: {                       // present only on linux
    sessionType: 'x11'|'wayland'|'unknown'
    xdotool: boolean              // paste/selection injection available
    secretService: boolean        // safeStorage backend is a real keyring
  }
}
export interface KeyCapability {
  fnAvailable: boolean            // hardware reports Fn/Globe
  globeConflict: boolean          // macOS owns Globe (dictation/emoji)
  defaultBinding: DictationBinding
}
```

### `shared/ipc.ts`
`export const IPC = { … } as const` — the ONLY place channel strings exist.
Full table in §IPC below.

---

## MAIN PROCESS

### `electron/main.ts` — boot only (~100 lines, no exports)
Order: settings store init/migrate → `initStores()` → `createDashboard()` →
`createHUD()` → `createTray()` → `registerIpc()` → `permissions.preflight()`
→ `keys.start()` (try/catch — a listener crash must not block IPC) →
`updater.start()`. `before-quit`: `keys.stop()`, `flushStores()`.
Single-instance lock: on failure `app.quit()` **and `return`** — nothing else
runs (v1 raced the primary instance's config).
EPIPE swallow guards at top (cross-platform).

### `electron/config.ts`
```ts
export const APP_CONFIG: AppConfig          // chunking thresholds, junk detection — values ported from v1 (tuned)
export const TIMEOUTS = {
  request: 15_000,        // single provider call
  transform: 15_000,      // LLM transform budget
  audioArrival: 2_000,    // stop → AUDIO_FINAL guard
  helperCommand: 500,     // mac-helper stdin ack
  undoWindow: 3_000,
} as const
export interface ModelPricing { perAudioHour?: number; perMInputTokens?: number; perMOutputTokens?: number }
export const PRICING: Record<string, ModelPricing>   // hardcoded; drifts; $0 when absent
```

### `electron/session/fsm.ts`
```ts
export type SessionPhase = 'idle'|'recording'|'chained'|'awaiting-audio'|'processing'|'output'|'fallback'|'error'|'too-short'|'cancelled'
export interface SessionState { id: string; mode: SessionMode; phase: SessionPhase; abort: AbortController; /* transcripts, selection, profile, … */ }
export const sessionFsm: SessionFsm
// class SessionFsm (typed EventEmitter):
//   start(mode: SessionMode): void
//   chain(mode: SessionMode): void
//   stop(mode: SessionMode): void            // → 'awaiting-audio'; resolves on audio ack or TIMEOUTS.audioArrival
//   audioFinal(a: AudioPayload): void        // resolves the await — replaces v1 grace polls
//   audioChunk(a: ChunkPayload): void
//   audioDiscarded(sessionId: string): void
//   cancel(): void; cancelWithUndo(): void; undoCancel(): void
//   current(): SessionState | null
//   on('phase', (s: SessionState) => void)
//   on('complete', (s: SessionState) => void)   // persistence subscribes; errors in handlers are caught
```
Invariants: `AbortController` created at `start()` (chunks cancellable);
`isProcessing` set before any await; late audio for a cancelled session
dropped by id; foreign-audio leniency (absent sessionId accepted) preserved.

### `electron/session/pipeline.ts`
```ts
export async function runPipeline(s: SessionState, deps: PipelineDeps): Promise<PipelineResult>
```
transcribe (chunks in parallel under `s.abort.signal`; failed chunk ⇒
`fallback` result with notice, never a silent gap) → `textops` chain → flow
route (`dictation` no-LLM unless autoFormat; `quote` = `'> '+sel`; others →
LLM) → LLM empty/refusal/error ⇒ fallback text + notice. Retry path writes
results ONLY on success (v1 destroyed data on failed retry).

### `electron/session/textops.ts` — pure, unit-tested
```ts
export function cleanTranscript(text: string): string          // WHISPER sentinels ported
export function applyDictionary(text: string, entries: DictionaryEntry[]): string   // longest-first, ci, punct-tolerant
export function applySnippets(text: string, snippets: Snippet[]): string
export function buildSttPromptHint(entries: DictionaryEntry[]): string | undefined  // distinct `to`s, ≤200 chars — the ONLY sanctioned Whisper prompt
export function isLLMRefusal(text: string): boolean             // anchored to reply start; "I can't help feeling…" must NOT match
export function isJunk(text: string): boolean
```
Order (load-bearing): clean → Dictionary → Snippets → optional auto-format
(dictation only). Dictionary+Snippets run on instruction transcripts too.

### `electron/session/flows.ts`
```ts
export function determineFlowType(i: FlowInputs): FlowType
```
Change from v1: plain dictation with a pre-existing selection stays
`dictation`; `quote` requires instruction-key intent with no spoken command.
Selection capture result binds to the requesting session via closure.

### `electron/keys/listener.ts` — PLATFORM SEAM
```ts
export type KeyEvent = 'dictation-down'|'dictation-up'|'instruction-down'|'escape-down'|'escape-up'
export const keyListener: KeyListener
// start(): boolean; stop(): void; isRunning(): boolean
// setBinding(b: DictationBinding): void
// command(cmd: 'PASTE'|'COPY'|'FRONTAPP'|'HEALTH'): Promise<string>   // darwin; rejects win32 (except HEALTH → 'ok')
// on('key', (e: KeyEvent) => void); on('health', (alive: boolean) => void)
```
- darwin: spawn `resources/bin/mac-helper` (universal). Protocol = v1
  globe-listener verbatim (`FN_*`, `CAPS_*`, `RIGHT_OPTION_*`, `MODS:<csv>`,
  `PASTE_OK`/`COPY_OK`, `FRONTAPP:<id>|<name>`) **plus** `HEALTH` →
  `HEALTH:OK|NOPERM`. Caps LED pair collapsed to one `instruction-down` with
  a **self-healing** pairing window (timer-reset, not a latch that can invert
  forever — v1 bug #8). Stdout parsing: one shared line-buffer with
  partial-line carry; stdin commands correlated by expected reply prefix, one
  in flight per prefix. Restart: exponential backoff, latch cleared on
  `start()`.
- win32 + linux: uiohook-napi, `UiohookKey` names only, typematic auto-repeat
  suppressed, no `instruction-up` ever emitted (all platforms). linux: if
  uiohook fails to start (Wayland compositor block), emit `'health'` false —
  never throw into boot.
- Escape is delivered as a normalized event **only while a session is active**
  (fsm subscribes/unsubscribes) — no `globalShortcut.register('Escape')`.
- Combo bindings: `MODS:` superset match, ≥2 modifiers, single-key tokens
  suppressed while a combo is configured (v1 semantics).

### `electron/keys/bindings.ts` — single owner of binding + activation state
```ts
export const keyBindings: KeyBindings   // typed EventEmitter
// getBinding()/setBinding(b: DictationBinding)      // pushes to keyListener; ONE source of truth
// getInstructionEnabled()/setInstructionEnabled(b)  // persisted; NOT cleared by resetState()
// getActivationMode()/setActivationMode(m)          // resets dual-tap state
// handleKey(e: KeyEvent): void
// resetState(): void
// emits 'action': {type:'session-start'|'session-stop'|'chain-start'|'chain-expired'|'cancel', mode?}
```
Constants ported verbatim: `DEBOUNCE_MS=300` (gates START never STOP),
`CHAIN_WINDOW_MS=2000`, `DUAL_HOLD_MS=400`, `DUAL_DOUBLE_TAP_MS=400`.
`resetState()` clears every per-keystroke field; instruction triggers on
`instruction-down` only; Caps Lock is the only instruction key; Right Shift
stays removed.

### `electron/keys/capability.ts`
```ts
export async function detectCapability(): Promise<KeyCapability>
```
darwin: Fn presence + Globe-conflict best-effort; default binding `fn` when
available else `right-option`. win32: `right-ctrl`.

### `electron/permissions.ts`
```ts
export async function preflight(): Promise<PermissionsReport>
export function onChange(cb: (r: PermissionsReport) => void): () => void   // re-check on app focus
export function openSettingsPane(pane: 'mic'|'accessibility'|'input-monitoring'|'automation'|'keyboard'): void  // Ventura+ URLs, win32 no-op
```
win32: everything granted/no-op. `listenerAlive` comes from the helper
`HEALTH` command — a spawned-but-deaf helper reports `false` (v1 M6).
linux: fills `report.linux` (session type via `XDG_SESSION_TYPE`, `xdotool`
via `which`, secret service via `safeStorage.getSelectedStorageBackend()`);
`openSettingsPane` is a no-op.

### `electron/output/inject.ts`
```ts
export async function injectOutput(text: string): Promise<{ degraded?: 'clipboard-only' }>  // clipboard.writeText FIRST, then keystroke
export function copyToClipboard(text: string): void
```
darwin keystroke: `keyListener.command('PASTE')` (CGEvent, acked) →
on failure/timeout fall back to osascript System Events (the packaged-app-safe
path; keep the CGEvent-drops-when-packaged comment and verify at runtime via
the ack). win32: PowerShell `SendKeys` with `-NoProfile`. linux:
`execFile('xdotool', ['key','--clearmodifiers','ctrl+v'])` on X11; on Wayland
or missing xdotool, `injectOutput` resolves after the clipboard write and
reports `degraded: 'clipboard-only'` so the HUD shows "Copied — press Ctrl+V"
instead of pretending it pasted.

### `electron/output/media.ts`
```ts
export async function pausePlayingMedia(): Promise<void>   // remembers what IT paused (module state)
export async function resumePausedMedia(): Promise<void>   // resumes ONLY that set; clears state
```
Gated by the `pauseMediaDuringDictation` setting at the call site (session
fsm: pause on recording start, resume on session end — fire-and-forget, never
awaited on the hot path, never throws). darwin: osascript query
`player state` of Music + Spotify, pause the playing ones, resume the same
apps. linux: `playerctl --list-all` + `status` per player, `pause` the
playing ones, `play` them on resume; no playerctl → no-op. win32: WinRT
`GlobalSystemMediaTransportControlsSessionManager` via PowerShell best-effort;
failure → no-op. A resume is skipped if the user manually resumed in between
(re-check state before `play`). `[media]` log prefix.

### `electron/output/selection.ts`
```ts
export async function captureSelectedText(opts: { useClipboardFallback: boolean }): Promise<string | null>
```
Save clipboard (all available formats via `clipboard.readBuffer` where
text-only restore would lose data) → clear → synthesized copy → settle →
read → restore. `useClipboardFallback` true only for instruction mode.
Called with the session object; result assigned via closure.

### `electron/windows/hud.ts` — single owner of HUD visibility
```ts
export function createHUD(): BrowserWindow
export function getHUD(): BrowserWindow | null
export function showHUD(): Promise<void>       // awaits WIDGET_READY handshake
export function hideHUD(): Promise<void>       // sends HUD_HIDE, awaits HUD_EXIT_DONE (guard TIMEOUTS.helperCommand), then hides window
export function setHUDPosition(p: 'center'|'right'): void
export function markReady(): void; export function markExitDone(): void
```
Bounds: bottom-anchored, `DOCK_CLEARANCE=80`, on
`screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`; reposition on
`display-metrics-changed`. darwin: `type:'panel'`, all-workspaces,
`hasShadow:false`, `showInactive()` (never steals focus). The 220 ms magic
timer is gone — exit timing is renderer-acked.

### `electron/windows/dashboard.ts`, `electron/windows/tray.ts`
Dashboard 900×640 min 700×500. Tray: pulse frames pre-rendered once;
`setTemplateImage(true)` darwin-only.

### `electron/store/*` (all async; atomic tmp+rename; flush on quit)
```ts
// settings.ts — electron-store wrapper + v1 migration (right-shift→caps-lock, dictationKey→binding, import v1 values)
export const settings: TypedStore<SettingsSchema>   // schema per SYSTEM-DESIGN §6.3 (+ theme)
// sessions.ts
export async function saveSession(s: Session): Promise<void>   // write-behind; prune scheduled on idle, never inline
export async function getSessions(limit?: number): Promise<Session[]>
export async function updateSessionResult(id: string, u: Partial<Session>): Promise<void>  // success-only writes
export async function deleteSession(id: string): Promise<void>; export async function clearAllSessions(): Promise<void>
// usage.ts
export function recordSttUsage(model: string, seconds: number): void       // in-memory, debounced flush; never throws
export function recordLlmUsage(model: string, inTok: number, outTok: number): void
export async function getUsageSummary(): Promise<UsageSummary>; export async function resetUsage(): Promise<void>
// keys.ts — safeStorage vault, userData/<provider>-key.enc; .env seed gated !app.isPackaged
export function getApiKey(p: ProviderId): string | null
export function hasApiKey(p: ProviderId): boolean
export function setApiKey(p: ProviderId, key: string): void; export function clearApiKey(p: ProviderId): void
export function getMaskedKey(p: ProviderId): string | null
// audio.ts — in-memory during recording; ONE async write at stop; prune on idle; retry naming '<id>-dictation'|'<id>-instruction'
export function holdAudio(sessionId: string, buf: Buffer): void
export async function persistAudio(sessionId: string): Promise<string | null>
export async function loadAudio(sessionId: string): Promise<Buffer | null>
export async function clearAllAudio(): Promise<void>
```

### `electron/providers/`
`types.ts` — v1 interfaces verbatim (`TranscriptionProvider`, `LLMProvider`,
options/results, `KeyTestResult`, `NoApiKeyError`). Invariants (unchanged,
non-negotiable): keys injected by callers; AbortError re-throws; usage
recorded with exact model string; canonical OpenAI-compatible body.

```ts
// openaiCompatible.ts
export function createOpenAICompatibleProvider(cfg: {
  id: LLMProviderId; label: string; defaultBaseUrl: string; defaultModel: string;
  models: ProviderModel[]; extraHeaders?: Record<string, string>
}): LLMProvider
// llm/openai.ts / llm/openrouter.ts — factory calls (~10 lines each; OpenRouter adds HTTP-Referer/X-Title)
// stt/groq.ts — multipart verbose_json; language omitted when 'auto'; opts.prompt passthrough (dictionary hint ONLY — keep parroting comment); keep-alive Agent
// registry.ts — Map + getTranscriptionProvider/getLLMProvider (throw on unknown id)
```

### `electron/prompts/`
`prompts.ts` — v1 system prompts ported VERBATIM (DICTATION, CONTEXT,
TRANSFORM, INSTRUCTION, FALLBACK, AUTO_FORMAT base) +
`buildAutoFormatPrompt(profile)`; temperatures 0.1 / 0.3 as v1.
`appProfiles.ts` — `detectProfile(appId, appName)` + `profilePromptBlock`,
data table ported verbatim (email / chat-ai / code-editor / messaging /
notes / default). `frontmostApp.ts` — helper `FRONTAPP` command, osascript /
PowerShell / `xdotool getactivewindow` (X11; null on Wayland → `'default'`
profile), ~800 ms cap, never throws.

### `electron/errors.ts`
```ts
export function simplifyError(raw: string): string   // v1 keyword map, order preserved
export function reportError(source: string, message: string): void  // ring(50) + broadcast to BOTH windows
export function onErrors(win: BrowserWindow): void
```

### `electron/updater.ts`
Real R2 feed URL; check on launch + daily; never blocks boot; version guard
against downgrade manifests.

### `electron/ipc/*.ts`
One registrar per domain (`session`, `settings`, `keys`, `usage`,
`permissions`, `theme`); each ≤ ~120 lines; route to modules, no logic.

### `electron/preload.ts`
Implements `ElectronAPI`. **Every subscription returns `() => void`**
(unsubscribe). Audio send: transfer the ArrayBuffer once; no re-wrap copies.

---

## IPC CHANNEL TABLE

Direction: `M→R` main sends; `R→M` fire-and-forget; `R↔M` invoke/handle.

| Constant | Channel | Dir | Payload → result |
|----------|---------|-----|------------------|
| `RECORDING_START` | `recording:start` | M→R | `(mode, sessionId, appName?, profile?)` |
| `RECORDING_ACK` | `recording:ack` | R→M | `(sessionId)` — recorder rolling |
| `RECORDING_STOP` | `recording:stop` | M→R | `(sessionId)` |
| `AUDIO_CHUNK` | `audio:chunk` | R→M | `(buffer, chunkIndex, mode, sessionId)` |
| `AUDIO_FINAL` | `audio:final` | R→M | `(buffer, chunkIndex, totalChunks, duration, mode, sessionId)` |
| `AUDIO_DISCARDED` | `audio:discarded` | R→M | `(mode, sessionId)` |
| `OUTPUT_READY` | `output:ready` | M→R | `(text, sessionId)` |
| `OUTPUT_FALLBACK` | `output:fallback` | M→R | `(text, sessionId, message?)` |
| `OUTPUT_ERROR` | `output:error` | M→R | `(error, sessionId)` |
| `SESSION_CANCELLED` / `SESSION_TOO_SHORT` / `PROCESSING_SHOW_DISCARD_HINT` | as v1 | M→R | `()` |
| `WIDGET_STOP` / `WIDGET_CANCEL` / `WIDGET_UNDO_CANCEL` | as v1 | R→M | `()` |
| `WIDGET_READY` | `widget:ready` | R→M | `()` — gates `showHUD()` |
| `HUD_HIDE` | `hud:hide` | M→R | `()` — play exit animation |
| `HUD_EXIT_DONE` | `hud:exit-done` | R→M | `()` — replaces the 220 ms timer |
| `SESSION_LIST` | `session:list` | R↔M | `() → Session[]` |
| `SESSION_RETRY` / `SESSION_RETRY_STATUS` | as v1 | R↔M / M→R | |
| `USAGE_GET` / `USAGE_RESET` | as v1 | R↔M | `() → UsageSummary` |
| `KEY_STATUS` / `KEY_SET` / `KEY_TEST` / `KEY_CLEAR` | as v1 | R↔M / R→M | per-provider |
| `STT_SETTINGS_*` / `LLM_SETTINGS_*` / `LIST_MODELS` | as v1 | R↔M | |
| `SETTINGS_GET` | `settings:get` | R↔M | `() → RendererSettings` — **one batched call** replaces v1's ~18 individual gets |
| `SET_*` setters | as v1 (`widget-position`, `sound-feedback`, `chunked-transcription`, `activation-mode`, `auto-format`, `instruction-enabled`, `dictionary`, `snippets`, `app-aware-formatting`, `dictation-binding`, `output-mode`, `input-device`) | R→M / R↔M | unchanged semantics |
| `SETTINGS_CHANGED` | `settings:changed` | M→R | `(partial)` — live push (fixes stale sound toggle) |
| `THEME_GET` / `THEME_SET` | `theme:get` / `theme:set` | R↔M / R→M | `ThemeSetting` |
| `PERM_PREFLIGHT` | `permissions:preflight` | R↔M | `() → PermissionsReport` |
| `PERM_OPEN_PANE` | `permissions:open-pane` | R→M | `(pane)` |
| `KEY_CAPABILITY` | `keys:capability` | R↔M | `() → KeyCapability` |
| `OPEN_EXTERNAL` | `open-external` | R→M | `(url)` http/https only |
| `CONFIG_GET` | `config:get` | R↔M | `() → AppConfig` |
| `DEV_ERROR_LOG` | `dev:error-log` | M→R | `(entry)` |

Removed from v1: `AUDIO_READY` (merged into `AUDIO_FINAL` with
`totalChunks=1`), per-setting GET channels (batched into `SETTINGS_GET`),
`SESSION_ENGINE_NOTICE` (folded into `OUTPUT_FALLBACK` message).

---

## RENDERER MODULES

All styling via tokens/utilities per `DESIGN.md`; every subscription cleaned
up with its returned unsubscribe.

| Module | Contract |
|--------|----------|
| `renderer/main.tsx` | hash route `#/widget` → HUD root else dashboard; both in `<ThemeProvider>` |
| `renderer/theme/ThemeProvider.tsx` | reads `THEME_GET`, resolves `system` via `matchMedia`, sets `data-theme` on `<html>`, live-updates |
| `renderer/ui/*` | `Toggle` (role=switch), `Segmented` (radiogroup), `KeyCard`, `PageHeader`, `EmptyState`, `LoadingDots`, `ProviderGlyph` (mono @lobehub), `Kbd`, `TrashGlyph`; data: `languages.ts`, `keyLabels.ts` (platform-aware — no unconditional 'fn'), `platform.ts` (one `IS_MAC`) |
| `renderer/app/App.tsx` | shell + sidebar; tabs mounted persistently (CSS-hidden); settings loaded once via `SETTINGS_GET`, provided by context |
| `renderer/app/settings/*` | one file/section: `Permissions`, `ProviderKeys`, `Shortcuts` (binding picker incl. combo chips), `Audio`, `Behavior`, `Appearance` (theme picker + widget position), `Advanced` (instruction opt-in), `Help` |
| `renderer/app/History.tsx` | list, copy, retry with live status; hover actions also focus-visible |
| `renderer/app/{Dictionary,Snippets}.tsx` | immediate persist on change (no cancel-on-unmount debounce loss) |
| `renderer/app/onboarding/*` | data-driven steps; shared `KeyCard`; permission steps driven by `PERM_PREFLIGHT`; capability-aware shortcut step |
| `renderer/widget/WidgetApp.tsx` | binds IPC ↔ state via unsubscribe pattern; one reused `AudioContext`; subscribes `SETTINGS_CHANGED` for live sound toggle; sends `RECORDING_ACK`, `HUD_EXIT_DONE` |
| `renderer/widget/Widget.tsx` | ONE persistent pill, state morphs via transform/opacity; static stylesheet; memoized timer leaf; `aria-live="polite"`; correct exit FSM (`exiting` cleared on re-entry) |
| `renderer/widget/recorder.ts` | MediaRecorder+VAD engine; ONE flush path for chunk-emit and stop; stop promise with timeout guard; serialized starts; v1 tuned constants preserved |
| `renderer/widget/Waveform.tsx` | v1 rAF loop as-is; color read at draw time |

## Sanity checklist (every PR)

- [ ] No inlined IPC strings; no shapes outside `shared/types.ts`.
- [ ] No sync fs/DB on main except quit-flush; no sleeps as handshakes.
- [ ] No transcript text in any log line.
- [ ] New keyboard state added to `resetState()`.
- [ ] Provider touched → AbortError still re-throws; exact model string recorded.
- [ ] New animation is transform/opacity only + reduced-motion gated.
- [ ] New color is a token, in both themes.
- [ ] File ≤ ~400 lines. `npm run typecheck` passes both tsconfigs.
