# Maverick Voice

![Maverick Voice](https://raw.githubusercontent.com/Justmalhar/maverick-voice/main/demo/demo.png)

**Speak. It types. Speak again. It edits.**

Maverick Voice is a cross-platform (macOS + Windows) voice dictation and
voice-driven text-editing desktop app. Press a global hotkey, talk, and clean
text lands at your cursor in any app. Optionally turn on instruction mode,
select some text, tap the instruction key, and *tell* it what to do — "make
this a bullet list", "translate to French", "turn this into a commit message" —
and the rewritten text replaces your selection.

> **Raw by default.** Pure dictation pastes what you said, lightly cleaned in
> code — it never rewrites or "formats" your words. Transforms happen *only* on
> demand, through a spoken instruction. The LLM is touched only when you
> explicitly instruct it — or when you opt in to the AI auto-format pass, which
> is off by default.

Maverick Voice is **bring-your-own-key (BYO)** and **provider-agnostic**:
- **Speech-to-text:** [Groq](https://groq.com) Whisper (`whisper-large-v3-turbo`).
- **Transforms:** [OpenAI](https://platform.openai.com) or
  [OpenRouter](https://openrouter.ai) — or **any** OpenAI-compatible
  `chat/completions` endpoint via a configurable base URL.

No accounts. No backend. No telemetry. Your keys are encrypted at rest with
the OS keychain (Keychain on macOS, DPAPI on Windows); your transcripts and
history live in a local SQLite database on your machine.

---

## Features

- **Dictation** — hold/tap the dictation key, speak, and the transcript is
  pasted at your cursor in any app. Speech-to-text only, no LLM round-trip.
- **Instruction** *(opt-in, off by default)* — enable it in **Settings →
  Advanced**, select text anywhere, tap the instruction key (**Caps Lock**),
  speak a command, and the transformed text replaces your selection.
- **Chaining** — dictate, then instruct (or vice-versa) in one continuous flow:
  speak content, then within the chain window speak an instruction to shape it
  (requires instruction mode enabled).
- **AI Auto-Format** *(opt-in, off by default)* — toggle in **Settings** to run
  a mechanics-only LLM pass (grammar, punctuation, capitalization, paragraphs)
  over raw dictation before it pastes. Falls back to the unformatted transcript
  on any LLM failure — it never blocks the paste.
- **Dictionary** — define spoken-word `from → to` corrections (e.g. "mavrik" →
  "Maverick"). Applied post-transcription **and** fed to Groq Whisper as a
  ~200-char vocabulary prompt hint so the STT model biases toward your spellings.
- **Snippets** — map a spoken `trigger` to a longer expansion (e.g. "my
  linkedin" → a URL). Case-insensitive, longest-trigger-first, punctuation-tolerant.
- **Provider-agnostic** — Groq for STT; OpenAI / OpenRouter / any
  OpenAI-compatible endpoint for transforms. Swappable per the registry
  pattern. Point the base URL at a self-hosted endpoint and it just works.
- **Chunked transcription with VAD** — long recordings are split on detected
  silence and transcribed in parallel, then stitched in order.
- **Cross-platform** — macOS (Apple Silicon) and Windows (x64).
- **Local & private** — audio scratch files and session history stay on your
  machine (SQLite + local files). The only thing that leaves your device is the
  audio sent to your STT provider and the text sent to your LLM provider, both
  authenticated with **your** keys.
- **Usage tracking** — per-provider cost estimation for today / this month /
  all time, computed from local pricing tables.
- **Black-glass UI** — pure monochrome 3D glassmorphism: liquid-glass pill HUD,
  raised glass buttons, springy recording/processing/output animations.

## How it works

```
hotkey press → record mic → transcribe (Groq Whisper) → clean in code
  → dictionary replacements → snippet expansion → paste at cursor
       ├─ + optional AI auto-format pass (if enabled)
       └─ + LLM transform only if you gave an instruction
```

A platform key listener watches the global hotkeys (a compiled Swift helper on
macOS; `uiohook-napi` on Windows). Audio is captured in-app, transcribed via
your STT provider, optionally transformed by your LLM provider, and the result
is delivered to your cursor through the clipboard + synthesized paste.

---

## Platforms

| | macOS | Windows |
|---|---|---|
| **Architecture** | Apple Silicon (arm64) | x64 |
| **Minimum OS** | macOS 12 Monterey | Windows 10 / 11 |
| **Installer** | `.dmg` | NSIS `.exe` |
| **Dictation key** | Fn / Globe *(default)* or Right Option | Right Ctrl *(default)* or Right Alt |
| **Instruction key** | Caps Lock | Caps Lock |
| **Global key listener** | Swift helper (compiled at build time) | `uiohook-napi` |
| **Clipboard / paste** | `osascript` + System Events | PowerShell `SendKeys` |
| **Key storage** | macOS Keychain (via `safeStorage`) | Windows DPAPI (via `safeStorage`) |
| **Permissions required** | Microphone, Accessibility, Input Monitoring | Microphone (OS prompt on first use) |
| **Cross-compile** | Build on macOS | Build on Windows |

> Linux is not currently supported — the Swift native helper and `osascript` paste path are macOS-only, and the Windows path relies on `uiohook-napi` + PowerShell. A Linux port would require replacing both seams.

---

## Requirements

- **macOS** (Apple Silicon, arm64) or **Windows** (x64)
- [Node.js](https://nodejs.org) 18+
- **npm** (not bun/yarn — `electron-builder` native rebuild compatibility)
- macOS only: **Xcode Command Line Tools** (`xcode-select --install`) to
  compile the Swift global-key helper
- Provider API keys (all free to obtain):
  - **Groq** (STT, required) — <https://console.groq.com/keys>
  - **OpenAI** (LLM, optional) — <https://platform.openai.com/api-keys>
  - **OpenRouter** (LLM, optional) — <https://openrouter.ai/keys>

You need a Groq key for dictation. You need at least one LLM key (OpenAI **or**
OpenRouter) for instructions / transforms.

## Quick start

```bash
git clone <your-fork-url> maverick-voice && cd maverick-voice
npm install          # also runs electron-builder install-app-deps (native rebuild)
npm run dev          # compiles native helpers (macOS), then launches the app
```

On first launch the onboarding flow walks you through:

1. **Provider keys** — paste your Groq key (and an OpenAI/OpenRouter key for
   transforms). Each key is validated against the provider and stored encrypted.
2. **Permissions** — grant the macOS permissions when prompted (auto-granted on
   Windows; see below).
3. **Shortcuts** — confirm your dictation/instruction keys and activation mode.

Then press your dictation key and start talking.

## API key setup

Keys are entered in **Settings → Provider keys** (one card per provider). Each
key is validated against the provider's `/models` endpoint and stored encrypted
via Electron `safeStorage`:

| Provider | Used for | Get a key | Default model |
|----------|----------|-----------|---------------|
| **Groq** | Speech-to-text | <https://console.groq.com/keys> | `whisper-large-v3-turbo` |
| **OpenAI** | LLM transforms | <https://platform.openai.com/api-keys> | `gpt-4o-mini` |
| **OpenRouter** | LLM transforms | <https://openrouter.ai/keys> | `openai/gpt-4o-mini` |

The OpenAI and OpenRouter cards also let you pick the **model** and override the
**base URL** — set the base URL to any OpenAI-compatible `chat/completions`
endpoint (a self-hosted gateway, a proxy, an Azure-compatible host) and Maverick
Voice will use it. The Groq card lets you pick the STT model and language hint.

### Dev-mode `.env` seed (optional)

For local development you can seed keys from a `.env` file (copy `.env.example`
to `.env`). These are a **read-only** fallback: if no encrypted key is stored
for a provider, `keyStore` seeds from the matching variable. They are never
written back to disk and `.env` is gitignored.

```dotenv
GROQ_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
```

## Hotkeys

| Action | macOS | Windows | Notes |
|--------|-------|---------|-------|
| **Dictate** | **Fn (Globe)** *(default)* or **Right Option** | **Right Ctrl** *(default)* or **Right Alt** | Configurable in Settings |
| **Instruct** | **Caps Lock** | **Caps Lock** | *Opt-in (off by default)* — enable in Settings → Advanced. Select text first, then tap and speak the command |
| **Chain** | dictate → (within the chain window) instruct | same | Speak content, then shape it without releasing the flow (requires instruction mode) |
| **Cancel** | **Escape** | **Escape** | Cancels the current recording / processing |

> **Instruction mode is opt-in and off by default** — turn it on in **Settings
> → Advanced**. The instruction key is **Caps Lock** on both platforms (Right
> Shift was removed entirely: it collided with system shortcuts and fired during
> Shift+Enter). Caps Lock triggers on key-down only — on macOS the LED-toggle
> pair is collapsed to one event; on Windows typematic auto-repeat is suppressed.

### Activation modes

Set in **Settings → Keyboard Shortcuts**:

- **tap-toggle** *(default)* — tap to start recording, tap again to stop.
- **push-to-talk** — hold to record, release to stop.
- **double-tap-push** — double-tap to lock recording on, or hold to push-to-talk.

## Permissions

### macOS

Maverick Voice requires three permissions, all prompted on first use and
manageable from **Settings → Permissions** and **System Settings → Privacy &
Security**:

- **Microphone** — to record your voice.
- **Accessibility** — to paste text and read your selection (via System Events).
- **Input Monitoring** — for the global dictation/instruction hotkeys.

If the dictation key (Fn/Globe) is captured by the system, **Settings → Keyboard
Shortcuts** links to **System Settings → Keyboard** so you can free it up.

### Windows

No special privacy permissions are required. The microphone is requested through
the standard OS prompt on first capture. Accessibility / Input-Monitoring
concepts resolve to *granted/no-op* — the global key listener uses
`uiohook-napi` and paste/copy is simulated through the clipboard + PowerShell
`SendKeys`. A SmartScreen prompt may appear on first run of the unsigned
installer (choose **More info → Run anyway**).

## Build & distribution

```bash
npm run build        # bundle main + preload + renderer (electron-vite build)
npm run dist         # build installers for the current platform
npm run dist:mac     # macOS .dmg (arm64, unsigned, not notarized)
npm run dist:win     # Windows NSIS installer (x64)
npm run typecheck    # tsc --noEmit for node + web tsconfigs
```

Native helpers are compiled by `npm run compile:native`, which runs
automatically before `dev`/`build`/`dist` (it is a no-op on non-macOS hosts).
Installers are written to `release/`.

App icons are regenerated with `npm run icons` (`scripts/make-icons.py`), which
derives every platform size + the menubar glyph from the master at
`resources/icon-master.png`.

> Cross-compiling is not supported: build the macOS `.dmg` on macOS and the
> Windows installer on Windows.

## Project structure

```
electron/              Main process (Node) — the engine
  main.ts              Orchestration hub: boot, IPC, keyboard wiring, persistence
  config.ts            APP_CONFIG + pricing tables (local-constant ServerConfig)
  keyStore.ts          Per-provider safeStorage key vault (+ .env dev seed)
  sessionManager.ts    Core session state machine + pipeline
  keyboard.ts          Activation-mode + chaining + debounce state machine
  keyListener.ts       PLATFORM SEAM: darwin globe-listener | win32 uiohook
  clipboard.ts         Selection capture + paste injection (osascript | SendKeys)
  windowManager.ts     Main window + frameless HUD/widget window
  tray.ts              Menubar/tray icon + recording pulse animation
  db.ts                better-sqlite3: sessions + usage_daily
  usageTracker.ts      Cost estimation from pricing tables
  audio.ts / ffmpeg.ts Audio scratch files + ffmpeg path resolution
  prompts.ts           Transform system prompts (text-engine, never answers)
  errorUtils.ts        simplifyError keyword mapping
  errorLogger.ts       In-memory error ring -> Developer view
  preload.ts           contextBridge -> window.electronAPI
  providers/           PROVIDER-AGNOSTIC registry
    types.ts           TranscriptionProvider + LLMProvider interfaces
    registry.ts        Map<id, provider> (add a provider = 1 file + 1 line)
    stt/groq.ts        Groq Whisper transcription
    llm/openai.ts      OpenAI chat/completions
    llm/openrouter.ts  OpenRouter chat/completions
renderer/              React 19 UI
  app/                 Main window: App, Onboarding, Settings, History,
                       Dictionary, Snippets
  widget/              HUD pill: WidgetApp, Widget, Waveform, useAudioRecorder
  styles/              tokens.css (black-glass design tokens) + styles.css
shared/                Cross-process contract (compiles under both tsconfigs)
  types.ts             All cross-process types + ElectronAPI surface
  ipc.ts               THE single source of truth for IPC channel names
native/macos/          Swift global-key listener + key poster sources
resources/             Compiled native binaries + app/menubar icons (+ icon-master.png)
scripts/               Native build (compile:globe / compile:key-poster) + make-icons.py
build/                 electron-builder resources (entitlements.mac.plist)
```

## Privacy

- **Bring your own keys.** Maverick Voice has no backend and no account system.
- **Keys encrypted at rest.** Each provider key is encrypted via Electron
  `safeStorage` — the macOS **Keychain** or Windows **DPAPI** — at
  `userData/<provider>-key.enc`. Keys are never logged or transmitted anywhere
  except the provider they belong to.
- **Audio leaves only for the provider you chose.** Audio goes to your STT
  provider (Groq) for transcription; for transforms, the transcript + selected
  text go to your LLM provider (OpenAI / OpenRouter / your endpoint). Nothing
  else leaves your device.
- **Local history.** Transcripts and session history live in a local SQLite DB
  (`maverickvoice.db`); recent audio scratch files are kept briefly for retry
  and pruned automatically (24h / newest-100 sessions, max 5 audio sets).
- **No telemetry, no analytics, no auto-update phone-home.**

See [PRD.md](./PRD.md) for product requirements, [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md)
for architecture, and [AGENTS.md](./AGENTS.md) for contributor/agent notes.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Malhar Ujawane
([@justmalhar](https://github.com/justmalhar)).
