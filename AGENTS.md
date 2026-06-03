# AGENTS.md — Maverick Voice

Instructions and **non-obvious gotchas** for AI agents (and humans) working in
this repo. This file deliberately holds the things that are hard to infer from
the code, easy to get wrong, and not worth putting in `README.md`. The
authoritative module contract is [`INTERFACES.md`](./INTERFACES.md) — **read it
first, conform exactly.** If anything here disagrees with `INTERFACES.md`,
`shared/types.ts`, or `shared/ipc.ts`, those files win.

---

## 0. The contract spine (read in this order)

1. [`INTERFACES.md`](./INTERFACES.md) — exact paths, exports, signatures,
   ownership, behavioral notes.
2. [`shared/types.ts`](./shared/types.ts) — all cross-process types + the
   `ElectronAPI` surface. **Single source of truth for shapes.**
3. [`shared/ipc.ts`](./shared/ipc.ts) — `IPC.*` channel-name constants. **Single
   source of truth for channel strings.**
4. [`electron/providers/types.ts`](./electron/providers/types.ts) — provider
   interfaces.
5. [`electron/preload.ts`](./electron/preload.ts) — only if you touch IPC.

**Conform to the exact exports, signatures, and channel names.** Do not add
speculative abstraction. Do not re-introduce stripped subsystems (see §9).

---

## 1. IPC channel names live in `shared/ipc.ts` ONLY

- **Never inline an IPC channel string** in main-process code. Import the
  `IPC.*` constant. Adding or renaming a channel happens in `shared/ipc.ts`
  once, and only there.
- Cross-process **shapes** live in `shared/types.ts` only. Don't redefine
  `Session`, `UsageSummary`, etc. locally.
- **Renderer exception (documented):** the renderer **cannot** import
  `shared/ipc.ts` or anything under `electron/**` — it touches only
  `window.electronAPI`. Where a renderer file must pass a raw channel string to
  `removeAllListeners(...)` (because it has no access to the `IPC` constant), it
  uses the **literal** string and documents it at the call site. Example:
  `History.tsx` cleans up with `removeAllListeners('session:retry-status')`;
  `WidgetApp.tsx` does the same for every channel it bound. If you rename a
  channel in `shared/ipc.ts`, **grep the renderer for the literal** and update
  it by hand — TypeScript will NOT catch this.
- Import rules: main-process modules may import `shared/types.ts` +
  `shared/ipc.ts`. The renderer imports `shared/types.ts` only.

## 2. Provider-addition recipe (the whole point of the architecture)

Adding a provider = **one new file + one registry line**. Do not touch
`sessionManager`, `keyStore`, or the renderer pipeline.

1. Create `electron/providers/stt/<name>.ts` or
   `electron/providers/llm/<name>.ts` exporting a singleton that implements
   `TranscriptionProvider` or `LLMProvider` from `providers/types.ts`.
2. Register it in `electron/providers/registry.ts` with a single `.set(id, provider)`.
3. Add the new id to the `STTProviderId` / `LLMProviderId` union in
   `shared/types.ts` (this is the only shared-types edit).
4. Add model rows to `STT_PRICING` / `LLM_PRICING` in `electron/config.ts` so
   usage cost resolves (a model absent from `PRICING` simply contributes `$0`).

**Provider invariants (do not break):**
- **Keys are injected by callers.** Providers NEVER read `keyStore`. An empty
  key throws `NoApiKeyError(providerId)`.
- **AbortError must re-throw** — never swallow it. Session cancellation rides
  the `AbortSignal`; swallowing it leaves the pipeline hung.
- **Record usage with the EXACT model string you sent** (`recordSttUsage` /
  `recordLlmUsage`). `usageTracker` keys cost purely on `row.model`; a mismatch
  silently undercounts to `$0`.
- The LLM body is the **canonical OpenAI-compatible shape** so the `baseUrl`
  override lets any OpenAI-compatible endpoint plug in. Keep it that way.
- Groq STT **must not send the Whisper `prompt`** — Whisper parrots the prompt
  text back on silence/noise. Keep the comment explaining why.

This is exactly how the stripped local providers (whisper.cpp / faster-whisper /
local LLM) will return in the future — as just another file + registry entry.

## 3. `keyboard.ts` state-reset discipline

`keyboard.ts` is the platform-agnostic activation/chaining/debounce state
machine. The single highest-value rule:

- **`resetState()` MUST clear EVERY field that can influence the next
  keystroke** — including the newer instruction-key state. A stale field here
  manifests as "the next dictation won't start" or "instruction fires twice".
  When you add any new piece of per-session keyboard state, add it to
  `resetState()` in the same commit.
- `setActivationMode(...)` must reset the dual-tap state (otherwise switching
  modes mid-session leaves the double-tap timer armed).
- Debounce (`DEBOUNCE_MS = 300`) is **per-logical-key** and gates **START
  only — never STOP**. Do not debounce stops; a debounced stop strands a
  recording.
- Constants are load-bearing: `DEBOUNCE_MS=300`, `chainWindowMs=2000`,
  `DUAL_HOLD_MS=400`, `DUAL_DOUBLE_TAP_MS=400`. Don't "tidy" them.
- Instruction triggers on **`instruction-down` only** (Right Shift is
  momentary). Ignore `instruction-up`.
- `main.ts` resets keyboard state on `onSessionEnded` and `onSessionRejected`
  (the latter resets state but leaves the Escape shortcut registered). Keep this
  asymmetry.

## 4. `keyListener.ts` is the platform seam — keep `keyboard.ts` unaware

`keyListener` normalizes physical keys to **logical** `KeyEvent` strings
(`dictation-down/up`, `instruction-down/up`) and emits the **same** strings on
both platforms, so `keyboard.ts` and everything downstream is platform-unaware.
Do not leak platform branching upward out of `keyListener`.

- **darwin:** spawn `resources/bin/globe-listener` and translate its stdout
  tokens. The binary is **already in the repo** and the protocol is fixed —
  do not change the protocol.
- **win32:** `uiohook-napi`. Map `e.keycode` against `UiohookKey` **by NAME**
  (`UiohookKey.CtrlRight`, `UiohookKey.AltRight`, `UiohookKey.ShiftRight`) —
  **never raw numeric keycodes** (they differ across keyboards/layouts).

### globe-listener stdout protocol (darwin — verbatim, do not alter)

One uppercase token per newline-terminated line; stdout is unbuffered
(`setbuf(stdout, nil)`):

```
FN_DOWN            CAPS_DOWN           RIGHT_OPTION_DOWN
FN_UP              CAPS_UP             RIGHT_OPTION_UP
PASTE_OK   (ack for stdin "PASTE")     COPY_OK   (ack for stdin "COPY")
```

- stderr emits `PASTE_ERROR:<msg>` / `COPY_ERROR:<msg>`.
- stdin commands (newline-terminated): `PASTE`, `COPY`.
- Key codes inside the helper: `kVK_V=9`, `kVK_C=8`, Right Option = keyCode 61,
  (optional Right Shift = keyCode 60).
- **Caps Lock fires on the LED toggle** — BOTH `CAPS_DOWN` and `CAPS_UP` fire
  for a single physical press. Collapse this to a **single** `instruction-down`
  per press (keyboard.ts triggers on down only, so emit `instruction-down` on
  the first token of the pair and ignore the rest).
- Parse on a **trimmed exact-string match**, with a **manual line buffer that
  keeps the last incomplete line** (stdout can split mid-line across reads).
- `PASTE_OK` / `COPY_OK` / unknown lines are ignored by the main parser — they
  are handled only inside `sendCommand`.
- **Right Shift on macOS:** the shipped `globe-listener` does NOT emit a
  right-shift token. v1 decision: on darwin the instruction source is **Caps
  Lock**. If the user selects Right Shift on darwin, `keyListener` logs a warning
  (native Right Shift needs the optional Swift recompile, keyCode 60) and falls
  back to Caps Lock. The UI may offer both, but **Caps Lock is the macOS
  default/recommended** instruction key. Right Shift works natively on Windows.
- Keep the binary-path resolution: 3 candidates (`process.resourcesPath/bin`,
  `app.getAppPath()/resources/bin`, `__dirname/../../resources/bin`),
  `fs.chmodSync(0o755)`, auto-restart only for `code !== 0 && code !== null` with
  a 2s delay + restarting guard, EPIPE swallow, `sendCommand` 500ms timeout +
  listener cleanup.

## 5. Why osascript, not CGEvent, on packaged macOS

In `clipboard.ts`, the darwin paste/copy path uses
`execFile('/usr/bin/osascript', ['-e', 'tell application "System Events" to
keystroke "v" using command down'])`. **This is the only reliable path.**
`CGEvent`-based key synthesis **drops silently when the app is packaged**
(signed/sandboxed Electron) — it works in dev and then mysteriously no-ops in the
`.dmg` build. Keep the osascript path and keep the comment explaining it. Do not
"optimize" it to CGEvent.

**`captureSelectedText` sequence is load-bearing — keep it EXACT:**
read+save current clipboard → write `''` → simulate Cmd/Ctrl+C →
**`sleep(150)`** (async settle; the clipboard write is not instantaneous) → read
→ **restore the saved clipboard** → return `null` if empty/whitespace. On
simulate failure, restore the clipboard and return the saved clipboard only when
`useClipboardFallback` is true.

`injectOutput` writes to the clipboard **FIRST** (so manual paste works even if
auto-paste fails), then simulates Cmd/Ctrl+V and swallows errors.

`useClipboardFallback` is **true only for instruction mode**, **false for
dictation**.

## 6. win32 SendKeys caveats (`clipboard.ts`)

On Windows, paste/copy is simulated via PowerShell `SendKeys`:

```
execFile('powershell', ['-NoProfile', '-Command',
  "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"])
```

- Use `^v` for paste, `^c` for copy. For COPY, send `^c` **first**, then read
  the clipboard (give the OS a beat to populate it).
- **Always pass `-NoProfile`** — a user's PowerShell profile can print banners,
  set strict mode, or hang, corrupting/blocking the command.
- `SendKeys` sends to the **currently focused window**, so the HUD/focus
  ordering matters (see §7 gotcha 1).
- `keyListener.sendCommand('PASTE'|'COPY')` is **darwin-only**; it
  rejects/no-ops on win32 (Windows paste goes through the clipboard + SendKeys
  path, not the helper).
- Windows has no Keychain — `safeStorage` uses **DPAPI**. No platform branch is
  needed in `keyStore.ts`; `safeStorage` handles both.

## 7. sessionManager gotchas (preserve verbatim)

1. **`showHUD()` fires BEFORE `captureSelection()`.** The osascript Cmd+C
   disrupts macOS window ordering, so selection capture is delayed
   `setTimeout(..., 50)`. Do not reorder these.
2. **`isProcessing = true` is set BEFORE the grace await** (prevents
   chain-expired re-entry processing the same session twice).
3. **Audio can arrive post-cancel.** `receiveAudio` checks the cancelled
   session; `isForeignSessionAudio` is **lenient** (absent `sessionId` is
   accepted). Don't tighten this — late chunks legitimately lack ids.
4. **Every `onSessionComplete?.()` is wrapped in try/catch** so a persistence
   error can't crash the pipeline.
5. **`cleanTranscript` strips trailing STT hallucinations** ("thank you",
   "thanks for watching", "please subscribe") via `WHISPER_SENTINELS_RE`. Keep
   the sentinel list.
6. **Two grace polls for late audio:** no-audio = 20 × 10ms = 200ms;
   instruction-audio = 10 × 50ms = 500ms. These timings are tuned; don't change
   them casually.
7. **Pure dictation NEVER hits the LLM** — `cleanTranscript` only. This is the
   speed + "raw by default" guarantee. `quote` flow is `'> ' + selectedText`,
   also no LLM.
8. **Pipeline is SEQUENTIAL** — the reference "fast path" is stripped. On LLM
   empty/refusal/error, fall back to the raw transcript with a formatting notice
   (`OUTPUT_FALLBACK`), never fail hard.
9. Use `maxTokens: 4096` and `timeoutMs: APP_CONFIG.transform.timeout_ms` for
   the LLM call; `REQUEST_TIMEOUT_MS` (15000) for single provider calls.

## 8. windowManager / HUD handshake gotchas

- `showHUD()` awaits a **readiness handshake**: the renderer calls
  `widgetReady()` (→ `IPC.WIDGET_READY` → `markHUDReady()` resolves
  `hudReadyPromise`). Without the handshake the HUD can show before React
  mounts and flash empty.
- Keep `showHUD`'s **double `cancelPendingHide()`** (once before the await, once
  after) — a hide scheduled during the await would otherwise fire after show.
- Keep `hideHUD`'s **220ms** teardown timeout (matches the `.animate-hud-exit`
  200ms + buffer). Tearing down early clips the exit animation.
- Keep `showInactive()` + `setAlwaysOnTop('floating')` + `moveTop()` ordering;
  the HUD must not steal focus from the app you're pasting into.
- Platform gating lives here: `type:'panel'`, `setVisibleOnAllWorkspaces`,
  `hiddenInset` title bar, `hasShadow:false` are **darwin-only**; win32 omits
  `type:'panel'` and uses a hidden/frameless window.

## 9. Stripped subsystems — DO NOT re-introduce

The reference (`unmute-dictation`) had these; they are intentionally **out of
scope**. Do not port them, do not create files for them:

- local whisper.cpp / faster-whisper STT (`whisper.ts`, `fasterWhisper.ts`)
- local LLM / llama (`localLLM.ts`)
- Cartesia / Sarvam / dual-whisper providers
- Cloudflare server-config fetch + the auth-token / deep-link / `open-url` flow
- quota, `featureFlags.ts`, `autoUpdater.ts`
- Hinglish + Quick-Chat prompts in `prompts.ts`
- the reference "fast path" in the session pipeline

The architecture stays extensible so **local providers can return later as just
another provider** (see §2) — but not in v1.

## 10. Build / native / CI rules

- **Use `npm`, never bun or yarn.** `electron-builder` native rebuild
  (`better-sqlite3`, `uiohook-napi`, `*.node`) depends on the npm/electron
  toolchain. `postinstall` runs `electron-builder install-app-deps`.
- **Never run `npm run dev` in CI / headless / non-interactive contexts.** It
  spawns native key listeners + windows and stays running forever (it does not
  exit), so it will **hang the job**. For verification in CI use
  `npm run typecheck` and `npm run build`. Only run `dev` on an interactive
  developer machine.
- `compile:native` (Swift helpers) is **macOS-only** and a no-op elsewhere; it
  runs automatically before `dev`/`build`/`dist` via the `pre*` scripts.
- **Cross-compiling is not supported** — build the macOS `.dmg` on macOS and the
  Windows NSIS installer on Windows.
- `ffmpeg.ts` must **skip any candidate path containing `app.asar${path.sep}`** —
  `existsSync` lies inside the asar and spawning throws `ENOTDIR`. Use the
  `.unpacked` location (`ffmpeg-static` is `asarUnpack`ed in `package.json`).
- Keep the **EPIPE swallow guards** at the top of `main.ts`
  (`process.stdout`/`process.stderr`) — broken pipes on quit otherwise crash the
  process.

## 11. Idioms to match

- EventEmitter managers; **singleton exports** (`export const fooManager = new
  FooManager()`).
- `console.log('[module] ...')` prefixes — match the reference per module:
  `[keyStore]`, `[clipboard]`, `[keyboard]`, `[groq:stt]`, `[openai:chat]`,
  `[openrouter:chat]`, `[error-log]`, `[audio]`, `[audio:vad]`, etc.
- Platform branch: `process.platform === 'darwin'` vs `'win32'`, with a
  win32-safe fallback (granted/no-op) for every macOS-specific path.
- Write **complete** code — no TODOs, no placeholders, no truncated functions.
- Monochrome black-glass UI only — no color accents (semantic states are
  white-alpha intensities). Use the classes from `renderer/styles/tokens.css`.

## 12. Quick sanity checklist before you commit

- [ ] No inlined IPC channel strings in `electron/**` (used `IPC.*`).
- [ ] No new cross-process type defined outside `shared/types.ts`.
- [ ] New provider: file + registry line + union id + pricing rows; no pipeline
      edits.
- [ ] AbortError re-thrown in any provider you touched.
- [ ] Any new keyboard state added to `resetState()`.
- [ ] Renderer `removeAllListeners` literals updated if you renamed a channel.
- [ ] `npm run typecheck` passes (both tsconfigs). Did NOT run `npm run dev` in CI.
- [ ] No stripped subsystem (§9) re-introduced.
