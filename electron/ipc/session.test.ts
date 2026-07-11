import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  onHandlers,
  windows,
  getAllWindows,
  sessionFsm,
  transcribeOne,
  cleanTranscript,
  markExitDone,
  markReady,
  loadAudio,
  clearAllSessions,
  deleteSession,
  getSession,
  getSessions,
  updateSessionResult,
  getApiKey,
  hasApiKey,
  getSetting,
  getTranscriptionProvider,
  simplifyError
} = vi.hoisted(() => {
  const windows: Array<{ webContents: { send: (...a: unknown[]) => void } }> = []
  return {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    onHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    windows,
    getAllWindows: vi.fn(() => windows),
    sessionFsm: {
      audioChunk: vi.fn(),
      audioFinal: vi.fn(),
      audioDiscarded: vi.fn(),
      recordingAck: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      undoCancel: vi.fn(),
      current: vi.fn()
    },
    transcribeOne: vi.fn(),
    cleanTranscript: vi.fn(),
    markExitDone: vi.fn(),
    markReady: vi.fn(),
    loadAudio: vi.fn(),
    clearAllSessions: vi.fn(),
    deleteSession: vi.fn(),
    getSession: vi.fn(),
    getSessions: vi.fn(),
    updateSessionResult: vi.fn(),
    getApiKey: vi.fn(),
    hasApiKey: vi.fn(),
    getSetting: vi.fn(),
    getTranscriptionProvider: vi.fn(),
    simplifyError: vi.fn((m: string) => `simplified:${m}`)
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)),
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => onHandlers.set(channel, fn))
  },
  BrowserWindow: { getAllWindows }
}))
vi.mock('../session/fsm', () => ({ sessionFsm }))
vi.mock('../session/pipeline', () => ({ transcribeOne }))
vi.mock('../session/textops', () => ({ cleanTranscript }))
vi.mock('../windows/hud', () => ({ markExitDone, markReady }))
vi.mock('../store/audio', () => ({ loadAudio }))
vi.mock('../store/sessions', () => ({ clearAllSessions, deleteSession, getSession, getSessions, updateSessionResult }))
vi.mock('../store/keys', () => ({ getApiKey, hasApiKey }))
vi.mock('../store/settings', () => ({ getSetting }))
vi.mock('../providers/registry', () => ({ getTranscriptionProvider }))
vi.mock('../errors', () => ({ simplifyError }))

import { IPC } from '../../shared/ipc'
import { registerSessionIpc } from './session'

describe('ipc/session', () => {
  beforeEach(() => {
    handlers.clear()
    onHandlers.clear()
    windows.length = 0
    windows.push({ webContents: { send: vi.fn() } }, { webContents: { send: vi.fn() } })
    for (const fn of Object.values(sessionFsm)) (fn as ReturnType<typeof vi.fn>).mockReset()
    transcribeOne.mockReset()
    cleanTranscript.mockReset()
    markExitDone.mockReset()
    markReady.mockReset()
    loadAudio.mockReset()
    clearAllSessions.mockReset()
    deleteSession.mockReset()
    getSession.mockReset()
    getSessions.mockReset()
    updateSessionResult.mockReset()
    getApiKey.mockReset()
    hasApiKey.mockReset().mockReturnValue(true)
    getSetting.mockReset().mockReturnValue({ provider: 'groq' })
    getTranscriptionProvider.mockReset()
    simplifyError.mockClear()
    registerSessionIpc()
  })
  afterEach(() => vi.restoreAllMocks())

  it('AUDIO_CHUNK forwards a Buffer-converted chunk to the FSM', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer
    onHandlers.get(IPC.AUDIO_CHUNK)!(null, buf, 2, 'dictation', 'sess-1')
    expect(sessionFsm.audioChunk).toHaveBeenCalledWith({
      buffer: Buffer.from(buf),
      chunkIndex: 2,
      mode: 'dictation',
      sessionId: 'sess-1'
    })
  })

  it('AUDIO_FINAL forwards every field to the FSM', () => {
    const buf = new Uint8Array([9]).buffer
    onHandlers.get(IPC.AUDIO_FINAL)!(null, buf, 1, 1, 4.2, 'instruction', 'sess-2')
    expect(sessionFsm.audioFinal).toHaveBeenCalledWith({
      buffer: Buffer.from(buf),
      chunkIndex: 1,
      totalChunks: 1,
      duration: 4.2,
      mode: 'instruction',
      sessionId: 'sess-2'
    })
  })

  it('AUDIO_DISCARDED forwards the session id (mode is unused by the FSM call)', () => {
    onHandlers.get(IPC.AUDIO_DISCARDED)!(null, 'dictation', 'sess-3')
    expect(sessionFsm.audioDiscarded).toHaveBeenCalledWith('sess-3')
  })

  it('RECORDING_ACK forwards the session id', () => {
    onHandlers.get(IPC.RECORDING_ACK)!(null, 'sess-4')
    expect(sessionFsm.recordingAck).toHaveBeenCalledWith('sess-4')
  })

  it('WIDGET_STOP is a no-op when there is no active session', () => {
    sessionFsm.current.mockReturnValue(null)
    onHandlers.get(IPC.WIDGET_STOP)!()
    expect(sessionFsm.stop).not.toHaveBeenCalled()
  })

  it('WIDGET_STOP stops the current session with its own mode', () => {
    sessionFsm.current.mockReturnValue({ mode: 'dictation' })
    onHandlers.get(IPC.WIDGET_STOP)!()
    expect(sessionFsm.stop).toHaveBeenCalledWith('dictation')
  })

  it('WIDGET_CANCEL / WIDGET_UNDO_CANCEL / WIDGET_READY / HUD_EXIT_DONE delegate directly', () => {
    onHandlers.get(IPC.WIDGET_CANCEL)!()
    expect(sessionFsm.cancel).toHaveBeenCalled()
    onHandlers.get(IPC.WIDGET_UNDO_CANCEL)!()
    expect(sessionFsm.undoCancel).toHaveBeenCalled()
    onHandlers.get(IPC.WIDGET_READY)!()
    expect(markReady).toHaveBeenCalled()
    onHandlers.get(IPC.HUD_EXIT_DONE)!()
    expect(markExitDone).toHaveBeenCalled()
  })

  it('SESSION_LIST / SESSION_DELETE / SESSION_CLEAR_ALL delegate to the sessions store', async () => {
    getSessions.mockResolvedValue([{ id: 'a' }])
    expect(await handlers.get(IPC.SESSION_LIST)!()).toEqual([{ id: 'a' }])
    await handlers.get(IPC.SESSION_DELETE)!(null, 'a')
    expect(deleteSession).toHaveBeenCalledWith('a')
    await handlers.get(IPC.SESSION_CLEAR_ALL)!()
    expect(clearAllSessions).toHaveBeenCalled()
  })

  describe('SESSION_RETRY', () => {
    function broadcasts(): Array<[string, unknown, unknown]> {
      return (windows[0].webContents.send as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
        (c) => [c[0], c[1], c[2]] as [string, unknown, unknown]
      )
    }

    it('a non-Error rejection is reported as "Retry failed" (ternary non-Error branch)', async () => {
      getSession.mockRejectedValue('a plain string rejection')
      await handlers.get(IPC.SESSION_RETRY)!(null, 'weird')
      expect(updateSessionResult).toHaveBeenCalledWith('weird', {
        status: 'error',
        errorMessage: 'simplified:Retry failed'
      })
    })

    it('errors when the session does not exist', async () => {
      getSession.mockResolvedValue(null)
      await handlers.get(IPC.SESSION_RETRY)!(null, 'ghost')
      expect(updateSessionResult).toHaveBeenCalledWith('ghost', {
        status: 'error',
        errorMessage: 'simplified:Session not found'
      })
      const [, , status] = broadcasts().at(-1)!
      expect(status).toBe('error')
    })

    it('errors when no audio (neither -dictation nor -instruction) was persisted', async () => {
      getSession.mockResolvedValue({ id: 's1' })
      loadAudio.mockResolvedValue(null)
      await handlers.get(IPC.SESSION_RETRY)!(null, 's1')
      expect(loadAudio).toHaveBeenCalledWith('s1-dictation')
      expect(loadAudio).toHaveBeenCalledWith('s1-instruction')
      expect(updateSessionResult).toHaveBeenCalledWith('s1', {
        status: 'error',
        errorMessage: 'simplified:Original audio is no longer available for this session'
      })
    })

    it('falls back to the -instruction audio variant when -dictation is absent', async () => {
      getSession.mockResolvedValue({ id: 's1' })
      loadAudio.mockImplementation(async (id: string) => (id.endsWith('-instruction') ? Buffer.from('x') : null))
      cleanTranscript.mockReturnValue('cleaned')
      transcribeOne.mockResolvedValue('raw transcript')
      await handlers.get(IPC.SESSION_RETRY)!(null, 's1')
      expect(transcribeOne).toHaveBeenCalled()
      expect(updateSessionResult).toHaveBeenCalledWith('s1', {
        dictationTranscript: 'cleaned',
        output: 'cleaned',
        status: 'done',
        flowType: 'dictation'
      })
    })

    it('errors when the STT provider has no API key configured', async () => {
      getSession.mockResolvedValue({ id: 's1' })
      loadAudio.mockResolvedValue(Buffer.from('x'))
      hasApiKey.mockReturnValue(false)
      getSetting.mockReturnValue({ provider: 'groq' })
      await handlers.get(IPC.SESSION_RETRY)!(null, 's1')
      expect(updateSessionResult).toHaveBeenCalledWith('s1', {
        status: 'error',
        errorMessage: 'simplified:Add your groq API key in Settings to retry'
      })
    })

    it('errors when the cleaned transcript is empty (no speech detected)', async () => {
      getSession.mockResolvedValue({ id: 's1' })
      loadAudio.mockResolvedValue(Buffer.from('x'))
      transcribeOne.mockResolvedValue('   ')
      cleanTranscript.mockReturnValue('')
      await handlers.get(IPC.SESSION_RETRY)!(null, 's1')
      expect(updateSessionResult).toHaveBeenCalledWith('s1', {
        status: 'error',
        errorMessage: 'simplified:No speech detected in the recording'
      })
    })

    it('on success: broadcasts processing then done, and writes only the success patch (omitting errorMessage)', async () => {
      getSession.mockResolvedValue({ id: 's1' })
      loadAudio.mockResolvedValue(Buffer.from('x'))
      transcribeOne.mockResolvedValue('raw')
      cleanTranscript.mockReturnValue('clean output')
      await handlers.get(IPC.SESSION_RETRY)!(null, 's1')

      const patch = { dictationTranscript: 'clean output', output: 'clean output', status: 'done', flowType: 'dictation' }
      expect(updateSessionResult).toHaveBeenCalledWith('s1', patch)

      const calls = broadcasts()
      expect(calls[0]).toEqual([IPC.SESSION_RETRY_STATUS, 's1', 'processing'])
      expect(calls.at(-1)).toEqual([IPC.SESSION_RETRY_STATUS, 's1', 'done'])
      // fans out to every window
      expect(windows[1].webContents.send).toHaveBeenCalled()
    })

    it('ignores a concurrent retry for the same session id already in flight', async () => {
      getSession.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ id: 's1' }), 5)))
      loadAudio.mockResolvedValue(Buffer.from('x'))
      transcribeOne.mockResolvedValue('raw')
      cleanTranscript.mockReturnValue('out')
      const first = handlers.get(IPC.SESSION_RETRY)!(null, 's1') as Promise<void>
      const second = handlers.get(IPC.SESSION_RETRY)!(null, 's1') as Promise<void>
      await Promise.all([first, second])
      // getSession is only entered once — the second call short-circuited on the `retrying` guard.
      expect(getSession).toHaveBeenCalledTimes(1)
    })

    it('allows a fresh retry once the previous one has completed (retrying set cleared in finally)', async () => {
      getSession.mockResolvedValue({ id: 's1' })
      loadAudio.mockResolvedValue(Buffer.from('x'))
      transcribeOne.mockResolvedValue('raw')
      cleanTranscript.mockReturnValue('out')
      await handlers.get(IPC.SESSION_RETRY)!(null, 's1')
      await handlers.get(IPC.SESSION_RETRY)!(null, 's1')
      expect(getSession).toHaveBeenCalledTimes(2)
    })
  })
})
