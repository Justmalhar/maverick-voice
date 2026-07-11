// ─── electron/session/fsm.ts — session lifecycle state machine ───
// Events, not sleeps: stop() → 'awaiting-audio', resolved by the matching
// AUDIO_FINAL/AUDIO_DISCARDED (TIMEOUTS.audioArrival is a GUARD only).
// abort is created at start() so chunks are cancellable from the first one
// (LEGACY-ISSUES §3.2). keyBindings.resetState() ownership lives here alone (§4 A5).

import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/ipc'
import type { AppProfile, Session, SessionMode } from '../../shared/types'
import { TIMEOUTS } from '../config'
import { getSetting } from '../store/settings'
import { holdAudio, releaseAudio } from '../store/audio'
import { saveSession } from '../store/sessions'
import { keyListener } from '../keys/listener'
import { keyBindings } from '../keys/bindings'
import { getFrontmostApp } from '../prompts/frontmostApp'
import { detectProfile } from '../prompts/appProfiles'
import { captureSelectedText } from '../output/selection'
import { pausePlayingMedia, resumePausedMedia } from '../output/media'
import { showHUD, hideHUD, getHUD } from '../windows/hud'
import { setTrayRecording, setTrayIdle } from '../windows/tray'
import { reportError, simplifyError } from '../errors'
import { runPipeline, trackChunk, newAudioTrack, type AudioTrack, type PipelineResult } from './pipeline'

// Trailing final chunks under this size are almost always silence that makes Whisper hallucinate — v1-tuned.
const MIN_FINAL_CHUNK_BYTES = 10_000
// A missing RECORDING_ACK is logged only — the renderer surfaces its own recorder error.
const ACK_GUARD_MS = 2_000

export type SessionPhase =
  | 'idle' | 'recording' | 'chained' | 'awaiting-audio' | 'processing' | 'output' | 'fallback' | 'error' | 'too-short' | 'cancelled'

export interface SessionState {
  id: string
  mode: SessionMode
  phase: SessionPhase
  abort: AbortController
  startedAt: number
  dictation: AudioTrack
  instruction: AudioTrack
  selectedText: string | null
  selectedTextRole: 'quote' | 'context' | null
  appId: string | null
  appName: string | null
  profile: AppProfile
  dictationTranscript: string | null
  instructionTranscript: string | null
  flowType: Session['flowType']
  output: string | null
  errorMessage: string | null
  audioRef: string | null
  awaitResolvers: Partial<Record<SessionMode, () => void>>
  ackTimer: NodeJS.Timeout | null
}

function sendToHud(channel: string, ...args: unknown[]): void {
  getHUD()?.webContents.send(channel, ...args)
}

function releaseSessionAudio(id: string): void {
  releaseAudio(`${id}-dictation`)
  releaseAudio(`${id}-instruction`)
}

class SessionFsm extends EventEmitter {
  private session: SessionState | null = null
  private cancelledSession: SessionState | null = null
  private undoTimer: NodeJS.Timeout | null = null
  private processingNow = false

  get processing(): boolean {
    return this.processingNow
  }
  current(): SessionState | null {
    return this.session
  }

  /** isProcessing guard for start/chain: hint instead of a bare rejection. */
  private rejectIfProcessing(): boolean {
    if (!this.processingNow) return false
    sendToHud(IPC.PROCESSING_SHOW_DISCARD_HINT)
    keyBindings.resetState()
    return true
  }

  start(mode: SessionMode): void {
    if (this.rejectIfProcessing()) return
    const session: SessionState = {
      id: uuidv4(),
      mode,
      phase: 'recording',
      abort: new AbortController(),
      startedAt: Date.now(),
      dictation: newAudioTrack(mode === 'dictation'),
      instruction: newAudioTrack(mode === 'instruction'),
      selectedText: null,
      selectedTextRole: null,
      appId: null,
      appName: null,
      profile: 'default',
      dictationTranscript: null,
      instructionTranscript: null,
      flowType: 'dictation',
      output: null,
      errorMessage: null,
      audioRef: null,
      awaitResolvers: {},
      ackTimer: null
    }
    this.session = session
    this.emit('phase', session)
    console.log(`[fsm] session ${session.id} started (${mode})`)

    void showHUD()
    sendToHud(IPC.RECORDING_START, mode, session.id)
    session.ackTimer = setTimeout(() => console.warn('[fsm] no RECORDING_ACK for session', session.id), ACK_GUARD_MS)

    if (getSetting('pauseMediaDuringDictation')) void pausePlayingMedia()
    setTrayRecording(mode)
    keyListener.enableEscape(true)

    if (mode === 'dictation') {
      getFrontmostApp((cmd) => keyListener.command(cmd as 'FRONTAPP'))
        .then((app) => {
          if (!app || this.session !== session || session.phase !== 'recording') return
          const profile = detectProfile(app.id, app.name)
          session.appId = app.id
          session.appName = app.name
          session.profile = profile
          if (profile !== 'default') sendToHud(IPC.RECORDING_START, 'dictation', session.id, app.name, profile)
        })
        .catch(() => {})
    }

    // ~50ms after showHUD (v1 ordering): let the window finish rendering before the synthesized copy steals focus.
    setTimeout(() => {
      if (this.session !== session || session.selectedText) return
      captureSelectedText({
        useClipboardFallback: mode === 'instruction',
        helperCommand: (cmd) => keyListener.command(cmd)
      })
        .then((text) => {
          if (!text || this.session !== session) return
          session.selectedText = text
          session.selectedTextRole = mode === 'dictation' ? 'quote' : 'context'
        })
        .catch(() => {})
    }, 50)
  }

  chain(mode: SessionMode): void {
    if (this.rejectIfProcessing()) return
    const session = this.session
    if (!session) {
      this.start(mode)
      return
    }
    session.mode = mode
    session.phase = 'chained'
    session[mode].engaged = true
    this.emit('phase', session)

    void showHUD()
    sendToHud(IPC.RECORDING_START, mode, session.id)
    setTrayRecording(mode)
    keyListener.enableEscape(true)
  }

  recordingAck(sessionId: string): void {
    if (this.session?.id !== sessionId || !this.session.ackTimer) return
    clearTimeout(this.session.ackTimer)
    this.session.ackTimer = null
  }

  stop(mode: SessionMode): void {
    const session = this.session
    if (!session) {
      console.warn('[fsm] stop() with no active session')
      return
    }
    if (this.processingNow) {
      keyBindings.resetState()
      return
    }
    if (session.phase !== 'recording' && session.phase !== 'chained') {
      console.log('[fsm] stop() ignored — not recording (phase:', session.phase, ')')
      return
    }
    session.phase = 'awaiting-audio'
    this.emit('phase', session)
    sendToHud(IPC.RECORDING_STOP, session.id)
    void this.finishRecording(session, mode)
  }

  private async finishRecording(session: SessionState, mode: SessionMode): Promise<void> {
    await this.waitForAudio(session, mode)
    if (this.session !== session) return // superseded (cancelled meanwhile)
    await this.beginProcessing(session)
  }

  private waitForAudio(session: SessionState, mode: SessionMode): Promise<void> {
    if (session[mode].chunks.size > 0) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => { clearTimeout(timer); delete session.awaitResolvers[mode]; resolve() }
      const timer = setTimeout(() => {
        console.warn(`[fsm] audio arrival guard fired for session ${session.id} (${mode})`)
        done()
      }, TIMEOUTS.audioArrival)
      session.awaitResolvers[mode] = done
    })
  }

  /** Shared by AUDIO_CHUNK/AUDIO_FINAL: hold + track the chunk (skipping a tiny trailing final chunk), record totalChunks when known. */
  private ingestAudio(session: SessionState, mode: SessionMode, chunkIndex: number, buffer: Buffer, totalChunks?: number): void {
    holdAudio(`${session.id}-${mode}`, buffer)
    if (totalChunks !== undefined) session[mode].total = totalChunks
    if (totalChunks === undefined || buffer.byteLength >= MIN_FINAL_CHUNK_BYTES) {
      trackChunk(session, mode, chunkIndex, buffer)
    } else {
      console.log(`[fsm] final chunk under threshold — skipping transcription (session ${session.id})`)
    }
  }

  audioChunk(payload: { buffer: Buffer; chunkIndex: number; mode: SessionMode; sessionId?: string }): void {
    const session = this.resolveSessionForAudio(payload.sessionId)
    if (!session) return
    this.ingestAudio(session, payload.mode, payload.chunkIndex, payload.buffer)
  }

  audioFinal(payload: {
    buffer: Buffer; chunkIndex: number; totalChunks: number; duration: number; mode: SessionMode; sessionId?: string
  }): void {
    const session = this.resolveSessionForAudio(payload.sessionId)
    if (!session) return
    this.ingestAudio(session, payload.mode, payload.chunkIndex, payload.buffer, payload.totalChunks)
    session.awaitResolvers[payload.mode]?.()
  }

  audioDiscarded(sessionId?: string): void {
    const session = this.resolveSessionForAudio(sessionId)
    if (!session) return
    for (const mode of ['dictation', 'instruction'] as const) session.awaitResolvers[mode]?.()
  }

  /** Absent id → active session; a cancelled id is accepted only within its undo window; anything else is stale/foreign and dropped. */
  private resolveSessionForAudio(sessionId?: string): SessionState | null {
    if (!sessionId) return this.session
    if (this.session?.id === sessionId) return this.session
    if (this.cancelledSession?.id === sessionId) return this.cancelledSession
    return null
  }

  private async beginProcessing(session: SessionState): Promise<void> {
    if (this.session !== session) return
    if (session.dictation.chunks.size === 0 && session.instruction.chunks.size === 0) {
      session.phase = 'too-short'
      this.emit('phase', session)
      sendToHud(IPC.SESSION_TOO_SHORT)
      this.finish(session, null, 1500)
      return
    }
    this.processingNow = true
    session.phase = 'processing'
    this.emit('phase', session)
    try {
      const result = await runPipeline(session, { helperCommand: (cmd) => keyListener.command(cmd) })
      this.handleResult(session, result)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[fsm] pipeline aborted for session', session.id)
        return
      }
      this.handleError(session, err)
    } finally {
      this.processingNow = false
    }
  }

  private handleResult(session: SessionState, result: PipelineResult): void {
    if (this.session !== session) return
    if (result.outcome === 'skipped') {
      // Nothing meaningful to paste (junk/empty transcript on real audio) — no IPC, matches v1's silent done/output=null.
      session.phase = 'output'
      this.finish(session, 'done', 1500)
      return
    }
    if (result.outcome === 'fallback') {
      session.phase = 'fallback'
      session.errorMessage = result.message ?? null
      sendToHud(IPC.OUTPUT_FALLBACK, session.output, session.id, result.message)
      this.finish(session, 'done', 2500)
      return
    }
    session.phase = 'output'
    sendToHud(IPC.OUTPUT_READY, session.output, session.id)
    this.finish(session, 'done', 1200)
  }

  private handleError(session: SessionState, err: unknown): void {
    if (this.session !== session) return
    const message = err instanceof Error ? err.message : String(err)
    session.errorMessage = message
    session.phase = 'error'
    reportError('session', message)
    sendToHud(IPC.OUTPUT_ERROR, simplifyError(message), session.id)
    this.finish(session, 'error', 2500)
  }

  /** Terminal transition. `status` null = too-short (no persistence, matches v1); 'done'/'error' persists via 'complete'. */
  private finish(session: SessionState, status: 'done' | 'error' | null, delayMs: number): void {
    console.log(`[fsm] session ${session.id} finished (${status ?? 'too-short'}, ${Date.now() - session.startedAt}ms)`)
    this.emit('phase', session)
    this.teardown()
    this.session = null
    if (status) {
      this.emit('complete', {
        id: session.id,
        createdAt: session.startedAt,
        flowType: session.flowType,
        dictationTranscript: session.dictationTranscript ?? undefined,
        instructionTranscript: session.instructionTranscript ?? undefined,
        selectedText: session.selectedText ?? undefined,
        selectedTextRole: session.selectedTextRole ?? undefined,
        output: session.output ?? undefined,
        audioRef: session.audioRef ?? undefined,
        status,
        errorMessage: session.errorMessage ?? undefined
      } satisfies Session)
    }
    setTimeout(() => void hideHUD(() => sendToHud(IPC.HUD_HIDE)), delayMs)
  }

  /** Runs on EVERY path a session can end (incl. cancel): resume media, tray idle, Escape off, keyBindings reset. */
  private teardown(): void {
    void resumePausedMedia()
    setTrayIdle()
    keyListener.enableEscape(false)
    keyBindings.resetState()
  }

  private beginCancel(session: SessionState): void {
    session.abort.abort()
    this.processingNow = false
    session.phase = 'cancelled'
    this.emit('phase', session)
  }

  cancel(): void {
    const session = this.session
    if (!session) return
    this.beginCancel(session)
    releaseSessionAudio(session.id)
    this.session = null
    this.teardown()
    void hideHUD(() => sendToHud(IPC.HUD_HIDE))
  }

  cancelWithUndo(): void {
    const session = this.session
    if (!session) return
    this.beginCancel(session)
    sendToHud(IPC.RECORDING_STOP, session.id)
    this.session = null
    this.cancelledSession = session
    this.teardown()
    sendToHud(IPC.SESSION_CANCELLED)
    this.undoTimer = setTimeout(() => {
      this.undoTimer = null
      if (this.cancelledSession !== session) return
      releaseSessionAudio(session.id)
      this.cancelledSession = null
      void hideHUD(() => sendToHud(IPC.HUD_HIDE))
    }, TIMEOUTS.undoWindow)
  }

  undoCancel(): void {
    const session = this.cancelledSession
    if (!session) return
    if (this.undoTimer) {
      clearTimeout(this.undoTimer)
      this.undoTimer = null
    }
    this.cancelledSession = null
    session.abort = new AbortController() // the old one was aborted on cancel
    session.phase = 'processing'
    this.session = session
    this.emit('phase', session)
    void showHUD()
    void this.beginProcessing(session)
  }
}

export const sessionFsm = new SessionFsm()

// Persistence subscribes here (INTERFACES: "errors in handlers are caught").
sessionFsm.on('complete', (record: Session) => {
  saveSession(record).catch((err) => {
    console.error('[fsm] saveSession failed:', err instanceof Error ? err.message : err)
  })
})
