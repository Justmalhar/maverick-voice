# Maverick Voice — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | Maverick Voice |
| **Owner** | Malhar Ujawane ([@justmalhar](https://github.com/justmalhar)) |
| **App ID** | `com.justmalhar.maverickvoice` |
| **Platforms** | macOS (Apple Silicon, arm64), Windows (x64) |
| **Status** | v1 |
| **Document date** | 2026 |

---

## 1. Summary

Maverick Voice is a desktop app for **voice dictation** and **voice-driven text
editing**. Users press a global hotkey to dictate text directly at their cursor
in any application, and — with the opt-in **instruction mode** enabled — they
can select existing text and *speak an instruction* to transform it in place.
It is **bring-your-own-key (BYO)** and
**provider-agnostic**: Groq for speech-to-text, OpenAI / OpenRouter / any
OpenAI-compatible endpoint for transforms. There is no backend, no account, and
no telemetry — keys are encrypted with the OS keychain and all history is local.

### 1.1 Problem

Typing is the bottleneck between thought and text. Existing dictation tools
either (a) lock users into one cloud vendor with an account and a subscription,
(b) silently "auto-format" speech into something the user didn't say, or (c)
cannot *edit* already-written text by voice. Power users want raw, accurate
dictation by default, on-demand voice editing, and full control over which
AI provider their audio and text are sent to.

### 1.2 Solution & positioning

A fast, private, monochrome-glass desktop app that:
- pastes **raw** lightly-cleaned dictation by default (never rewrites silently),
- transforms selected or dictated text **only** when explicitly instructed,
- lets the user bring their own keys and **swap providers freely**,
- keeps everything local except the audio/text sent to the chosen provider.

---

## 2. Goals & non-goals

### 2.1 Goals (v1)
- Sub-2-second pure dictation (STT only, no LLM round-trip).
- Reliable paste-at-cursor in any focused app on macOS and Windows.
- Opt-in voice instructions that transform selected text in place.
- Dictation + instruction chaining in one flow (when instruction mode is on).
- Optional AI auto-format pass for raw dictation (off by default).
- User-defined Dictionary (spoken-word corrections, also bias STT) and Snippets
  (spoken trigger → expansion).
- Provider-agnostic STT/LLM via a registry; adding a provider = one file + one
  registry line.
- Encrypted BYO keys; zero accounts; zero telemetry.
- Per-provider usage/cost visibility.

### 2.2 Non-goals (v1)
- Local/offline models (whisper.cpp, local LLM) — see §9, future.
- Real-time streaming captions / live subtitles.
- Mobile, web, or Linux clients.
- Multi-user / team / cloud sync.
- Custom prompt authoring UI, macros, or scripting.
- Auto-update / crash reporting / analytics.

---

## 3. Personas

### P1 — "The Builder" (primary)
Staff/Senior engineer (e.g. Malhar). Lives in an editor, terminal, and PR
descriptions. Wants to dictate commit messages, code comments, Slack replies,
and design docs at speaking speed, then voice-edit them ("make this a bullet
list", "tighten this paragraph"). Already has Groq + OpenAI keys; cares about
privacy and provider choice; will point the base URL at a self-hosted gateway.

### P2 — "The Writer"
Long-form writer / knowledge worker. Drafts in Notion/Docs/Obsidian. Wants
clean dictation without auto-mangling, and quick voice rewrites ("rephrase
formally", "fix grammar"). Less technical; relies on onboarding to set up keys.

### P3 — "The Accessibility-first user"
Uses voice as a primary input due to RSI or motor constraints. Needs reliable
global hotkeys, push-to-talk, and dependable paste across every app. Values the
Escape-to-cancel and undo-cancel safety nets.

---

## 4. User stories

**Dictation**
- As P1, I press the dictation key, speak, and clean text appears at my cursor.
- As P2, I want the pasted text to be what I said (lightly cleaned), not a
  reworded "improved" version.
- As P3, I want push-to-talk so recording stops the instant I release the key.

**Instruction** (opt-in; enable in Settings → Advanced)
- As P1, I select a paragraph, tap the instruction key (Caps Lock), say "make
  this a bullet list", and the selection is replaced with the list.
- As P2, I select a sentence and say "translate to French" and it is replaced.
- As P1, when no LLM key is set or the LLM fails, I want the raw transcript
  pasted with a clear notice rather than nothing.

**Chaining**
- As P1, I dictate a rough sentence, then within a short window speak an
  instruction to shape it, and the shaped result is pasted — one fluid motion.

**Control & safety**
- As any user, I press Escape to cancel a recording or processing; if I cancel
  by mistake I can undo within a few seconds.
- As any user, a too-short/silent clip is discarded without an STT call.

**Setup & privacy**
- As P2, onboarding walks me through pasting and validating my keys and granting
  permissions.
- As P1, I can swap STT/LLM providers and models, and override the LLM base URL.
- As any user, I can see estimated cost per provider for today/month/all-time.
- As any user, I trust that my keys are encrypted and nothing is sent anywhere
  except the provider I chose.

---

## 5. Core flows

### 5.1 Dictation (STT only — no LLM)
1. User presses the dictation key (Fn/Globe or Right Option on macOS; Right Ctrl
   or Right Alt on Windows).
2. HUD pill appears; mic records (chunked with VAD for long clips).
3. On stop, audio is transcribed by the STT provider (Groq Whisper). The user's
   Dictionary `to` values are passed as a ~200-char vocabulary prompt hint to
   bias recognition toward their spellings.
4. Transcript is lightly cleaned in code (`cleanTranscript`: trims STT
   hallucinations like "thanks for watching", "please subscribe").
5. **Dictionary** replacements then **Snippet** expansions are applied in code.
6. If **AI auto-format** is enabled, a mechanics-only LLM pass runs (grammar,
   punctuation, capitalization, paragraphs); on any failure it falls back to the
   unformatted text and never blocks the paste.
7. Result is delivered to the cursor via clipboard + synthesized paste.
8. HUD shows a brief success acknowledgment, then hides.

> Pure dictation **never** hits the LLM **unless** AI auto-format is explicitly
> enabled — that is the speed and "raw by default" guarantee.

### 5.2 Instruction (selection + voice command → LLM transform) — opt-in
0. User enables **instruction mode** in Settings → Advanced (off by default;
   while disabled, every instruction-key event is ignored).
1. User selects text in any app.
2. User taps the instruction key (**Caps Lock** on both platforms) and speaks a
   command.
3. App captures the selection (clipboard copy round-trip) **and** transcribes
   the spoken instruction.
4. `prompts.ts` assembles a system + user message for the appropriate flow
   (context / transform / instruction).
5. The LLM provider runs the transform; the output replaces the selection via
   paste.
6. If the LLM is unavailable / empty / refuses, the app falls back to the raw
   transcript and shows a fallback notice.

### 5.3 Chaining (dictate → instruct)
1. User dictates content; on stop, a short **chain window** opens.
2. Within the window the user presses the instruction key and speaks a command.
3. The dictated content becomes the working text; the instruction transforms it;
   the shaped result is pasted.
4. If the chain window expires with no instruction, the dictation is processed
   on its own.

### 5.4 Flow-type determination
The session manager classifies each session into one of:
`dictation` (raw, no LLM unless auto-format is on), `transform`, `context`,
`instruction`, `quote` (selection wrapped as `> ...`, no LLM) — based on whether
a selection was captured, whether an instruction was spoken, and the selection
role (`quote` vs `context`).

### 5.5 Dictionary & Snippets (deterministic text-replacement stage)
Both lists are managed from their own sidebar pages and applied **in code**
(no LLM) to every transcript after `cleanTranscript`, in order Dictionary →
Snippets:
- **Dictionary** — `from → to` corrections; case-insensitive, word-boundary
  match tolerant of adjacent punctuation, regex specials escaped, longest `from`
  applied first. The distinct `to` values are also joined (capped ~200 chars)
  and fed to Groq Whisper as a `prompt` vocabulary hint.
- **Snippets** — spoken `trigger → content` expansions; case-insensitive,
  longest `trigger` first, punctuation-tolerant.

### 5.6 AI Auto-Format (opt-in)
When enabled in Settings (off by default), raw dictation output runs through a
mechanics-only LLM pass (`AUTO_FORMAT` prompt: grammar, punctuation,
capitalization, sentence breaks, paragraphing — never changes meaning, never
adds content). On any failure (no key, network, timeout, empty/refusal) it
gracefully falls back to the unformatted transcript and fires `OUTPUT_FALLBACK`
with a notice; tokens are tracked like any other LLM call.

---

## 6. Functional requirements (product-level)

| ID | Requirement |
|----|-------------|
| F1 | Global dictation hotkey records mic and pastes transcript at cursor in any app. |
| F2 | Opt-in (default off) global instruction hotkey (**Caps Lock**) captures the current selection + spoken command and replaces the selection with the transform. |
| F3 | Dictation and instruction can be chained within a configurable chain window (when instruction mode is enabled). |
| F4 | Escape cancels recording/processing; cancel is undo-able within ~3s. |
| F5 | Three activation modes: tap-toggle, push-to-talk, double-tap-push. |
| F6 | Configurable dictation key (platform-specific options); instruction key is Caps Lock on both platforms. |
| F7 | STT via Groq (default `whisper-large-v3-turbo`); model + language selectable. |
| F8 | LLM via OpenAI or OpenRouter; model + base URL configurable (any OpenAI-compatible endpoint). |
| F9 | Per-provider keys entered in Settings, validated, and stored encrypted. |
| F10 | Long recordings chunked on VAD silence and transcribed in parallel, stitched in order. |
| F11 | Session history persisted locally; sessions can be copied and retried from saved audio. |
| F12 | Per-provider usage/cost summary for today/month/all-time. |
| F13 | Onboarding flow for keys, permissions, and shortcuts. |
| F14 | Output mode: paste-at-cursor (default) or copy-to-clipboard. |
| F15 | Sound feedback toggle; widget position (center/right); chunked-transcription toggle. |
| F16 | macOS permissions flow (mic / accessibility / input-monitoring); auto-granted/no-op on Windows. |
| F17 | Opt-in AI auto-format pass over raw dictation (default off), with graceful fallback to the unformatted transcript on any LLM failure. |
| F18 | User-managed Dictionary (`from → to` corrections) applied to transcripts and fed to Groq Whisper as a vocabulary prompt hint. |
| F19 | User-managed Snippets (spoken `trigger → content` expansion), case-insensitive and punctuation-tolerant. |

---

## 7. Success metrics

| Metric | Target |
|--------|--------|
| Pure-dictation latency (speak-stop → paste) | < 2s p50 for short clips |
| Dictation transcription accuracy (subjective) | "Pastes what I said" — no silent rewrites |
| Paste reliability across apps | > 99% successful paste on supported OS |
| Time-to-first-dictation (fresh install → first paste) | < 3 min including key + permissions |
| Provider swap | Add a new OpenAI-compatible endpoint with **zero** code (base URL only) |
| Crash-free sessions | Pipeline failures degrade gracefully (fallback paste), never hang the HUD |
| Privacy | 0 bytes sent to any host other than the user-configured providers |

---

## 8. UX & design requirements

- **Black & white 3D glassmorphism**, monochrome only. Pure blacks
  (`#000`–`#0a0a0a`), whites, and white-alpha tiers. No color accents; semantic
  states expressed as white-alpha intensities.
- **Liquid-glass pill HUD** that floats over all apps (center or right of
  screen), with recording pulse, processing shimmer, and output flash.
- **3D raised glass buttons** (layered shadows: outer drop + inset top highlight
  + inset bottom shade, subtle press translate).
- **Springy animations** for state transitions; smooth HUD entry/exit (~200ms).
- **Desktop-only** layout; windows resize gracefully (mobile responsiveness N/A).
- Native fonts, native look-and-feel; no external font loads.

---

## 9. Scope: v1 vs future

### v1 (in scope)
- macOS + Windows.
- STT: Groq. LLM: OpenAI + OpenRouter (+ any OpenAI-compatible endpoint).
- Dictation; opt-in instruction, chaining, cancel/undo, activation modes.
- Opt-in AI auto-format; user Dictionary + Snippets.
- Encrypted BYO keys, local SQLite history, usage/cost, onboarding, tray,
  permissions, sound feedback, widget positioning.

### Future (explicitly out of v1, architecture-ready)
- **Local / offline providers** — whisper.cpp / faster-whisper for STT and a
  local LLM (e.g. llama.cpp) for transforms. The provider registry is designed
  so these return as *just another provider file + registry entry*, with no
  changes to the session pipeline.
- Additional cloud providers (Anthropic-native, Deepgram, etc.) — same recipe.
- Linux support.
- Custom prompt / transform templates authored by the user.
- Code-signing + notarization for distribution.

---

## 10. Constraints & assumptions

- Users supply their own provider API keys; the app is free and unmonetized.
- Global key capture requires OS permissions (macOS) or `uiohook` (Windows).
- Paste is simulated via the clipboard, so the previous clipboard is saved and
  restored during selection capture.
- Pricing tables are hardcoded local constants and **will drift** from provider
  pricing pages; cost figures are estimates, not invoices.
- The instruction key is **Caps Lock** on both platforms; Right Shift was
  removed entirely (system-shortcut and Shift+Enter conflicts). Instruction mode
  itself is opt-in (off by default).
