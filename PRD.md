# Maverick Voice v2 — Product Requirements Document

| | |
|---|---|
| **Product** | Maverick Voice |
| **Owner** | Malhar Ujawane ([@justmalhar](https://github.com/justmalhar)) |
| **App ID** | `com.justmalhar.maverickvoice` |
| **Platforms** | macOS **universal** (Apple Silicon + Intel, macOS 12+), Windows (x64), **Linux** (x64, AppImage + deb) |
| **Status** | v2 — full rewrite; `legacy/` is the v1 reference |
| **Document date** | 2026-07-10 |

---

## 1. Summary

Maverick Voice is a desktop app for **voice dictation** and **voice-driven
text editing**. Press a global hotkey, speak, and clean text lands at your
cursor in any app; with opt-in instruction mode, select text, tap Caps Lock,
and speak a transform. It is **bring-your-own-key** and **provider-agnostic**
(Groq Whisper for STT; OpenAI / OpenRouter / any OpenAI-compatible endpoint
for transforms), with no backend, no accounts, and no telemetry.

**v2 is a rewrite, not a redesign.** The feature set, flows, and overall UI of
v1 are preserved. What changes:

1. **Universal platform support** — one universal macOS binary (arm64 + x64,
   macOS 12+) with hotkey and permission flows that work on every Mac (v1
   shipped arm64-only and failed silently on non-Apple keyboards and missing
   TCC grants — see `LEGACY-ISSUES.md` §1), plus Windows 10/11 x64 and
   **Linux x64** (new in v2; v1 had no Linux path at all).
2. **Smoothness** — the choppiness of v1 is eliminated by design: compositor-
   only animation, no blocking I/O on the hot path, event-driven session flow
   (no polling/magic sleeps). See `LEGACY-ISSUES.md` §2.
3. **A real light/dark theme system** — intent-named design tokens, light /
   dark / system modes, consistent across dashboard and HUD (v1's light mode
   existed but leaked hardcoded dark values everywhere).
4. **Manageable codebase** — modular atomic files, no god classes, dead code
   deleted, duplicated plumbing collapsed (see `SYSTEM-DESIGN.md`).

### 1.1 Problem (unchanged from v1)

Typing is the bottleneck between thought and text. Existing dictation tools
lock users into one cloud vendor, silently "auto-format" speech, or cannot
edit existing text by voice. Power users want raw accurate dictation by
default, on-demand voice editing, and control over which provider their audio
and text reach.

### 1.2 Positioning

Fast, private, BYO-key dictation sold as a **$9.99 one-time purchase** (never
subscription). Monochrome glass aesthetic, now in both light and dark.

---

## 2. Goals & non-goals

### 2.1 Goals (v2)

- **Universality:** one macOS build that installs and works on any Mac
  (Apple Silicon or Intel, macOS 12+), plus Windows 10/11 x64 and Linux x64
  (AppImage + deb; full support on X11, documented degradations on Wayland —
  see §4.6).
- **Reliability on every machine:** permission preflight that fails *loudly*
  with guidance instead of dead hotkeys; hotkey defaults that adapt to the
  keyboard actually present (Fn/Globe only when available).
- Sub-2-second pure dictation (STT only), p50, short clips.
- **Perceived smoothness:** HUD animations at 60 fps (compositor-only);
  dictation start latency < 100 ms from keypress to recording; no main-thread
  stalls > 16 ms from persistence or logging.
- Feature parity with v1: dictation, opt-in instruction, chaining, cancel/undo,
  three activation modes, Dictionary + Snippets, opt-in AI auto-format with
  app-aware profiles, combo hotkeys, usage/cost tracking, onboarding, history
  with retry, tray, sound feedback, widget positioning.
- Light / dark / system theme, consistent everywhere.
- Provider-agnostic registry (new provider = 1 file + 1 registry line).
- Encrypted BYO keys; zero accounts; zero telemetry; transcripts never logged.

### 2.2 Non-goals (v2)

- Local/offline models (whisper.cpp, local LLM) — architecture-ready, not built.
- Real-time streaming captions; mobile/web clients; team/cloud sync.
- Custom prompt-authoring UI, macros, scripting.
- Windows arm64 and Linux arm64 (revisit on demand).
- Native Wayland global-hotkey injection beyond the documented degradations
  (§4.6) — the Wayland security model forbids most of it by design.

---

## 3. Personas (unchanged)

- **P1 "The Builder"** — staff engineer; dictates commit messages, PR
  descriptions, Slack replies; voice-edits them; points base URL at a
  self-hosted gateway. Now possibly on an **Intel MacBook Pro** — must work.
- **P2 "The Writer"** — long-form writer in Notion/Docs/Obsidian; wants clean
  dictation without auto-mangling and quick voice rewrites; relies on
  onboarding; may prefer **light mode**.
- **P3 "Accessibility-first"** — voice as primary input (RSI/motor); needs
  reliable global hotkeys, push-to-talk, dependable paste, Escape-to-cancel,
  and now **reduced-motion support and screen-reader announcements** (v1 had
  neither).

---

## 4. Core flows (parity with v1, with fixes)

### 4.1 Dictation
1. Press the dictation key (default: Fn/Globe on Apple keyboards *when
   available*, else Right Option; Right Ctrl on Windows and Linux; custom
   modifier combos supported).
2. HUD pill appears on the **display where the user is working** (v1: always
   primary). Mic records; long clips chunk on VAD silence.
3. On stop: STT (Groq Whisper, Dictionary vocabulary hint) → `cleanTranscript`
   → Dictionary → Snippets → optional AI auto-format (app-aware profile) →
   paste at cursor.
4. Pure dictation never touches the LLM unless auto-format is on.

### 4.2 Instruction (opt-in, Caps Lock)
Unchanged from v1, with two fixes: selection capture is bound to the session
that requested it (no cross-session leakage), and clipboard save/restore
preserves non-text clipboard content where the platform allows.

### 4.3 Chaining
Unchanged (dictate → chain window → instruct), but the chain-expiry →
processing handoff is **event-driven on audio arrival** — no grace polls.

### 4.4 Flow typing
`dictation | transform | context | instruction | quote` as in v1, with one
behavior change: **a pre-existing selection no longer silently converts plain
dictation into `quote` flow** (v1 issue #6). Quote flow requires explicit
intent (instruction key with selection and no spoken command).

### 4.5 Dictionary / Snippets / Auto-format / App profiles
Identical semantics to v1 (order: clean → Dictionary → Snippets → optional
auto-format; longest-match-first; case-insensitive; STT bias hint capped
~200 chars; profiles: email / chat-ai / code-editor / messaging / notes /
default). Dictionary/Snippet edits persist immediately (v1 lost edits made
within 400 ms of switching tabs).

### 4.6 Linux behavior (new)

- **X11 (full support):** global hotkeys via uiohook, paste via clipboard +
  synthesized Ctrl+V (`xdotool`), selection capture via the same round-trip.
  Feature parity with Windows.
- **Wayland (graceful degradation):** global key hooks and synthetic
  keystrokes are blocked by the compositor security model. The app detects
  Wayland at launch and (a) still offers hotkeys where the portal/compositor
  allows, (b) defaults output mode to **copy-to-clipboard** with a clear
  notice when paste injection is unavailable, and (c) explains the situation
  in onboarding/Settings instead of failing silently (the v1 cardinal sin).
- Key storage: `safeStorage` via libsecret (GNOME Keyring / KWallet); if no
  secret service is available the app says so and asks before storing keys
  with reduced protection.
- No TCC-style permissions; mic comes from PipeWire/PulseAudio normally.

### 4.7 Cancel / undo / retry
- Escape cancels — registered **only while a session is active**, and v2 uses
  the key listener (not `globalShortcut`) so other apps' Escape usage isn't
  swallowed when our HUD isn't the concern.
- Undo-cancel window ~3 s (unchanged).
- **Retry never destroys data**: a failed retry keeps the original transcript
  and output intact (v1 nulled them).

---

## 5. Functional requirements

Parity requirements F1–F19 from the v1 PRD carry over verbatim (global
hotkeys, activation modes, providers, keys, chunked VAD transcription, local
history, usage/cost, onboarding, output modes, permissions, auto-format,
Dictionary, Snippets), plus v1's later deltas (app-aware formatting profiles,
combo dictation bindings). New/changed in v2:

| ID | Requirement |
|----|-------------|
| F20 | macOS build is a **universal binary** (arm64 + x64), minimum macOS 12, one DMG. |
| F21 | **Permission preflight**: on launch and in Settings, detect mic / Accessibility / Input-Monitoring / Automation state via API checks (`AXIsProcessTrusted`, `IOHIDCheckAccess`, mic status) and surface a blocking, actionable banner when the hotkey pipeline cannot work. Never fail silently. |
| F22 | **Hotkey capability detection**: default to Fn/Globe only when the hardware reports it; otherwise default Right Option and say so in onboarding. Detect "Globe key assigned to macOS dictation" conflict and link the correct System Settings pane (Ventura+ URLs). |
| F23 | **Theme**: light / dark / system, persisted, applied to dashboard *and* HUD, all colors sourced from intent-named tokens; `prefers-reduced-motion` respected globally. |
| F24 | HUD appears on the display containing the mouse cursor / focused window. |
| F25 | Transcripts and outputs are **never written to logs**. |
| F26 | All persistence (sessions, usage, settings, audio scratch) is async and off the recording/paste hot path. |
| F27 | Session lifecycle is event-driven (acks/handshakes); no polling loops or load-bearing sleeps. |
| F28 | Accessibility: HUD state changes announced via `aria-live`; all interactive controls labeled and keyboard-reachable (no hover-only reveals). |
| F29 | Auto-update feed configured and working (R2 generic provider), with a version guard so republishing an old ref can't roll users back. |
| F30 | Linux x64 support: AppImage + deb; full hotkey/paste parity on X11; Wayland detected with graceful copy-to-clipboard degradation and explicit UI messaging (never silent failure). |
| F31 | **Pause media during dictation** (opt-in, default off): when dictation starts, pause currently-playing system media; when the session ends (output/cancel/error), resume only what we paused. macOS: scriptable players (Music, Spotify) via osascript; Linux: MPRIS via `playerctl`; Windows: WinRT media-session best-effort. Never blocks recording start — pause/resume run fire-and-forget. |

---

## 6. Success metrics

| Metric | Target |
|--------|--------|
| Installs & runs on Intel Mac + Apple Silicon | 100 % of macOS 12+ machines |
| Installs & runs on Linux x64 | AppImage on mainstream distros; X11 full parity; Wayland degradations surfaced in UI |
| Pure-dictation latency (speak-stop → paste) | < 2 s p50 short clips |
| Keypress → recording start | < 100 ms |
| HUD animation frame rate | 60 fps, no dropped frames during record/process/output |
| Main-process stalls from persistence/logging | 0 > 16 ms on the hot path |
| Paste reliability | > 99 % |
| Hotkey dead-on-arrival rate | 0 (permission preflight surfaces every blocker) |
| Time-to-first-dictation | < 3 min fresh install |
| Privacy | 0 bytes to any host except configured providers; 0 transcripts in logs |
| Largest source file | < 400 lines (see SYSTEM-DESIGN modularity rules) |

---

## 7. UX & design requirements

Summarized here; authoritative in `DESIGN.md`.

- Monochrome glass language retained, expressed through **intent-named tokens**
  (`--surface-*`, `--ink-*`, `--stroke-*`, `--glow-*`) with first-class light
  and dark values — never palette-named (`--white-24`) tokens.
- Liquid-glass pill HUD, bottom-anchored above the Dock (80 px clearance),
  center or right. **One persistent pill that morphs** between recording /
  processing / output states — no DOM swaps, no flicker.
- All motion is `transform`/`opacity` only; every animation gated on
  `prefers-reduced-motion`.
- Desktop-only layout; windows resize gracefully; native fonts; no external
  font loads.

---

## 8. Scope: v2 vs future

**v2:** everything in §5 on macOS universal + Windows x64.

**Future (architecture-ready, out of scope):** local/offline providers
(whisper.cpp, llama.cpp) as registry entries; additional cloud providers;
Linux; custom prompt templates; Windows code-signing.

---

## 9. Constraints & assumptions

- Users supply their own provider keys; app is a one-time purchase, no backend.
- Paste is simulated via clipboard + synthesized keystroke; previous clipboard
  is saved and restored.
- Pricing tables remain hardcoded local constants (estimates, will drift).
- Instruction key is Caps Lock on both platforms; Right Shift stays removed.
- Build: macOS DMG built on macOS (universal via lipo'd helpers + electron-builder
  universal target); Windows NSIS on Windows; Linux AppImage + deb on Linux CI.
  npm toolchain (electron-builder compatibility), single lockfile.
