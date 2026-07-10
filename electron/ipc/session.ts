// ─── electron/ipc/session.ts — session/recording IPC registrar ───
// Routes audio + widget-control channels straight to the session FSM (no
// logic here), plus session history CRUD and the retry flow. Retry is
// raw-by-default (v1 §5): re-transcribe + cleanTranscript only — NEVER the
// LLM, NEVER re-injects output — it only fixes a broken History row. Retry
// writes ONLY on success; a failure updates status+errorMessage alone,
// preserving whatever transcript/output the row already had (v1 bug #1).

import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { RetryStatus, Session, SessionMode } from '../../shared/types'
import { sessionFsm } from '../session/fsm'
import { transcribeOne } from '../session/pipeline'
import { cleanTranscript } from '../session/textops'
import { markExitDone, markReady } from '../windows/hud'
import { loadAudio } from '../store/audio'
import { clearAllSessions, deleteSession, getSession, getSessions, updateSessionResult } from '../store/sessions'
import { getApiKey, hasApiKey } from '../store/keys'
import { getSetting } from '../store/settings'
import { getTranscriptionProvider } from '../providers/registry'
import { simplifyError } from '../errors'

function broadcastRetryStatus(sessionId: string, status: RetryStatus, data?: Partial<Session>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.SESSION_RETRY_STATUS, sessionId, status, data)
  }
}

const retrying = new Set<string>()

async function retrySession(sessionId: string): Promise<void> {
  if (retrying.has(sessionId)) {
    console.log('[retry] already retrying session', sessionId)
    return
  }
  retrying.add(sessionId)
  try {
    const existing = await getSession(sessionId)
    if (!existing) throw new Error('Session not found')

    const buffer = (await loadAudio(`${sessionId}-dictation`)) || (await loadAudio(`${sessionId}-instruction`))
    if (!buffer) throw new Error('Original audio is no longer available for this session')

    broadcastRetryStatus(sessionId, 'processing')

    const stt = getSetting('sttSettings')
    if (!hasApiKey(stt.provider)) throw new Error(`Add your ${stt.provider} API key in Settings to retry`)

    const raw = await transcribeOne(buffer, new AbortController().signal)
    const output = cleanTranscript(raw)
    if (!output) throw new Error('No speech detected in the recording')

    // errorMessage intentionally omitted — updateSessionResult only writes
    // defined fields (v1 bug #1), and the renderer gates the error banner on
    // status==='error' so a stale message on a now-'done' row is inert.
    const patch: Partial<Session> = {
      dictationTranscript: output,
      output,
      status: 'done',
      flowType: 'dictation'
    }
    await updateSessionResult(sessionId, patch)
    broadcastRetryStatus(sessionId, 'done', patch)
    console.log('[retry] session retried successfully:', sessionId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Retry failed'
    console.error('[retry] failed:', message)
    const patch: Partial<Session> = { status: 'error', errorMessage: simplifyError(message) }
    await updateSessionResult(sessionId, patch)
    broadcastRetryStatus(sessionId, 'error', patch)
  } finally {
    retrying.delete(sessionId)
  }
}

export function registerSessionIpc(): void {
  // ── audio / recording (fire-and-forget, R→M) ──
  ipcMain.on(IPC.AUDIO_CHUNK, (_e, buffer: ArrayBuffer, chunkIndex: number, mode: SessionMode, sessionId?: string) => {
    sessionFsm.audioChunk({ buffer: Buffer.from(buffer), chunkIndex, mode, sessionId })
  })
  ipcMain.on(
    IPC.AUDIO_FINAL,
    (
      _e,
      buffer: ArrayBuffer,
      chunkIndex: number,
      totalChunks: number,
      duration: number,
      mode: SessionMode,
      sessionId?: string
    ) => {
      sessionFsm.audioFinal({ buffer: Buffer.from(buffer), chunkIndex, totalChunks, duration, mode, sessionId })
    }
  )
  ipcMain.on(IPC.AUDIO_DISCARDED, (_e, _mode: SessionMode, sessionId?: string) => {
    sessionFsm.audioDiscarded(sessionId)
  })
  ipcMain.on(IPC.RECORDING_ACK, (_e, sessionId: string) => sessionFsm.recordingAck(sessionId))

  // ── widget controls ──
  ipcMain.on(IPC.WIDGET_STOP, () => {
    const session = sessionFsm.current()
    if (!session) return
    sessionFsm.stop(session.mode)
  })
  ipcMain.on(IPC.WIDGET_CANCEL, () => sessionFsm.cancel())
  ipcMain.on(IPC.WIDGET_UNDO_CANCEL, () => sessionFsm.undoCancel())
  ipcMain.on(IPC.WIDGET_READY, () => markReady())
  ipcMain.on(IPC.HUD_EXIT_DONE, () => markExitDone())

  // ── history ──
  ipcMain.handle(IPC.SESSION_LIST, () => getSessions())
  ipcMain.handle(IPC.SESSION_DELETE, (_e, sessionId: string) => deleteSession(sessionId))
  ipcMain.handle(IPC.SESSION_CLEAR_ALL, () => clearAllSessions())
  ipcMain.handle(IPC.SESSION_RETRY, (_e, sessionId: string) => retrySession(sessionId))
}
