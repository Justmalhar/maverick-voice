# Maverick Voice

**Speak. It types.** Press a key, talk, and clean text lands at your cursor
in any app. Select text, tap Caps Lock, speak an instruction, and the
rewritten text replaces your selection. Bring your own provider keys — no
accounts, no backend, no telemetry. One-time purchase ($9.99), not a
subscription.

v2 is a ground-up rewrite of the app — same product, now cross-platform
(macOS universal, Windows, Linux), smoother (event-driven, compositor-only
animation), and themeable (real light/dark). `legacy/` is the v1 codebase,
kept as a reference only — see `LEGACY-ISSUES.md` for what it got wrong and
`PRD.md`/`SYSTEM-DESIGN.md` for what v2 does about it.

## Features

- **Dictation** — push-to-talk or tap-toggle activation; speech-to-text only,
  no LLM round-trip unless auto-format is on.
- **Instruction mode** *(opt-in)* — select text, tap Caps Lock, speak a
  command, get the transform in place.
- **AI auto-format** *(opt-in)* — mechanics-only LLM pass with app-aware
  profiles (email / chat-ai / code-editor / messaging / notes / default);
  falls back to the raw transcript on any LLM failure.
- **Rules** — always-on instructions (fix grammar, remove fillers, smart
  punctuation, professional tone, plus custom rules) applied whenever
  auto-format runs.
- **Dictionary, Replacements & Snippets** — spoken-word corrections fed as an
  STT vocabulary hint, text replacements, and trigger → expansion snippets.
- **Multi-provider** — STT: Deepgram, OpenAI, Groq. LLM: OpenAI, Groq,
  OpenRouter, or any OpenAI-compatible endpoint via a custom base URL.
- **Pause media during dictation** *(opt-in, off by default)* — pauses
  playing media on recording start, resumes only what it paused.
- **Local file logging** — `~/.maverick-voice/logs/yyyy-mm-dd.log`, rotated
  daily, 30-day retention; transcript/output text is never written to logs.
- **Light / dark / system theming**, consistent across dashboard and HUD.

## Platforms

| | macOS | Windows | Linux |
|---|---|---|---|
| Support | Universal (arm64 + x64), macOS 12+ | 10/11, x64 | x64, AppImage + deb |
| Key listener | `mac-helper` (Swift, universal) | uiohook-napi | uiohook-napi |
| Paste | helper CGEvent → osascript fallback | PowerShell `SendKeys` | `xdotool` (X11 full) / clipboard-only (Wayland) |
| Key storage | Keychain | DPAPI | libsecret (GNOME Keyring / KWallet) |

Linux X11 has full hotkey + paste parity with Windows. Wayland's compositor
security model blocks global key hooks and synthetic keystrokes, so the app
detects it at launch and degrades output to copy-to-clipboard with an
explicit notice — never a silent failure.

## Getting started

**Download:** grab the installer for your platform from Releases (DMG /
NSIS / AppImage /deb).

**Dev setup:**

```bash
npm install
npm run dev
```

- macOS needs **Xcode Command Line Tools** (`xcode-select --install`) to
  compile the `mac-helper` Swift binary — `npm run dev`/`build`/`dist`
  compile it automatically via `predev`/`prebuild`/`predist`.
- To seed provider keys in development, copy `.env.example` to `.env` and
  fill in the keys you have. These are a read-only fallback used only when
  no encrypted key is stored, and only in unpackaged builds.

## Permissions (macOS)

- **Microphone** — to record.
- **Accessibility** — to paste text and read your selection.
- **Input Monitoring** — for the global hotkeys.

Settings → Permissions runs a live preflight and links straight to the right
System Settings pane if anything is missing — the app never fails silently
on a dead hotkey.

## Build & release

```bash
npm run dist:mac    # universal DMG
npm run dist:win    # NSIS x64
npm run dist:linux  # AppImage + deb, x64
```

Cross-compiling isn't supported — build each installer on its own platform.

## Testing

```bash
npm test              # vitest run
npm run test:coverage # vitest run --coverage
```

## Project layout

```
electron/     Main process — keys, session, providers, output, store, windows, ipc
renderer/     React 19 UI — dashboard (app/) + HUD pill (widget/)
shared/       ipc.ts + types.ts — the cross-process contract
native/       Swift mac-helper source
legacy/       v1 — reference only, not built or shipped
```

## Privacy

- Provider keys are encrypted at rest via the OS keychain (`safeStorage`).
- Audio and transcripts never leave your machine except as direct API calls
  to the provider you configured, authenticated with your own key.
- No accounts, no backend, no telemetry.

## License

MIT — see [`legacy/LICENSE`](./legacy/LICENSE).
