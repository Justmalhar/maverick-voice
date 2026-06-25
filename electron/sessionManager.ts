import { v4 as uuidv4 } from 'uuid'
import { APP_CONFIG, REQUEST_TIMEOUT_MS } from './config'
import { getTranscriptionProvider, getLLMProvider } from './providers/registry'
import { getApiKey, hasApiKey } from './keyStore'
import { assembleTransformMessages, buildAutoFormatPrompt, type FlowType } from './prompts'
import { saveAudioFile, saveAudioChunk } from './audio'
import { captureSelectedText, injectOutput, copyToClipboard } from './clipboard'
import { getWidgetWindow, showHUD, hideHUD, cancelPendingHide } from './windowManager'
import { setTrayRecording, setTrayIdle } from './tray'
import { broadcastError } from './errorLogger'
import { simplifyError } from './errorUtils'
import { getFrontmostApp } from './frontmostApp'
import { detectProfile } from './appProfiles'
import { IPC } from '../shared/ipc'
import { FORMATTING } from '../shared/copy'
import type {
  SessionMode,
  STTSettings,
  LLMSettings,
  DictionaryEntry,
  Snippet,
  AppProfile
} from '../shared/types'

// LLM transform output is capped at this many completion tokens. Generous so a
// long "make this an email" instruction is never truncated.
const TRANSFORM_MAX_TOKENS = 4096

/**
 * Detect LLM refusal responses — safety guardrails that refuse to process the
 * user's dictation. In a voice-to-text app, the user is dictating their own
 * words and the LLM should never censor them. If it does, we fall back to the
 * raw transcript.
 */
function isLLMRefusal(text: string): boolean {
  // Normalize smart/curly quotes to straight quotes — LLMs often return Unicode quotes
  const lower = text.toLowerCase().trim()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
  const refusalPatterns = [
    /i('m| am) sorry.{0,20}(can't|cannot|can not|unable to)/,
    /i('m| am) not able to/,
    /i (can't|cannot|can not) (help|assist|process|generate|create|produce|write|provide)/,
    /as an ai.{0,30}(can't|cannot|can not|unable)/,
    /i('m| am) unable to (help|assist|process|fulfill|comply)/,
    /this (content|text|request|input) (is|contains|includes|involves).{0,30}(inappropriate|harmful|offensive|violent|abusive)/,
    /i (can't|cannot|won't|will not) (fulfill|comply|process) (this|that|your)/,
    /against my (guidelines|policy|programming|principles)/,
    /not (appropriate|something i can|able to assist)/,
    /i (must|have to) (decline|refuse|refrain)/,
  ]
  return refusalPatterns.some(pattern => pattern.test(lower))
}

/**
 * Special bracketed tokens STT engines emit for non-speech segments. They must
 * be stripped wherever they appear — including mid-transcript when chunked
 * dictation stitches a silent chunk between two spoken ones.
 */
const WHISPER_SENTINELS_RE = /\[\s*(?:BLANK_AUDIO|SILENCE|\*SILENCE\*|MUSIC|INAUDIBLE|NO\s*SPEECH|NOISE|SOUND|APPLAUSE|LAUGHTER)\s*\]/gi

/**
 * Lightweight deterministic cleanup for raw dictation output — no LLM.
 * Trims, normalises whitespace, strips non-speech sentinels (anywhere in the
 * text, not just when the whole transcript is one), and removes trailing
 * hallucinations that commonly appear on terminal silence (e.g. "Thank you.",
 * "Thanks for watching.", "Please subscribe.").
 */
export function cleanTranscript(text: string): string {
  if (!text) return ''
  let t = text.replace(/\r/g, '')
  // Drop sentinels wherever they appear (chunk-level or whole-string).
  t = t.replace(WHISPER_SENTINELS_RE, ' ').trim()
  if (!t) return ''
  // normalise runs of spaces/tabs and excessive blank lines
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  // strip well-known trailing STT hallucinations on silence
  t = t.replace(/[\s]*(?:thanks? for watching[.!]?|please subscribe[.!]?|thank you[.!]?)\s*$/i, '').trim()
  return t
}

/** Join per-chunk transcripts into one clean block (deterministic, no LLM). */
function stitchChunks(transcripts: string[]): string {
  // Strip sentinels per-chunk first so a silent chunk doesn't survive the join,
  // then run the full cleanup on the stitched whole.
  const cleaned = transcripts
    .map((t) => t.replace(WHISPER_SENTINELS_RE, ' ').trim())
    .filter(Boolean)
  return cleanTranscript(cleaned.join(' '))
}

// ════════════════════════════════════════════════════════════════════════
// Text-replacement pipeline helpers (Dictionary + Snippets).
//
// PURE FUNCTIONS — no side effects, no `this`. Exported for unit testing.
// Both run on the transcript AFTER cleanTranscript and BEFORE any LLM pass.
// ════════════════════════════════════════════════════════════════════════

/** Escape regex metacharacters so a `from`/`trigger` is matched literally. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word-boundary regex tolerant of punctuation adjacency. JS `\b` is unreliable
 * around non-ASCII and breaks on tokens that start/end with a regex metaclass,
 * so we anchor on "start-of-string or a non-word, non-apostrophe character"
 * lookbehind/lookahead. This matches "mavrik" in "mavrik." / "(mavrik)" /
 * "say mavrik" but NOT inside "mavriking". The apostrophe carve-out keeps
 * contractions (e.g. "it's") from being split mid-token.
 */
function boundaryPattern(escaped: string): RegExp {
  return new RegExp(`(?<![\\w'])(?:${escaped})(?![\\w'])`, 'gi')
}

/**
 * Apply Dictionary replacements to a transcript.
 *  - case-insensitive
 *  - word-boundary match tolerant of adjacent punctuation
 *  - regex specials in `from` escaped
 *  - LONGEST `from` applied first (so "mac book pro" beats "mac")
 * Entries with an empty `from` are skipped. Returns the input unchanged when
 * there are no entries.
 */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  if (!text || !entries.length) return text
  const ordered = entries
    .filter((e) => e && e.from && e.from.trim().length > 0)
    .slice()
    .sort((a, b) => b.from.length - a.from.length)
  let out = text
  for (const entry of ordered) {
    // Vocabulary-only entries (no `to`) teach the STT model the spelling but
    // don't replace anything in the transcript.
    if (entry.to === undefined) continue
    const re = boundaryPattern(escapeRegex(entry.from.trim()))
    // Use a replacer function so `$` sequences in `to` (e.g. a price) are not
    // interpreted as regex backreferences.
    out = out.replace(re, () => entry.to!)
  }
  return out
}

/**
 * Expand Snippet triggers inline.
 *  - case-insensitive
 *  - tolerant of surrounding/trailing punctuation (same boundary rule as the
 *    dictionary so "my linkedin." expands and keeps the trailing period)
 *  - LONGEST `trigger` applied first
 * Entries with an empty `trigger` are skipped. Returns the input unchanged when
 * there are no snippets.
 */
export function applySnippets(text: string, snippets: Snippet[]): string {
  if (!text || !snippets.length) return text
  const ordered = snippets
    .filter((s) => s && s.trigger && s.trigger.trim().length > 0)
    .slice()
    .sort((a, b) => b.trigger.length - a.trigger.length)
  let out = text
  for (const snip of ordered) {
    const re = boundaryPattern(escapeRegex(snip.trigger.trim()))
    out = out.replace(re, () => snip.content)
  }
  return out
}

/** Dictionary → Snippets, in order (the deterministic replacement stage). */
function applyReplacements(text: string, dictionary: DictionaryEntry[], snippets: Snippet[]): string {
  if (!text) return text
  let out = applyDictionary(text, dictionary)
  out = applySnippets(out, snippets)
  return out
}

/**
 * STT vocabulary biasing hint built from the dictionary, joined and capped to
 * ~200 chars. Uses `to` (the corrected spelling) when set, or `from` for
 * vocabulary-only entries. Passed as the Whisper `prompt` so Groq biases toward
 * these spellings. Bounded by the dictionary (distinct from the
 * silence-parroting concern that bans an arbitrary prompt).
 */
const STT_PROMPT_HINT_MAX = 200
function buildSttPromptHint(dictionary: DictionaryEntry[]): string | undefined {
  if (!dictionary.length) return undefined
  const seen = new Set<string>()
  const terms: string[] = []
  for (const e of dictionary) {
    const term = (e?.to?.trim() || e?.from?.trim())
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  if (!terms.length) return undefined
  let hint = ''
  for (const term of terms) {
    const next = hint ? `${hint}, ${term}` : term
    if (next.length > STT_PROMPT_HINT_MAX) break
    hint = next
  }
  return hint || undefined
}

export interface SessionState {
  sessionId: string
  dictationAudio: Buffer | null
  instructionAudio: Buffer | null
  selectedText: string | null
  selectedTextRole: 'quote' | 'context' | null
  dictationTranscript: string | null
  instructionTranscript: string | null
  output: string | null
  flowType: FlowType
  status: 'recording' | 'processing' | 'done' | 'error'
  errorMessage: string | null
  createdAt: number
  // ─── App-aware formatting (captured async at session START) ───
  // Frontmost-app id/name + resolved AppProfile. Defaults to 'default' until
  // getFrontmostApp() resolves; if it never resolves before format time the
  // 'default' profile is used. NEVER blocks recording start.
  appId: string | null
  appName: string | null
  profile: AppProfile
}

function sendToWidget(channel: string, ...args: unknown[]): void {
  const widget = getWidgetWindow()
  if (widget?.webContents) {
    widget.webContents.send(channel, ...args)
  }
}

class SessionManager {
  private currentSession: SessionState | null = null
  private outputMode: 'paste' | 'clipboard' = 'paste'

  // Provider runtime settings (restored from electron-store by main.ts).
  private sttSettings: STTSettings = { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'en' }
  private llmSettings: LLMSettings = { provider: 'groq', model: 'llama-3.1-8b-instant', baseUrl: '' }

  // ─── Feature delta: AI auto-format + text-replacement pipeline ───
  // All OPT-IN / empty by default; pushed in by main.ts restoreSettings + IPC.
  private autoFormat = false
  private dictionary: DictionaryEntry[] = []
  private snippets: Snippet[] = []

  // App-aware formatting: adapts the AUTO_FORMAT prompt to the frontmost app.
  // DEFAULT true, but only effective when autoFormat is on. Pushed in by
  // main.ts restoreSettings + the SET_APP_AWARE_FORMATTING IPC handler.
  private appAwareFormatting = true

  // Processing lock — prevents new sessions during provider calls.
  private isProcessing = false
  private abortController: AbortController | null = null

  // True once we've told the user this session fell back to the raw transcript
  // (so the notice fires once, not per chunk).
  private fallbackNotified = false

  // Tracks whether an instruction recording was started in this session. Used
  // by processSession() to know it should wait for instruction audio IPC before
  // determining flow type and processing.
  private expectingInstructionAudio = false

  // Undo cancel state
  private cancelledSession: SessionState | null = null
  private undoTimer: ReturnType<typeof setTimeout> | null = null

  // Auto-hide timer — tracks the delayed hideHUD() call so it can be cancelled
  // when a new session starts (prevents an old timer from killing a new
  // session's HUD).
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null

  // ─── Chunked transcription state ───
  private chunkTracker: Map<number, {
    buffer: Buffer
    transcript: string | null
    transcriptionPromise: Promise<string> | null
    startedAt: number
    completedAt: number | null
    error: string | null
  }> = new Map()
  private totalChunksExpected: number | null = null
  private isChunkedSession = false

  // Callback to save session to DB (set from main.ts after DB is initialized).
  public onSessionComplete: ((session: SessionState) => void) | null = null

  // Callbacks for Escape shortcut lifecycle (set from main.ts).
  public onRecordingStarted: (() => void) | null = null
  public onRecordingStopped: (() => void) | null = null

  // Called when a session is fully terminated (cancel, Escape, processing done).
  // Used to reset keyboard state so it doesn't get stuck.
  public onSessionEnded: (() => void) | null = null

  // Called when a session-start is rejected (e.g. during processing). Used to
  // reset keyboard toggle state without unregistering Escape.
  public onSessionRejected: (() => void) | null = null

  /** Whether a session is currently being processed (provider calls in flight). */
  get processing(): boolean {
    return this.isProcessing
  }

  /** Tell the HUD this session fell back to the raw transcript (once per session). */
  private notifyEngineFallback(reason: string): void {
    if (this.fallbackNotified) return
    this.fallbackNotified = true
    console.log('[session] 🟡 Engine notice —', reason)
    sendToWidget(IPC.SESSION_ENGINE_NOTICE, reason)
  }

  /**
   * User-facing reason shown when an instruction/transform fell back to raw
   * text. Formatting runs on the configured LLM provider, so it's unavailable
   * without a key or while offline — make that explicit instead of a vague
   * "formatting failed".
   */
  private formattingNotice(): string {
    const hasKey = this.llmSettings.provider === 'proxy' || hasApiKey(this.llmSettings.provider)
    return hasKey ? FORMATTING.FAILED_HAS_KEY : FORMATTING.FAILED_NO_KEY
  }

  setOutputMode(mode: 'paste' | 'clipboard'): void {
    this.outputMode = mode
  }

  setSTTSettings(s: STTSettings): void {
    console.log('[session] STT settings updated:', JSON.stringify(s))
    this.sttSettings = s
  }

  getSTTSettings(): STTSettings {
    return this.sttSettings
  }

  setLLMSettings(s: LLMSettings): void {
    console.log('[session] LLM settings updated:', JSON.stringify(s))
    this.llmSettings = s
  }

  getLLMSettings(): LLMSettings {
    return this.llmSettings
  }

  setAutoFormat(enabled: boolean): void {
    console.log('[session] Auto-format set:', enabled)
    this.autoFormat = enabled
  }

  getAutoFormat(): boolean {
    return this.autoFormat
  }

  setAppAwareFormatting(enabled: boolean): void {
    console.log('[session] App-aware formatting set:', enabled)
    this.appAwareFormatting = enabled
  }

  getAppAwareFormatting(): boolean {
    return this.appAwareFormatting
  }

  setDictionary(entries: DictionaryEntry[]): void {
    this.dictionary = Array.isArray(entries) ? entries : []
    console.log('[session] Dictionary updated:', this.dictionary.length, 'entries')
  }

  getDictionary(): DictionaryEntry[] {
    return this.dictionary
  }

  setSnippets(snippets: Snippet[]): void {
    this.snippets = Array.isArray(snippets) ? snippets : []
    console.log('[session] Snippets updated:', this.snippets.length)
  }

  getSnippets(): Snippet[] {
    return this.snippets
  }

  startSession(mode: SessionMode): void {
    console.log('[session] startSession called, mode:', mode, '| isProcessing:', this.isProcessing, '| currentSession:', this.currentSession?.sessionId || 'null')
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED — key pressed during processing — showing discard hint')
      sendToWidget(IPC.PROCESSING_SHOW_DISCARD_HINT)
      // Reset keyboard toggle state so dictationActive/instructionActive
      // don't get stuck as true (the session was rejected, not started).
      this.onSessionRejected?.()
      return
    }

    console.log('╔══════════════════════════════════════════╗')
    console.log('║  SESSION START                           ║')
    console.log('╚══════════════════════════════════════════╝')
    console.log('[session] Mode:', mode)

    // Clear any pending undo state and cancel old auto-hide timers.
    this.clearUndoState()
    this.cancelAutoHide()
    this.expectingInstructionAudio = false

    if (!this.currentSession) {
      const sessionId = uuidv4()
      this.currentSession = {
        sessionId,
        dictationAudio: null,
        instructionAudio: null,
        selectedText: null,
        selectedTextRole: null,
        dictationTranscript: null,
        instructionTranscript: null,
        output: null,
        flowType: 'dictation',
        status: 'recording',
        errorMessage: null,
        createdAt: Date.now(),
        appId: null,
        appName: null,
        profile: 'default'
      }
      console.log('[session] New session created:', sessionId)
    } else {
      console.log('[session] Reusing existing session:', this.currentSession.sessionId)
    }

    // Show HUD FIRST — before clipboard capture, which runs osascript Cmd+C and
    // can briefly interfere with macOS window focus/ordering.
    showHUD()
    setTrayRecording(mode)
    sendToWidget(IPC.RECORDING_START, mode, this.currentSession.sessionId)
    console.log('[session] HUD shown, recording:start sent for mode:', mode)

    // App-aware formatting: detect the frontmost app NOW (focus may move during
    // recording). Fire-and-forget — never blocks or delays recording start. Only
    // dictation sessions feed the auto-format pass and the HUD chip.
    if (mode === 'dictation') {
      this.captureFrontmostApp(this.currentSession)
    }

    // Capture selected text AFTER HUD is shown — delay to let macOS finish
    // rendering the window before osascript Cmd+C fires, which can disrupt
    // window ordering.
    if (!this.currentSession.selectedText) {
      setTimeout(() => this.captureSelection(mode), 50)
    }

    // Notify main process (for Escape shortcut registration).
    this.onRecordingStarted?.()
  }

  chainSession(mode: SessionMode): void {
    console.log('[session] chainSession called, mode:', mode, '| isProcessing:', this.isProcessing)
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED chainSession — still processing')
      sendToWidget(IPC.PROCESSING_SHOW_DISCARD_HINT)
      this.onSessionRejected?.()
      return
    }

    console.log('[session] CHAIN session, mode:', mode)
    console.log('[session]   Current session:', this.currentSession?.sessionId)
    console.log('[session]   Has dictation audio:', !!this.currentSession?.dictationAudio)
    console.log('[session]   Has instruction audio:', !!this.currentSession?.instructionAudio)

    // Track that we're expecting instruction audio — processSession must wait for it.
    if (mode === 'instruction') {
      this.expectingInstructionAudio = true
      console.log('[session]   expectingInstructionAudio = TRUE')
    }

    this.cancelAutoHide()
    showHUD()
    setTrayRecording(mode)
    sendToWidget(IPC.RECORDING_START, mode, this.currentSession?.sessionId)

    this.onRecordingStarted?.()
  }

  /**
   * True when an audio buffer is tagged with a session ID that belongs to
   * neither the active nor the cancelled (undo) session — i.e. a late buffer
   * from a dictation that already ended. Lenient: an absent ID is accepted, so
   * this can never reject a clip on the normal path.
   */
  private isForeignSessionAudio(sessionId?: string): boolean {
    if (!sessionId) return false
    return sessionId !== this.currentSession?.sessionId &&
           sessionId !== this.cancelledSession?.sessionId
  }

  async stopRecording(mode: SessionMode): Promise<void> {
    console.log('[session] stopRecording called, mode:', mode, '| isProcessing:', this.isProcessing)
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED stopRecording — already processing')
      this.onSessionRejected?.()
      return
    }

    console.log('[session] STOP recording, mode:', mode)
    sendToWidget(IPC.RECORDING_STOP)

    // Notify main process (for Escape shortcut unregistration).
    this.onRecordingStopped?.()
    // Audio will arrive via IPC 'audio:ready'.
  }

  // ─── Chunked transcription methods ───

  receiveAudioChunk(buffer: Buffer, chunkIndex: number, mode: SessionMode, sessionId?: string): void {
    if (this.isForeignSessionAudio(sessionId)) {
      console.warn(`[session] ⏭️ Dropping stale chunk ${chunkIndex} for ended session ${sessionId} (current: ${this.currentSession?.sessionId || 'none'})`)
      return
    }
    const session = this.currentSession
    if (!session) {
      console.warn('[session] receiveAudioChunk called but no current session!')
      return
    }

    this.isChunkedSession = true
    const chunkState = {
      buffer,
      transcript: null as string | null,
      transcriptionPromise: null as Promise<string> | null,
      startedAt: Date.now(),
      completedAt: null as number | null,
      error: null as string | null,
    }
    this.chunkTracker.set(chunkIndex, chunkState)

    console.log(`[session] 📦 Chunk ${chunkIndex} received (${buffer.byteLength} bytes, mode: ${mode}) — starting parallel transcription`)

    // Persist chunk to disk so a mid-session cancel doesn't lose the audio.
    try {
      saveAudioChunk(session.sessionId, chunkIndex, buffer, false)
    } catch (err) {
      console.error('[session] Failed to save audio chunk', chunkIndex, err)
    }

    // Fire off transcription immediately (parallel).
    chunkState.transcriptionPromise = this.transcribeChunk(buffer, chunkIndex)
  }

  receiveAudioFinalChunk(buffer: Buffer, chunkIndex: number, totalChunks: number, duration: number, mode: SessionMode, sessionId?: string): void {
    if (this.isForeignSessionAudio(sessionId)) {
      console.warn(`[session] ⏭️ Dropping stale final chunk ${chunkIndex} for ended session ${sessionId} (current: ${this.currentSession?.sessionId || 'none'})`)
      return
    }
    const session = this.currentSession
    if (!session) {
      console.warn('[session] receiveAudioFinalChunk called but no current session!')
      return
    }

    this.isChunkedSession = true
    this.totalChunksExpected = totalChunks

    const chunkState = {
      buffer,
      transcript: null as string | null,
      transcriptionPromise: null as Promise<string> | null,
      startedAt: Date.now(),
      completedAt: null as number | null,
      error: null as string | null,
    }
    this.chunkTracker.set(chunkIndex, chunkState)

    console.log(`[session] 📦 Final chunk ${chunkIndex}/${totalChunks} received (${buffer.byteLength} bytes, duration: ${duration}ms, mode: ${mode})`)

    // Skip transcription for tiny final chunks (< 10KB) — almost certainly
    // trailing silence that causes Whisper to hallucinate phrases like
    // "Thank you." or "Thanks for watching.".
    const MIN_FINAL_CHUNK_BYTES = 10_000
    if (buffer.byteLength < MIN_FINAL_CHUNK_BYTES) {
      console.log(`[session] ⏭️ Final chunk too small (${buffer.byteLength} < ${MIN_FINAL_CHUNK_BYTES} bytes) — skipping transcription to avoid hallucination`)
      chunkState.transcript = ''
      chunkState.completedAt = Date.now()
    } else {
      chunkState.transcriptionPromise = this.transcribeChunk(buffer, chunkIndex)
    }

    // Store the full duration on the dictation audio slot so processSession sees
    // it has audio. Use the final chunk buffer as a placeholder — the real
    // transcripts come from chunkTracker.
    session.dictationAudio = buffer

    // Save audio file for debugging/retry (use final chunk for the file save).
    saveAudioFile(session.sessionId + '-dictation-final', buffer)

    // Also persist the final chunk under the chunk-naming scheme so reassembly
    // (chunks 0..N in order) is straightforward.
    try {
      saveAudioChunk(session.sessionId, chunkIndex, buffer, true)
    } catch (err) {
      console.error('[session] Failed to save final audio chunk', chunkIndex, err)
    }
  }

  private async transcribeChunk(buffer: Buffer, chunkIndex: number): Promise<string> {
    const t0 = Date.now()
    try {
      const transcript = await this.transcribeBuffer(buffer, this.abortController?.signal)

      const elapsed = Date.now() - t0
      const chunk = this.chunkTracker.get(chunkIndex)
      if (chunk) {
        chunk.transcript = transcript
        chunk.completedAt = Date.now()
      }

      const preview = transcript.length > 80 ? transcript.substring(0, 80) + '...' : transcript
      console.log(`[session] ✅ Chunk ${chunkIndex} transcribed in ${elapsed}ms: "${preview}"`)
      return transcript
    } catch (err) {
      const elapsed = Date.now() - t0
      const errorMsg = err instanceof Error ? err.message : 'Transcription failed'
      const chunk = this.chunkTracker.get(chunkIndex)
      if (chunk) {
        chunk.error = errorMsg
        chunk.completedAt = Date.now()
      }
      console.error(`[session] ❌ Chunk ${chunkIndex} transcription failed after ${elapsed}ms:`, errorMsg)
      return '' // Return empty — we'll still assemble what we have.
    }
  }

  /**
   * Transcribe a single audio buffer via the configured STT provider. Resolves
   * provider + model from settings and injects the decrypted key. Throws on
   * missing key / network / API; AbortError propagates (caller cancel).
   */
  private async transcribeBuffer(buffer: Buffer, signal?: AbortSignal): Promise<string> {
    const stt = this.sttSettings
    const isProxySTT = stt.provider === 'proxy'
    if (!isProxySTT && !hasApiKey(stt.provider)) {
      throw new Error(`No API key set for "${stt.provider}". Add your key in Settings.`)
    }
    const provider = getTranscriptionProvider(stt.provider)
    const key = isProxySTT ? '' : getApiKey(stt.provider)!
    const vocabHint = buildSttPromptHint(this.dictionary)
    console.log(`[session] STT: ${stt.provider}/${stt.model} | ${buffer.byteLength} bytes${vocabHint ? ` | vocab hint: "${vocabHint.substring(0, 60)}${vocabHint.length > 60 ? '…' : ''}"` : ''}`)
    const result = await provider.transcribe(
      buffer,
      {
        model: stt.model,
        language: stt.language === 'auto' ? undefined : stt.language,
        prompt: vocabHint,
        mimeType: 'audio/webm',
      },
      key,
      signal
    )
    return result.text
  }

  /**
   * Run an LLM transform via the configured LLM provider. Assembles system/user
   * prompts from prompts.ts, resolves provider/model/baseUrl from settings, and
   * injects the decrypted key. Throws on missing key / network / API; AbortError
   * propagates (caller cancel).
   */
  private async runTransform(
    flowType: FlowType,
    content: string | null,
    context: string | null,
    instruction: string | null,
    chunked: boolean,
    signal?: AbortSignal
  ): Promise<string> {
    const llm = this.llmSettings
    const isProxyLLM = llm.provider === 'proxy'
    if (!isProxyLLM && !hasApiKey(llm.provider)) {
      throw new Error(`No API key set for "${llm.provider}". Add your key in Settings.`)
    }
    console.log(`[session] LLM transform (${flowType}): ${llm.provider}/${llm.model}`)
    const { system, user, temperature } = assembleTransformMessages(
      flowType,
      content,
      context,
      instruction,
      chunked
    )
    const provider = getLLMProvider(llm.provider)
    const key = isProxyLLM ? '' : getApiKey(llm.provider)!
    const result = await provider.complete(
      {
        model: llm.model,
        system,
        user,
        temperature,
        maxTokens: TRANSFORM_MAX_TOKENS,
        baseUrl: llm.baseUrl || undefined,
        timeoutMs: APP_CONFIG.transform.timeout_ms,
      },
      key,
      signal
    )
    return result.text
  }

  private resetChunkState(): void {
    this.chunkTracker.clear()
    this.totalChunksExpected = null
    this.isChunkedSession = false
  }

  receiveAudio(buffer: Buffer, duration: number, mode: SessionMode, sessionId?: string): void {
    // Reject a late buffer from a dictation that already ended — it would
    // otherwise land in (and overwrite) the slot of whatever session is current.
    if (this.isForeignSessionAudio(sessionId)) {
      console.warn(`[session] ⏭️ Dropping stale audio for ended session ${sessionId} (current: ${this.currentSession?.sessionId || 'none'}, cancelled: ${this.cancelledSession?.sessionId || 'none'})`)
      return
    }
    // Audio may arrive after cancel (since IPC is async) — check cancelledSession too.
    const session = this.currentSession || this.cancelledSession
    if (!session) {
      console.warn('[session] receiveAudio called but no current or cancelled session!')
      return
    }

    const isCancelled = !this.currentSession && !!this.cancelledSession
    console.log('┌─ AUDIO RECEIVED ─────────────────────────')
    console.log('│ Session:', session.sessionId, isCancelled ? '(from cancelled session)' : '')
    console.log('│ Mode (from IPC):', mode)
    console.log('│ Buffer size:', buffer.byteLength, 'bytes')
    console.log('│ Duration:', duration, 'ms')
    console.log('│ Has dictation audio already:', !!session.dictationAudio)
    console.log('│ Has instruction audio already:', !!session.instructionAudio)
    console.log('│ Selected text role:', session.selectedTextRole)

    if (mode === 'dictation') {
      if (session.dictationAudio) {
        console.log('│ → WARNING: Dictation slot already filled, overwriting!')
      }
      session.dictationAudio = buffer
      console.log('│ → Assigned to: DICTATION audio slot')
    } else if (mode === 'instruction') {
      if (session.instructionAudio) {
        console.log('│ → WARNING: Instruction slot already filled, overwriting!')
      }
      session.instructionAudio = buffer
      console.log('│ → Assigned to: INSTRUCTION audio slot')
    } else {
      console.warn('│ → WARNING: Unknown mode "' + mode + '", ignoring!')
    }

    const audioPath = saveAudioFile(session.sessionId + '-' + mode, buffer)
    console.log('│ Audio file saved:', audioPath)
    console.log('└───────────────────────────────────────────')
  }

  async processSession(): Promise<void> {
    const session = this.currentSession
    if (!session) {
      console.warn('[session] processSession called but no current session!')
      return
    }

    // Lock processing IMMEDIATELY — blocks new sessions, chains, and duplicate
    // processSession calls. This must happen before the grace period to prevent
    // concurrent entry.
    if (this.isProcessing) {
      console.log('[session] ⛔ processSession already running, ignoring duplicate call')
      return
    }
    this.isProcessing = true
    this.fallbackNotified = false
    console.log('[session] 🔒 isProcessing = TRUE')

    // Guard: no audio received (rapid double-press or too-short recording).
    // Audio IPC from the renderer may still be in-flight — poll until it
    // arrives (up to 200ms).
    if (!session.dictationAudio && !session.instructionAudio) {
      console.log('[session] No audio yet — polling for IPC (up to 200ms)...')
      const t0 = Date.now()
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 10))
        if (session.dictationAudio || session.instructionAudio) break
      }

      if (!session.dictationAudio && !session.instructionAudio) {
        console.log('[session] No audio received after grace period — showing too-short feedback')
        this.currentSession = null
        this.isProcessing = false
        this.expectingInstructionAudio = false
        console.log('[session] 🔓 isProcessing = FALSE (no audio)')
        sendToWidget(IPC.SESSION_TOO_SHORT)
        this.scheduleAutoHide(1500)
        this.onSessionEnded?.()
        return
      }
      console.log(`[session] ✓ Audio arrived during grace period (${Date.now() - t0}ms), continuing`)
    }

    // Guard: instruction audio expected but not yet received (chain flow race).
    // In a chain flow (Fn→speak→Shift→speak→Shift), the chain-expired event
    // fires on the final key press, but the instruction audio IPC from the
    // renderer hasn't arrived yet. We must wait for it, otherwise the session
    // gets processed as dictation-only.
    if (this.expectingInstructionAudio && !session.instructionAudio) {
      console.log('[session] Instruction audio expected but not received — waiting up to 500ms...')
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 50))
        if (session.instructionAudio) {
          console.log('[session] ✓ Instruction audio arrived after', (i + 1) * 50, 'ms')
          break
        }
      }
      if (!session.instructionAudio) {
        console.log('[session] ⚠️ Instruction audio never arrived after 500ms — proceeding without it')
      }
      this.expectingInstructionAudio = false
    }

    const pipelineStart = Date.now()
    console.log('╔══════════════════════════════════════════╗')
    console.log('║  PROCESSING SESSION                      ║')
    console.log('╚══════════════════════════════════════════╝')
    console.log('[session] Session ID:', session.sessionId)
    console.log('[session] Has dictation audio:', !!session.dictationAudio, session.dictationAudio ? `(${session.dictationAudio.byteLength} bytes)` : '')
    console.log('[session] Has instruction audio:', !!session.instructionAudio, session.instructionAudio ? `(${session.instructionAudio.byteLength} bytes)` : '')
    console.log('[session] Selected text:', session.selectedText ? `"${session.selectedText.substring(0, 80)}..."` : 'none')
    console.log('[session] Selected text role:', session.selectedTextRole)
    console.log('[session] STT:', JSON.stringify(this.sttSettings), '| LLM:', JSON.stringify(this.llmSettings))
    session.status = 'processing'
    sendToWidget(IPC.RECORDING_STOP)

    // Create AbortController with config-driven timeout for provider calls.
    const controller = new AbortController()
    this.abortController = controller
    const timeoutMs = APP_CONFIG.transform.timeout_ms
    const apiTimeout = setTimeout(() => {
      console.log(`[session] API timeout (${timeoutMs}ms) — aborting`)
      controller.abort()
    }, timeoutMs)

    try {
      session.flowType = this.determineFlowType(session)
      console.log('[session] Determined flow type:', session.flowType)

      // ═══════════════════════════════════════════════════════════════
      // SEQUENTIAL PIPELINE: transcribe via STT provider, then (only for
      // transform/context/instruction flows) transform via LLM provider.
      // Pure dictation NEVER hits the LLM.
      // ═══════════════════════════════════════════════════════════════

      let transcribeMs = 0

      if (this.isChunkedSession && session.dictationAudio) {
        // ─── CHUNKED TRANSCRIPTION PATH ───
        // Chunks were already sent for transcription in parallel. Wait for all
        // to complete.
        console.log('[session] 🧩 CHUNKED TRANSCRIPTION MODE — waiting for parallel chunk transcriptions...')

        // Wait for totalChunksExpected to be set (final-chunk IPC may be slightly delayed).
        for (let i = 0; i < 20; i++) {
          if (this.totalChunksExpected !== null) break
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (this.totalChunksExpected === null) {
          console.warn('[session] ⚠️ totalChunksExpected never set — using chunkTracker size:', this.chunkTracker.size)
          this.totalChunksExpected = this.chunkTracker.size
        }

        console.log(`[session] Expecting ${this.totalChunksExpected} chunks, have ${this.chunkTracker.size} in tracker`)

        // Wait for all transcription promises to settle.
        const t0 = Date.now()
        const promises: Promise<string>[] = []
        for (const [, chunk] of this.chunkTracker) {
          if (chunk.transcriptionPromise) {
            promises.push(chunk.transcriptionPromise)
          }
        }
        await Promise.all(promises)
        transcribeMs = Date.now() - t0

        // Assemble ordered transcripts.
        const orderedTranscripts: string[] = []
        for (let i = 0; i < this.totalChunksExpected; i++) {
          const chunk = this.chunkTracker.get(i)
          if (chunk?.transcript) {
            orderedTranscripts.push(chunk.transcript)
          }
        }

        // Log chunk summary table.
        console.log('[session] ┌─── CHUNK SUMMARY ───')
        for (let i = 0; i < this.totalChunksExpected; i++) {
          const chunk = this.chunkTracker.get(i)
          if (chunk) {
            const elapsed = chunk.completedAt ? chunk.completedAt - chunk.startedAt : '?'
            const preview = chunk.transcript ? (chunk.transcript.length > 60 ? chunk.transcript.substring(0, 60) + '...' : chunk.transcript) : '(empty)'
            console.log(`[session] │ Chunk ${i}: ${chunk.buffer.byteLength} bytes | ${elapsed}ms | ${chunk.error ? '❌ ' + chunk.error : '✅'} | "${preview}"`)
          } else {
            console.log(`[session] │ Chunk ${i}: MISSING`)
          }
        }
        console.log(`[session] └─── Total transcribe wait: ${transcribeMs}ms for ${this.totalChunksExpected} chunks ───`)

        // Deterministic stitching in code — chunks are cut at silence, so a
        // plain ordered join produces clean continuous text. No markers, no LLM
        // merge.
        session.dictationTranscript = stitchChunks(orderedTranscripts)
        console.log(`[session] 🧩 Stitched ${orderedTranscripts.length} chunk(s) in code (no LLM)`)
        console.log('[session] Dictation transcript (chunked):', JSON.stringify(session.dictationTranscript))

      } else if (session.dictationAudio) {
        // ─── SINGLE BUFFER TRANSCRIPTION PATH ───
        console.log('[session] Transcribing DICTATION audio (single buffer)...')
        const t0 = Date.now()
        session.dictationTranscript = await this.transcribeBuffer(session.dictationAudio, controller.signal)
        const dtMs = Date.now() - t0
        transcribeMs += dtMs
        console.log(`[session] ⏱ Dictation transcribe: ${dtMs}ms`)
        console.log('[session] Dictation transcript:', JSON.stringify(session.dictationTranscript))
      } else {
        console.log('[session] No dictation audio to transcribe')
      }

      if (session.instructionAudio) {
        console.log('[session] Transcribing INSTRUCTION audio...')
        const t0 = Date.now()
        session.instructionTranscript = await this.transcribeBuffer(session.instructionAudio, controller.signal)
        transcribeMs += Date.now() - t0
        console.log(`[session] ⏱ Instruction transcribe: ${Date.now() - t0}ms`)
        console.log('[session] Instruction transcript:', JSON.stringify(session.instructionTranscript))
      } else {
        console.log('[session] No instruction audio to transcribe')
      }

      // ─── Deterministic text-replacement stage (Dictionary → Snippets) ───
      // Applied to BOTH transcripts before junk detection / flow routing so
      // every downstream flow (dictation, transform, context, instruction) sees
      // the user's corrected vocabulary + expanded snippets. The dictation
      // transcript is cleaned first (single-buffer path defers cleanTranscript
      // to the flow switch; running it here makes the order clean → dictionary
      // → snippets uniform across chunked + single-buffer paths). The dictation
      // flow's later cleanTranscript() call is idempotent on already-clean text.
      if (session.dictationTranscript) {
        const cleaned = cleanTranscript(session.dictationTranscript)
        const replaced = applyReplacements(cleaned, this.dictionary, this.snippets)
        if (replaced !== cleaned) {
          console.log('[session] Dictionary/snippets applied to dictation — before:', JSON.stringify(cleaned))
          console.log('[session] Dictionary/snippets applied to dictation — after:', JSON.stringify(replaced))
        }
        session.dictationTranscript = replaced
      }
      if (session.instructionTranscript) {
        const replaced = applyReplacements(session.instructionTranscript, this.dictionary, this.snippets)
        if (replaced !== session.instructionTranscript) {
          console.log('[session] Dictionary/snippets applied to instruction — before:', JSON.stringify(session.instructionTranscript))
          console.log('[session] Dictionary/snippets applied to instruction — after:', JSON.stringify(replaced))
        }
        session.instructionTranscript = replaced
      }

      // Guard: if all transcripts are empty/junk (e.g. just punctuation from
      // silence), skip the LLM call and treat as no-op to avoid pasting garbage.
      const dictationText = (session.dictationTranscript || '').trim()
      const instructionText = (session.instructionTranscript || '').trim()
      const junkMaxLen = APP_CONFIG.junk_detection.max_length
      const junkPattern = new RegExp(APP_CONFIG.junk_detection.pattern)
      const isJunkTranscript = (text: string) => text.length <= junkMaxLen && junkPattern.test(text)

      if (isJunkTranscript(dictationText) && isJunkTranscript(instructionText)) {
        console.log('[session] ⚠️ Empty/junk transcript detected, skipping output. Dictation:', JSON.stringify(dictationText), 'Instruction:', JSON.stringify(instructionText))
        session.status = 'done'
        session.output = null
        this.scheduleAutoHide(1500)
      } else {
        let output: string
        const transformStart = Date.now()
        console.log('[session] Running flow:', session.flowType)

        switch (session.flowType) {
          case 'quote':
            // Quote = blockquote the selection, no LLM.
            output = `> ${session.selectedText}\n\n${session.dictationTranscript || ''}`
            console.log('[session] Quote flow output (no LLM):', JSON.stringify(output))
            break

          case 'dictation': {
            // Dictation transcript is already cleaned + dictionary/snippet
            // replaced above. By default it's NEVER sent to the LLM. The AI
            // auto-format pass is the one opt-in exception: when enabled, run a
            // mechanics-only LLM correction. On ANY failure it falls back to the
            // unformatted text and fires OUTPUT_FALLBACK — it NEVER blocks paste.
            const dictationOutput = session.dictationTranscript || ''
            if (this.autoFormat && dictationOutput.trim()) {
              const formatProfile = this.appAwareFormatting ? session.profile : 'default'
              console.log(
                `[session] Dictation flow — AI auto-format (profile: ${formatProfile}${this.appAwareFormatting ? '' : ', app-aware off'})`
              )
              const formatted = await this.runAutoFormat(dictationOutput, formatProfile, controller.signal)
              if (formatted) {
                output = formatted
                console.log('[session] ✓ Auto-format applied')
              } else {
                output = dictationOutput
                session.errorMessage = 'formatting-fallback'
                this.notifyEngineFallback(this.formattingNotice())
                console.log('[session] Auto-format unavailable — pasted unformatted transcript')
              }
            } else {
              console.log('[session] Dictation flow — raw transcript (no LLM)')
              output = dictationOutput
            }
            break
          }

          case 'context':
            console.log('[session] Context flow — sending to LLM provider:', this.llmSettings.provider)
            output = await this.transformWithFallback(
              'context',
              null,
              session.selectedText,
              session.instructionTranscript,
              false,
              session.instructionTranscript || '',
              controller.signal,
              session
            )
            break

          case 'transform':
            console.log('[session] Transform flow — sending to LLM provider:', this.llmSettings.provider)
            output = await this.transformWithFallback(
              'transform',
              session.dictationTranscript,
              session.selectedTextRole === 'context' ? session.selectedText : null,
              session.instructionTranscript,
              false,
              session.dictationTranscript || '',
              controller.signal,
              session
            )
            break

          case 'instruction':
            console.log('[session] Instruction-only flow — sending to LLM provider:', this.llmSettings.provider)
            output = await this.transformWithFallback(
              'instruction',
              null,
              null,
              session.instructionTranscript,
              false,
              session.instructionTranscript || '',
              controller.signal,
              session
            )
            break

          default:
            output = session.dictationTranscript || ''
            console.log('[session] Default flow, using raw transcript')
        }

        const transformMs = Date.now() - transformStart
        session.output = output
        session.status = 'done'

        console.log(`[session] ⏱ Transform: ${transformMs}ms | Transcribe: ${transcribeMs}ms | Pipeline: ${Date.now() - pipelineStart}ms`)
        console.log('[session] ✅ FINAL OUTPUT:', JSON.stringify(output))

        if (this.outputMode === 'paste') {
          console.log('[session] Injecting output via paste...')
          await injectOutput(output)
        } else {
          console.log('[session] Copying output to clipboard...')
          copyToClipboard(output)
        }

        if (session.errorMessage === 'formatting-fallback') {
          sendToWidget(IPC.OUTPUT_FALLBACK, output, session.sessionId, this.formattingNotice())
        } else {
          sendToWidget(IPC.OUTPUT_READY, output, session.sessionId)
        }

        // Auto-hide HUD after showing output (cancellable if a new session
        // starts). Give more time for the fallback warning so the user can read
        // it.
        this.scheduleAutoHide(session.errorMessage === 'formatting-fallback' ? 4000 : 2500)
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Processing failed'
      console.error('[session] ❌ ERROR:', errorMessage)
      if (err instanceof Error && err.stack) {
        console.error('[session] Stack:', err.stack)
      }

      session.status = 'error'
      session.errorMessage = errorMessage

      broadcastError('session', errorMessage)
      sendToWidget(IPC.OUTPUT_ERROR, simplifyError(errorMessage), session.sessionId)
      this.scheduleAutoHide(3500)
    } finally {
      // Always clean up processing state.
      clearTimeout(apiTimeout)
      this.isProcessing = false
      this.abortController = null
      this.resetChunkState()
      console.log('[session] 🔓 isProcessing = FALSE')
    }

    // Save session and reset.
    console.log('[session] Saving session to DB...')
    console.log('[session]   ID:', session.sessionId)
    console.log('[session]   Flow:', session.flowType)
    console.log('[session]   Status:', session.status)
    console.log('[session]   Output:', session.output ? JSON.stringify(session.output.substring(0, 100)) : 'null')
    console.log('[session]   Error:', session.errorMessage)

    if (this.onSessionComplete) {
      try {
        this.onSessionComplete(session)
      } catch (err) {
        console.warn('[session] onSessionComplete threw:', err instanceof Error ? err.message : err)
      }
    }

    this.currentSession = null
    this.onSessionEnded?.()
    console.log('═══════════════════════════════════════════')
  }

  /**
   * Run an LLM transform for a flow, falling back to the raw transcript on
   * empty output, refusal, or provider error. Sets session.errorMessage to
   * 'formatting-fallback' (and fires the engine notice) whenever the raw
   * transcript is used so the HUD shows a fallback message.
   */
  private async transformWithFallback(
    flowType: FlowType,
    content: string | null,
    context: string | null,
    instruction: string | null,
    chunked: boolean,
    rawFallback: string,
    signal: AbortSignal,
    session: SessionState
  ): Promise<string> {
    try {
      const output = await this.runTransform(flowType, content, context, instruction, chunked, signal)

      if ((!output || output.trim() === '') && rawFallback) {
        console.log(`[session] ⚠️ LLM returned empty for ${flowType} flow — using raw transcript`)
        session.errorMessage = 'formatting-fallback'
        this.notifyEngineFallback(this.formattingNotice())
        return rawFallback
      }
      if (isLLMRefusal(output) && rawFallback) {
        console.log(`[session] ⚠️ LLM refused ${flowType} flow — using raw transcript`)
        session.errorMessage = 'formatting-fallback'
        this.notifyEngineFallback(this.formattingNotice())
        return rawFallback
      }
      return output
    } catch (transformErr) {
      // AbortError = caller cancel; let it propagate so the session ends as
      // cancelled rather than silently pasting raw text.
      if (transformErr instanceof Error && transformErr.name === 'AbortError') {
        throw transformErr
      }
      console.log(`[session] ⚠️ ${flowType} flow failed, falling back to raw transcript:`, transformErr instanceof Error ? transformErr.message : transformErr)
      broadcastError('provider', `${flowType} transform failed: ${transformErr instanceof Error ? transformErr.message : transformErr}`)
      if (rawFallback) {
        session.errorMessage = 'formatting-fallback'
        this.notifyEngineFallback(this.formattingNotice())
      }
      return rawFallback
    }
  }

  /**
   * Run the AI auto-format pass over a raw dictation transcript via the
   * configured LLM provider/model. The system prompt is app-aware:
   * buildAutoFormatPrompt(profile) = BASE RULES + the profile block (caller
   * passes `appAwareFormatting ? session.profile : 'default'`). Returns the
   * formatted text on success, or `null` on ANY failure (no key, network,
   * timeout, empty/refusal) so the caller falls back to the unformatted
   * transcript — this NEVER blocks the paste. Token usage is recorded inside the
   * provider's complete() like every other LLM call (instruction transforms etc.).
   */
  private async runAutoFormat(
    text: string,
    profile: AppProfile,
    signal?: AbortSignal
  ): Promise<string | null> {
    const llm = this.llmSettings
    const isProxyAutoFormat = llm.provider === 'proxy'
    if (!isProxyAutoFormat && !hasApiKey(llm.provider)) {
      console.log('[session] ⚠️ Auto-format skipped — no API key for', llm.provider)
      return null
    }
    console.log(`[session] LLM auto-format: ${llm.provider}/${llm.model} | ${text.length} chars in`)
    try {
      const provider = getLLMProvider(llm.provider)
      const key = isProxyAutoFormat ? '' : getApiKey(llm.provider)!
      const result = await provider.complete(
        {
          model: llm.model,
          system: buildAutoFormatPrompt(profile),
          user: text,
          temperature: 0.1,
          maxTokens: TRANSFORM_MAX_TOKENS,
          baseUrl: llm.baseUrl || undefined,
          timeoutMs: APP_CONFIG.transform.timeout_ms,
        },
        key,
        signal
      )
      const formatted = (result.text || '').trim()
      if (!formatted) {
        console.log('[session] ⚠️ Auto-format returned empty — using unformatted text')
        return null
      }
      if (isLLMRefusal(formatted)) {
        console.log('[session] ⚠️ Auto-format refused — using unformatted text')
        return null
      }
      // Hallucination guard: auto-format must never produce text materially longer
      // than the input. If the LLM grew the output beyond 2× the input AND added
      // more than 200 characters, it almost certainly continued/hallucinated text
      // the speaker never said. Fall back to raw to avoid pasting fabricated content.
      if (formatted.length > text.length * 2 && formatted.length - text.length > 200) {
        console.log(`[session] ⚠️ Auto-format hallucination detected (input: ${text.length} chars, output: ${formatted.length} chars) — using unformatted text`)
        return null
      }
      return formatted
    } catch (err) {
      // AbortError = caller cancel; propagate so the session ends as cancelled
      // rather than silently pasting (matches transformWithFallback semantics).
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }
      const msg = err instanceof Error ? err.message : String(err)
      console.log('[session] ⚠️ Auto-format failed, using unformatted text:', msg)
      broadcastError('provider', `auto-format failed: ${msg}`)
      return null
    }
  }

  /** Process the current session and immediately start a new one.
   *  Used for same-mode restart (e.g. dictation → dictation during chain window).
   *  This is atomic — no window for race conditions between process and start. */
  async processAndStartNew(mode: SessionMode): Promise<void> {
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED processAndStartNew — already processing')
      sendToWidget(IPC.PROCESSING_SHOW_DISCARD_HINT)
      this.onSessionRejected?.()
      return
    }

    console.log('[session] RESTART — processing old session then starting new, mode:', mode)

    // Process the current session (this clears currentSession at the end).
    await this.processSession()

    // Now start a fresh session.
    this.startSession(mode)
  }

  /** Discard current session immediately (recording was too short, no audio to process).
   *  Shows brief "too short" feedback on HUD then cleans up. */
  discardSession(sessionId?: string): void {
    if (!this.currentSession) return
    if (sessionId && sessionId !== this.currentSession.sessionId) {
      console.warn(`[session] ⏭️ Ignoring stale discard for ended session ${sessionId} (current: ${this.currentSession.sessionId})`)
      return
    }

    console.log('[session] Session DISCARDED (too short):', this.currentSession.sessionId)

    this.currentSession = null
    this.resetChunkState()
    setTrayIdle()

    // Show brief feedback then hide (cancellable if a new session starts).
    sendToWidget(IPC.SESSION_TOO_SHORT)
    this.scheduleAutoHide(1500)

    this.onRecordingStopped?.()
    this.onSessionEnded?.()
  }

  /** Cancel session — simple cancel without undo (used by widget cancel button) */
  cancelSession(): void {
    console.log('[session] Session CANCELLED:', this.currentSession?.sessionId, '| wasProcessing:', this.isProcessing)
    this.abortController?.abort()
    this.isProcessing = false
    this.abortController = null
    this.expectingInstructionAudio = false
    this.resetChunkState()
    console.log('[session] 🔓 isProcessing = FALSE (cancelled)')
    this.currentSession = null
    setTrayIdle()
    this.onRecordingStopped?.()
    this.onSessionEnded?.()
    hideHUD()
  }

  /** Cancel session with 3-second undo window (triggered by Escape key) */
  cancelSessionWithUndo(): void {
    if (!this.currentSession) return

    console.log('[session] Session CANCELLED with undo window:', this.currentSession.sessionId)

    // Abort any in-flight provider calls.
    this.abortController?.abort()
    this.isProcessing = false
    this.abortController = null
    this.expectingInstructionAudio = false
    this.resetChunkState()

    // Stop recording in the widget.
    sendToWidget(IPC.RECORDING_STOP)

    // Save session state for potential undo.
    this.cancelledSession = this.currentSession
    this.currentSession = null

    // Notify main to unregister Escape.
    this.onRecordingStopped?.()
    // Reset keyboard state — recording ended externally, not via normal toggle.
    this.onSessionEnded?.()

    // Tell widget to show cancelled state with undo button.
    sendToWidget(IPC.SESSION_CANCELLED)
    setTrayIdle()

    // 3 second undo window.
    this.undoTimer = setTimeout(() => {
      console.log('[session] Undo window expired')
      this.cancelledSession = null
      this.undoTimer = null
      hideHUD()
    }, 3000)
  }

  /** Undo a cancelled session — process the already-captured audio */
  undoCancel(): void {
    if (!this.cancelledSession) {
      console.log('[session] undoCancel called but no cancelled session')
      return
    }

    console.log('[session] UNDO cancel, processing captured audio for session:', this.cancelledSession.sessionId)

    // Clear undo timer.
    if (this.undoTimer) {
      clearTimeout(this.undoTimer)
      this.undoTimer = null
    }

    // Restore session as current and process it.
    this.currentSession = this.cancelledSession
    this.cancelledSession = null

    // Ensure HUD stays visible during processing.
    showHUD()

    // Process the already-captured audio (don't resume recording).
    this.processSession()
  }

  getCurrentSession(): SessionState | null {
    return this.currentSession
  }

  private clearUndoState(): void {
    if (this.undoTimer) {
      clearTimeout(this.undoTimer)
      this.undoTimer = null
    }
    this.cancelledSession = null
  }

  /** Schedule a delayed hideHUD. Cancels any previous auto-hide timer so old
   *  timers don't kill new sessions' HUDs. */
  private scheduleAutoHide(delayMs: number): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer)
    }
    this.autoHideTimer = setTimeout(() => {
      this.autoHideTimer = null
      setTrayIdle()
      hideHUD()
    }, delayMs)
  }

  /** Cancel any pending auto-hide timer AND any window-level exit-animation
   *  timer (called when a new session starts). Both must die together —
   *  otherwise an orphan hide() can fire after the new session's widget is
   *  already visible. */
  private cancelAutoHide(): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer)
      this.autoHideTimer = null
    }
    cancelPendingHide()
  }

  /**
   * Detect the frontmost app for app-aware formatting and store {id,name,
   * profile} on the session. Runs at session START (focus may move during the
   * recording). Fire-and-forget — getFrontmostApp() NEVER throws and self-times
   * out (~800ms). When a non-'default' profile resolves AND the session is still
   * the active dictation session, re-send RECORDING_START carrying the app
   * name + profile so the HUD can show its chip (positional, backward-compatible
   * payload). Resolution after format time is harmless — format uses whatever is
   * on the session at that moment, falling back to 'default'.
   */
  private captureFrontmostApp(session: SessionState): void {
    getFrontmostApp()
      .then((app) => {
        if (!app) {
          console.log('[session] Frontmost app unresolved — using default profile')
          return
        }
        const profile = detectProfile(app.id, app.name)
        // Only mutate THIS session's slot if it is still the one we started for
        // (the user may have ended/replaced it while detection was in flight).
        session.appId = app.id
        session.appName = app.name
        session.profile = profile
        console.log('[session] Frontmost app:', app.id, '|', app.name, '→ profile:', profile)

        // Surface the chip only when the session is still the active dictation
        // session AND the profile is meaningful (non-'default').
        if (
          profile !== 'default' &&
          this.currentSession === session &&
          session.status === 'recording'
        ) {
          sendToWidget(IPC.RECORDING_START, 'dictation', session.sessionId, app.name, profile)
        }
      })
      .catch((err) => {
        // getFrontmostApp() already swallows everything; this is belt-and-braces.
        console.log(
          '[session] captureFrontmostApp unexpected error:',
          err instanceof Error ? err.message : err
        )
      })
  }

  private async captureSelection(mode: SessionMode): Promise<void> {
    console.log('[session] Attempting to capture selected text, mode:', mode)
    try {
      const useClipboardFallback = mode === 'instruction'
      const selectedText = await captureSelectedText(useClipboardFallback)
      if (selectedText && this.currentSession) {
        this.currentSession.selectedText = selectedText
        this.currentSession.selectedTextRole = mode === 'dictation' ? 'quote' : 'context'
        console.log('[session] Captured selected text:', JSON.stringify(selectedText.substring(0, 80)))
        console.log('[session] Selected text role:', this.currentSession.selectedTextRole)
      } else {
        console.log('[session] No text was selected (and no clipboard fallback)')
      }
    } catch (err) {
      console.warn('[session] Failed to capture selected text:', err instanceof Error ? err.message : err)
    }
  }

  private determineFlowType(session: SessionState): FlowType {
    const hasDictation = !!session.dictationAudio
    const hasInstruction = !!session.instructionAudio
    const hasSelection = !!session.selectedText

    console.log('[session] Determining flow type:')
    console.log('[session]   hasDictation:', hasDictation)
    console.log('[session]   hasInstruction:', hasInstruction)
    console.log('[session]   hasSelection:', hasSelection)
    console.log('[session]   selectedTextRole:', session.selectedTextRole)

    if (hasSelection && session.selectedTextRole === 'quote' && hasDictation && !hasInstruction) {
      return 'quote'
    }
    if (hasSelection && session.selectedTextRole === 'context' && hasInstruction && !hasDictation) {
      return 'context'
    }
    if (hasDictation && !hasInstruction && !hasSelection) {
      return 'dictation'
    }
    if (hasInstruction && !hasDictation && !hasSelection) {
      return 'instruction'
    }
    return 'transform'
  }
}

export const sessionManager = new SessionManager()
