# Legacy Issues — Maverick Voice v1 (`legacy/`)

Defect and tech-debt inventory of the v1 codebase, compiled from a full audit
(main process, renderer, native helpers, build/packaging) on 2026-07-10.
**Every item here is a "do not carry over" rule for the v2 rewrite.** The two
user-facing complaints — *choppy* and *doesn't work on all Macs* — each trace
to specific root causes below.

---

## 1. Why it doesn't work on all Macs

The shipped app is properly **signed and notarized** (verified: Notarized
Developer ID R6G234T379) — Gatekeeper is *not* the problem. Architecture is.

| # | Issue | Evidence |
|---|-------|----------|
| M1 | **DMG is arm64-only.** Intel Macs cannot launch the app at all. | `legacy/package.json` `build.mac.target.arch: ["arm64"]` |
| M2 | **Swift helpers compiled host-arch with no `-target`.** `swiftc -O` inherits the M4 build machine's arch and SDK minimum — no universal lipo step, no deployment-target pin. Even a universal Electron shell would ship an arm64-only `globe-listener` that dies with *Bad CPU type* on Intel. | `legacy/scripts/build-globe-listener.js:34`, `build-key-poster.js:34`; `file resources/bin/*` → thin arm64 |
| M3 | **Native node modules rebuilt for host arch only.** `postinstall: electron-builder install-app-deps` builds better-sqlite3 for the build machine; ffmpeg-static downloads exactly one binary keyed to host `process.arch` at install time and cannot be lipo'd by electron-builder. | `legacy/package.json:19`; `node_modules/ffmpeg-static/install.js` |
| M4 | **Committed binaries + mtime-skip = non-deterministic arch.** `resources/bin/*` live in git; the build scripts skip recompile when binary mtime > source mtime, so which arch ships depends on checkout order. | `legacy/scripts/build-*.js:21-28` |
| M5 | **Fn/Globe default hotkey is dead on many Macs.** External/non-Apple keyboards and older Macs don't report `NSEvent.ModifierFlags.function`; macOS itself owns the Globe key. No conflict detection — the default binding silently does nothing. | `legacy/electron/main.ts:121`, `keyListener.ts:48` |
| M6 | **No permission health-check → silent hotkey death.** `NSEvent.addGlobalMonitorForEvents` receives nothing without Input Monitoring; no `AXIsProcessTrusted()`/`IOHIDCheckAccess` preflight anywhere. TCC grants reset on every re-sign identity change ("worked on my machine"). | `legacy/native/macos/globe-listener.swift:132` |
| M7 | **Paste needs TWO TCC grants but only one is checked.** Accessibility is prompted; the Automation/Apple-Events grant for `osascript` System Events is not — deny it once and paste fails silently forever. | `legacy/electron/main.ts:684-694` |
| M8 | **Pre-Ventura System Settings deep links.** `x-apple.systempreferences...Privacy_*` anchors don't reliably open the right pane on macOS 13+. | `legacy/electron/main.ts:698,703` |
| M9 | **HUD always on primary display.** Multi-monitor users dictating on a secondary display see the pill on the wrong screen. | `legacy/electron/windowManager.ts:153` |
| M10 | **Updater feed is placeholder-ware.** `https://REPLACE_WITH_YOUR_R2_PUBLIC_URL/releases` in both `updater.ts:23` and `package.json.publish.url` — no Mac ever gets updates; doomed check on every launch. | |
| M11 | **No minimum-OS pin.** `LSMinimumSystemVersion` is whatever the host toolchain defaults to — undefined behavior on older macOS. | |
| M12 | Release pipeline: single self-hosted runner, cert only in its Keychain (bus factor 1); a local `dist:mac` on any other machine produces an adhoc-signed DMG Gatekeeper blocks; `workflow_dispatch` from any ref can overwrite the updater manifest with no version guard; mac/win jobs last-writer-wins on `downloads.json`. | `legacy/.github/workflows/release.yml` |

**v2 rules:** universal binary (`arch: ["universal"]`), lipo any Swift helper
with explicit `-target {arm64,x86_64}-apple-macos12`, eliminate arch-fragile
deps (see §4), permission preflight with loud in-app guidance, cursor-display
HUD positioning, pin minimum macOS, fix or remove the updater feed.

---

## 2. Why it feels choppy

### HUD / renderer (the jank you see)

| # | Issue | Evidence |
|---|-------|----------|
| C1 | **Infinite `box-shadow` keyframes on every HUD state** (`mv-radiate-*`, `mv-dot-pulse`, `mv-output-flash`) — paint work every frame, never compositor-only. Primary animation jank source. | `legacy/renderer/styles/tokens.css:472-521` |
| C2 | **`backdrop-filter: blur(40px) saturate(180%)` on a transparent always-on-top window.** On a transparent BrowserWindow the filter samples empty web content — near-pure GPU cost, no visual payoff (bg is already 88 % opaque). Classic Electron HUD jank. Same 60px blur on *every* dashboard card, and per-row blur in History/Dictionary/Snippets lists. | `tokens.css:334-341,344-351`; `History.tsx:149` etc. |
| C3 | **Stuck exit-animation flag makes the HUD render invisible.** Re-entry within the 200 ms exit window cancels the reset timeout; the new pill renders with `animate-hud-exit` (`fill: both` → opacity 0). This *is* the "HUD flicker". | `legacy/renderer/widget/Widget.tsx:64-75` |
| C4 | Each HUD state is a physically different pill div — transitions are abrupt DOM swaps, no morph. A 250-line `<style>` string remounts on every show, forcing full style recalc; 1 s `setInterval` re-renders the whole widget subtree (no memo). | `Widget.tsx:78-89,115,118-241` |
| C5 | **`key={activeTab}` remounts the whole tab on every nav click** — Settings refires ~18 IPC round-trips, Home rescans all sessions to count words. This is the "slow transitions" complaint in the dashboard. | `legacy/renderer/app/App.tsx:165` |
| C6 | New `AudioContext` (+ oscillators) constructed per click sound; Waveform canvas/rAF torn down and rebuilt on mode change (color in effect deps). | `WidgetApp.tsx:16-53`, `Waveform.tsx:85` |
| C7 | 200 ms CSS exit hand-coupled to a 220 ms main-process `setTimeout` — cross-process magic-number coupling; drift = hidden mid-animation or dead frame. | `Widget.tsx:26` ↔ `windowManager.ts:281-286` |

### Main process (the jank you feel as latency/stutter)

| # | Issue | Evidence |
|---|-------|----------|
| C8 | **Sync `fs.writeFileSync` per audio chunk mid-recording, plus a full prune scan (`readdirSync` + per-file `statSync`) after every write.** Final chunk saved twice = two sync writes + two prune scans at stop time. All on the main process while dictating. Worst latency source. | `legacy/electron/audio.ts:28-39,138-160`; `sessionManager.ts:539,592-597` |
| C9 | **Sync SQLite on the hot path**: `saveSession` runs 3-statement `cleanupSessions()` after every insert (during the HUD "done" animation); usage upserts run *inside* the transcribe/complete latency path; History tab runs a sync SELECT on the main thread. | `db.ts:141,201-215`; providers; `main.ts:620` |
| C10 | **Every paste spawns `osascript` (~80-200 ms).** The Swift helper's CGEvent fast path (~5 ms, implemented, acked) is **never called** — dead code. Plus a hard `sleep(150)` clipboard settle + 50 ms delay at every session start. | `clipboard.ts:41,97`; `keyListener.ts:520`; `sessionManager.ts:448` |
| C11 | **Three polling loops padding every session** (20×10 ms audio wait, 10×50 ms instruction wait, 20×50 ms chunk-count wait) — all papering over one root race: `chain-expired` fires before audio IPC arrives. | `sessionManager.ts:777-780,803-809,857-860`; root: `keyboard.ts:398-404` + `main.ts:311` |
| C12 | Audio buffers copied twice per session (structured-clone + `Buffer.from`); multi-MB for long dictations. | `main.ts:542,550,568` |
| C13 | Tray pulse: 120 ms `setInterval` native `setImage` calls for the entire recording; identical frame set generated twice. | `tray.ts:182-216` |
| C14 | 30-60 `console.log` lines per session including `JSON.stringify` of full transcripts — sync pipe writes that pad the pipeline **and leak dictated text into logs** (also a privacy issue). | `sessionManager.ts:907,916,1063` |
| C15 | `isProcessing` hard-rejects a new dictation for up to the full 15 s pipeline timeout instead of queueing. | `sessionManager.ts:387-394` |

**v2 rules:** compositor-only animations (`transform`/`opacity`), no
backdrop-filter on the transparent HUD window, one persistent morphing pill,
all persistence async and off the hot path (buffer audio in memory, write once
at stop, prune on idle), event-driven audio handshake instead of polls, helper
CGEvent paste with osascript fallback, batch/transfer IPC buffers once, no
transcript logging.

---

## 3. Correctness bugs (fix-by-design in v2)

1. **Retry data loss** — a failed retry (`no key`, offline, audio pruned)
   overwrites the session's previously-good transcript/output with `null` +
   `error`. `main.ts:483-488`.
2. **Chunk transcriptions uncancellable & silently lossy** — chunks start
   before `abortController` exists (Escape never aborts them); a failed middle
   chunk becomes an empty string → silent sentence gap in pasted output.
   `sessionManager.ts:606,618-628,881-885`.
3. **Recorder stop/emit race** — `stopRecording` during a VAD chunk emit
   early-returns and never sends the final chunk → main waits forever, HUD
   stuck on "Thinking". Also `stopRecording`'s promise settles only in
   `onstop`; if the mic is yanked it never settles — permanent hang, no
   timeout. `useAudioRecorder.ts:443-465,481-548`.
4. **~100 lines of duplicated chunk-finalization logic** (`flushRecorder` vs
   `stopRecording.onstop`) with subtly different guards. One flush path in v2.
5. **Selection capture races the session** — resolves ~200 ms later into
   `this.currentSession` (not the session it started for); fast cancel+restart
   attributes the old selection to the new session. `sessionManager.ts:1447-1463`.
6. **Any pre-existing selection hijacks dictation into `quote` flow**, pasting
   `> selection` over the user's selection — easy to hit accidentally.
   `sessionManager.ts:1476`.
7. **Clipboard destruction dance** — save→clear→Cmd+C→sleep(150)→restore
   races concurrent copies, pollutes clipboard-manager history every dictation,
   and loses non-text clipboard content (images/files). `clipboard.ts:87-123`.
8. **Caps Lock LED-pair heuristic can desync permanently** — assumes exactly
   two tokens per press; one odd emission inverts every subsequent press until
   restart. `keyListener.ts:320-328`.
9. **Helper stdout reply matching cross-talks** — per-command listeners split
   chunks with no partial-line buffer; concurrent `FRONTAPP` requests can both
   resolve on either reply. Auto-restart `restarting` latch is one-way — any
   stop/start cycle permanently disables crash recovery. `keyListener.ts:479-489,552`.
10. **`isLLMRefusal` false positives** — matches "I can't help feeling…" and
    discards a correct transform. `sessionManager.ts:43`.
11. **Global Escape steals the system-wide Escape key** from every app during
    recording/processing. `main.ts:321`.
12. **Widget listener teardown uses `removeAllListeners`** — nukes every
    subscriber on the channel, not just this component's. Preload should return
    per-subscription unsubscribe functions.
13. **Debounced Dictionary/Snippets persist is cancelled (not flushed) on
    unmount** + tabs remount on nav → edits within 400 ms of switching tabs
    silently lost. `Dictionary.tsx:40-53`, `Snippets.tsx:40-51`.
14. Sound-feedback toggle read once at widget mount (module-level mutable) —
    changing it requires an app restart. `WidgetApp.tsx:9-14`.
15. Second-instance race: on lock failure `app.quit()` is called but module
    top-level continues — `new Store()` + migrations can write `config.json`
    concurrently with the primary instance. `main.ts:100-103`.
16. localStorage onboarding key defined in three places (one raw literal);
    lenient absent-sessionId audio accepted cross-session; `db` used before
    null-check; `getActivationMode()` missing `.catch`; uncleaned `setTimeout`s.
17. **Magic-number races throughout**: 50 ms selection delay, 150 ms clipboard
    settle, 220 ms hide timer, 200 ms/500 ms/1 s grace polls — each encodes a
    race that v2 must make event-driven (acks/handshakes, not sleeps).

---

## 4. Architecture & dead-weight debt

| # | Issue |
|---|-------|
| A1 | **God files**: `sessionManager.ts` 1,492 lines (`processSession()` alone is 373); `main.ts` 940 (~60 IPC handlers inline); `Settings.tsx` 1,257; `Onboarding.tsx` 642. |
| A2 | **~450 lines of copy-pasted provider plumbing** — `withTimeout`, `normalizeBaseUrl`, undici Agent, `complete()`, `testKey()` near-identical across 3 LLM files. One OpenAI-compatible factory replaces them. |
| A3 | **Dead code shipped**: `ffmpeg.ts` + `ffmpeg-static` (zero callers, ~70 MB asarUnpacked); `key-poster.swift` + build script + shipped binary (never spawned); `sendCommand('PASTE'/'COPY')` fast path (never called); `Usage.tsx`/`Privacy.tsx`/`Voice.tsx` (432 lines, imported by nothing); `getRecentErrors`, `setChainWindow`, `listTranscriptionProviders` (no callers); uiohook-napi mac prebuilds packaged but only loaded on win32. |
| A4 | Dual keyboard-config plumbing (`keyboardManager` + `keyListener` both store key bindings; every setter updates both + two store keys). One owner in v2. |
| A5 | Bidirectional coupling: sessionManager exposes 5 mutable callback slots wired by main.ts while also directly importing windowManager/tray; hide-timers smeared across two modules (the double `cancelPendingHide()` "defense in depth"). |
| A6 | Timeout policy encoded 4× independently (config ×2, provider-internal, session-level abort) — all 15 s, stacking. |
| A7 | Two lockfiles (`package-lock.json` + `bun.lock`) drifting; Python/node-gyp pin hack lives only on the self-hosted runner; `externalizeDepsPlugin` exclude-list is an ESM interop landmine documented in its own comment. |
| A8 | Hardcoded pricing tables silently drift (self-acknowledged); `disable-library-validation` entitlement kept for dylibs that no longer exist. |
| A9 | **Renderer duplication**: 2 divergent `Toggle`s, 3 `ProviderGlyph`s, 4 `dictationKeyLabel`s, 4 `LoadingDots`, 2 key-entry cards, per-file `PageHeader`/empty-states, 3 `IS_MAC` regexes; 103-entry language table inline in Settings. |
| A10 | **Theming leaks**: light theme exists (`theme.ts` + two-theme tokens) but sidebar hardcodes `#0a0a0a`, light-mode tokens invert semantics (`--mv-white-24` resolves to *black*-alpha), dark-tuned rgba shadows scattered in JSX, white knob invisible on light track, `stroke="#000"` hardcoded, two competing page-bg values, Tailwind `@theme` mirror incomplete → two parallel styling systems. |
| A11 | **Accessibility**: hover-only-revealed action buttons (keyboard users tab onto invisible controls), unlabeled selects/toggles, `Segmented` without radiogroup semantics, no `aria-live` on the HUD, zero `prefers-reduced-motion` handling despite ~15 infinite animations. |

---

## 5. What v1 got right (carry these over)

- Provider registry pattern (new provider = 1 file + 1 registry line) and the
  caller-injects-keys / AbortError-rethrows / exact-model-string invariants.
- Single source of truth for IPC channel names (`shared/ipc.ts`) and
  cross-process types (`shared/types.ts`).
- Platform seam discipline: `keyListener` normalizes to logical key events so
  everything downstream is platform-unaware.
- "Raw by default" pipeline order: STT → clean → Dictionary → Snippets →
  opt-in auto-format; graceful LLM fallback that never blocks the paste.
- Keyboard state-machine semantics (debounce gates START never STOP,
  `resetState()` discipline, Caps-Lock-only instruction, chain window).
- `safeStorage` per-provider key vault; local-only history; no telemetry.
- Waveform rAF loop (DPR-scaled, no per-frame state updates) — the one piece
  of rendering done right.
- Signed + notarized release pipeline (keep; make it reproducible).
- Tuned prompts, app-profile detection table, dictionary STT-bias hint.
