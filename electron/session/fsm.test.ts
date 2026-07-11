import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SessionMode } from '../../shared/types'
import type { PipelineResult } from './pipeline'

// ── Hoisted mock state (vi.mock factories are hoisted above imports, so any
// state they reference must be declared via vi.hoisted). fsm.ts self-
// subscribes and instantiates a singleton at module load — every dependency
// it touches is mocked here BEFORE importing it. ───────────────────────────
const {
  getSettingMock,
  holdAudioMock,
  releaseAudioMock,
  saveSessionMock,
  keyListenerMock,
  keyBindingsMock,
  getFrontmostAppMock,
  detectProfileMock,
  captureSelectedTextMock,
  pausePlayingMediaMock,
  resumePausedMediaMock,
  showHUDMock,
  hideHUDMock,
  getHUDMock,
  setTrayRecordingMock,
  setTrayIdleMock,
  reportErrorMock,
  simplifyErrorMock,
  runPipelineMock,
  trackChunkMock,
  newAudioTrackMock
} = vi.hoisted(() => {
  return {
    getSettingMock: vi.fn(),
    holdAudioMock: vi.fn(),
    releaseAudioMock: vi.fn(),
    saveSessionMock: vi.fn().mockResolvedValue(undefined),
    keyListenerMock: { enableEscape: vi.fn(), command: vi.fn() },
    keyBindingsMock: { resetState: vi.fn() },
    getFrontmostAppMock: vi.fn(),
    detectProfileMock: vi.fn(),
    captureSelectedTextMock: vi.fn(),
    pausePlayingMediaMock: vi.fn(),
    resumePausedMediaMock: vi.fn(),
    showHUDMock: vi.fn(),
    hideHUDMock: vi.fn((cb?: () => void) => {
      cb?.()
      return Promise.resolve()
    }),
    getHUDMock: vi.fn(() => null as any),
    setTrayRecordingMock: vi.fn(),
    setTrayIdleMock: vi.fn(),
    reportErrorMock: vi.fn(),
    simplifyErrorMock: vi.fn((m: string) => `simplified:${m}`),
    runPipelineMock: vi.fn(),
    trackChunkMock: vi.fn((session: any, mode: string, chunkIndex: number, buffer: Buffer) => {
      session[mode].chunks.set(chunkIndex, { buffer, transcript: null, promise: null, error: null })
    }),
    newAudioTrackMock: vi.fn((engaged: boolean) => ({ chunks: new Map(), total: null, engaged }))
  }
})

vi.mock('../store/settings', () => ({ getSetting: getSettingMock }))
vi.mock('../store/audio', () => ({ holdAudio: holdAudioMock, releaseAudio: releaseAudioMock }))
vi.mock('../store/sessions', () => ({ saveSession: saveSessionMock }))
vi.mock('../keys/listener', () => ({ keyListener: keyListenerMock }))
vi.mock('../keys/bindings', () => ({ keyBindings: keyBindingsMock }))
vi.mock('../prompts/frontmostApp', () => ({ getFrontmostApp: getFrontmostAppMock }))
vi.mock('../prompts/appProfiles', () => ({ detectProfile: detectProfileMock }))
vi.mock('../output/selection', () => ({ captureSelectedText: captureSelectedTextMock }))
vi.mock('../output/media', () => ({ pausePlayingMedia: pausePlayingMediaMock, resumePausedMedia: resumePausedMediaMock }))
vi.mock('../windows/hud', () => ({ showHUD: showHUDMock, hideHUD: hideHUDMock, getHUD: getHUDMock }))
vi.mock('../windows/tray', () => ({ setTrayRecording: setTrayRecordingMock, setTrayIdle: setTrayIdleMock }))
vi.mock('../errors', () => ({ reportError: reportErrorMock, simplifyError: simplifyErrorMock }))
vi.mock('./pipeline', () => ({
  runPipeline: runPipelineMock,
  trackChunk: trackChunkMock,
  newAudioTrack: newAudioTrackMock
}))

import { sessionFsm } from './fsm'
import { IPC } from '../../shared/ipc'
import { TIMEOUTS } from '../config'

const BIG = 10_000 // MIN_FINAL_CHUNK_BYTES (not exported) — trailing-final-chunk threshold.

function bigBuffer(n = BIG): Buffer {
  return Buffer.alloc(n)
}
function smallBuffer(n = 100): Buffer {
  return Buffer.alloc(n)
}

async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

let hudSend: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  hudSend = vi.fn()
  getHUDMock.mockReturnValue({ webContents: { send: hudSend } } as any)
  getSettingMock.mockImplementation((key: string) => (key === 'pauseMediaDuringDictation' ? false : undefined))
  detectProfileMock.mockReturnValue('default')
  getFrontmostAppMock.mockResolvedValue(null)
  captureSelectedTextMock.mockResolvedValue(null)
  runPipelineMock.mockReset()
  runPipelineMock.mockResolvedValue({ outcome: 'skipped' } satisfies PipelineResult)
})

afterEach(async () => {
  // Drain any pending timers (ack guards, hud-hide delays, undo windows) so
  // state never leaks into the next test.
  try {
    await vi.advanceTimersByTimeAsync(20_000)
  } catch {
    /* ignore */
  }
  if (sessionFsm.current()) sessionFsm.cancel()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** Start a dictation session and get its final chunk into the track quickly
 *  (buffer big enough to clear MIN_FINAL_CHUNK_BYTES) so stop() proceeds
 *  through the "chunks already present" fast path of waitForAudio. */
async function startAndFeedAudio(mode: SessionMode = 'dictation'): Promise<void> {
  sessionFsm.start(mode)
  await tick(0)
  sessionFsm.audioFinal({ buffer: bigBuffer(), chunkIndex: 0, totalChunks: 1, duration: 1, mode })
}

describe('start()', () => {
  it('creates a recording session, shows the HUD, and announces RECORDING_START', async () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()
    expect(s).not.toBeNull()
    expect(s!.phase).toBe('recording')
    expect(s!.mode).toBe('dictation')
    expect(showHUDMock).toHaveBeenCalled()
    expect(hudSend).toHaveBeenCalledWith(IPC.RECORDING_START, 'dictation', s!.id)
    expect(setTrayRecordingMock).toHaveBeenCalledWith('dictation')
    expect(keyListenerMock.enableEscape).toHaveBeenCalledWith(true)
  })

  it('pauses media when pauseMediaDuringDictation is enabled', async () => {
    getSettingMock.mockImplementation((key: string) => key === 'pauseMediaDuringDictation')
    sessionFsm.start('dictation')
    expect(pausePlayingMediaMock).toHaveBeenCalled()
  })

  it('does not pause media when the setting is disabled', async () => {
    sessionFsm.start('dictation')
    expect(pausePlayingMediaMock).not.toHaveBeenCalled()
  })

  it('rejects a start while processing and sends the discard hint', async () => {
    runPipelineMock.mockReturnValue(new Promise(() => {})) // stay pending
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(sessionFsm.processing).toBe(true)

    sessionFsm.start('instruction')
    expect(hudSend).toHaveBeenCalledWith(IPC.PROCESSING_SHOW_DISCARD_HINT)
    expect(keyBindingsMock.resetState).toHaveBeenCalled()
    expect(sessionFsm.current()!.mode).toBe('dictation') // unchanged — new start was rejected
  })

  describe('dictation frontmost-app detection', () => {
    it('updates appId/name/profile and re-announces when the profile is non-default', async () => {
      let resolveApp!: (v: { id: string; name: string } | null) => void
      getFrontmostAppMock.mockReturnValue(new Promise((r) => (resolveApp = r)))
      detectProfileMock.mockReturnValue('email')

      sessionFsm.start('dictation')
      const s = sessionFsm.current()!
      resolveApp({ id: 'com.apple.mail', name: 'Mail' })
      await tick(0)

      expect(s.appId).toBe('com.apple.mail')
      expect(s.appName).toBe('Mail')
      expect(s.profile).toBe('email')
      expect(hudSend).toHaveBeenCalledWith(IPC.RECORDING_START, 'dictation', s.id, 'Mail', 'email')
    })

    it('updates fields but does not re-announce when the profile stays default', async () => {
      getFrontmostAppMock.mockResolvedValue({ id: 'com.apple.finder', name: 'Finder' })
      detectProfileMock.mockReturnValue('default')

      sessionFsm.start('dictation')
      const s = sessionFsm.current()!
      await tick(0)

      expect(s.appId).toBe('com.apple.finder')
      expect(s.profile).toBe('default')
      // Only the initial RECORDING_START (no appName/profile args) was sent.
      expect(hudSend).toHaveBeenCalledTimes(1)
    })

    it('leaves the session unchanged when no frontmost app is found', async () => {
      getFrontmostAppMock.mockResolvedValue(null)
      sessionFsm.start('dictation')
      const s = sessionFsm.current()!
      await tick(0)
      expect(s.appId).toBeNull()
    })

    it('is silently ignored when getFrontmostApp rejects', async () => {
      getFrontmostAppMock.mockRejectedValue(new Error('boom'))
      sessionFsm.start('dictation')
      await tick(0)
      expect(sessionFsm.current()).not.toBeNull() // did not throw / crash the session
    })

    it('is skipped for instruction-mode sessions', async () => {
      sessionFsm.start('instruction')
      await tick(0)
      expect(getFrontmostAppMock).not.toHaveBeenCalled()
    })

    it('wires the FRONTAPP helper command through to keyListener.command', async () => {
      sessionFsm.start('dictation')
      const helperCommand = getFrontmostAppMock.mock.calls[0][0] as (cmd: string) => unknown
      helperCommand('FRONTAPP')
      expect(keyListenerMock.command).toHaveBeenCalledWith('FRONTAPP')
      await tick(0)
    })

    it('discards a late resolution once the session has moved past "recording"', async () => {
      let resolveApp!: (v: { id: string; name: string } | null) => void
      getFrontmostAppMock.mockReturnValue(new Promise((r) => (resolveApp = r)))
      await startAndFeedAudio()
      const s = sessionFsm.current()!
      sessionFsm.stop('dictation') // phase -> awaiting-audio, still same session object
      resolveApp({ id: 'com.apple.mail', name: 'Mail' })
      await tick(0)
      expect(s.appId).toBeNull() // guarded: phase is no longer 'recording'
    })
  })

  describe('selection capture (fires ~50ms after start)', () => {
    it('assigns selectedText with role "quote" for dictation sessions', async () => {
      captureSelectedTextMock.mockResolvedValue('captured text')
      sessionFsm.start('dictation')
      const s = sessionFsm.current()!
      await tick(50)
      expect(s.selectedText).toBe('captured text')
      expect(s.selectedTextRole).toBe('quote')
    })

    it('assigns selectedText with role "context" for instruction sessions', async () => {
      captureSelectedTextMock.mockResolvedValue('captured text')
      sessionFsm.start('instruction')
      const s = sessionFsm.current()!
      await tick(50)
      expect(s.selectedTextRole).toBe('context')
    })

    it('does nothing when no text was captured', async () => {
      captureSelectedTextMock.mockResolvedValue(null)
      sessionFsm.start('dictation')
      const s = sessionFsm.current()!
      await tick(50)
      expect(s.selectedText).toBeNull()
    })

    it('wires the paste/copy helper command through to keyListener.command', async () => {
      sessionFsm.start('dictation')
      await tick(50)
      const helperCommand = captureSelectedTextMock.mock.calls[0][0].helperCommand as (cmd: string) => unknown
      helperCommand('COPY')
      expect(keyListenerMock.command).toHaveBeenCalledWith('COPY')
    })

    it('is silently ignored when captureSelectedText rejects', async () => {
      captureSelectedTextMock.mockRejectedValue(new Error('clipboard fail'))
      sessionFsm.start('dictation')
      await tick(50)
      expect(sessionFsm.current()).not.toBeNull()
    })

    it('discards a late capture once the session has been superseded', async () => {
      let resolveCapture!: (v: string | null) => void
      captureSelectedTextMock.mockReturnValue(new Promise((r) => (resolveCapture = r)))
      sessionFsm.start('dictation')
      const s = sessionFsm.current()!
      sessionFsm.cancel() // supersedes: this.session becomes null
      resolveCapture('too late')
      await tick(50)
      expect(s.selectedText).toBeNull()
    })
  })
})

describe('chain()', () => {
  it('rejects while processing and sends the discard hint', async () => {
    runPipelineMock.mockReturnValue(new Promise(() => {})) // stay pending
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    sessionFsm.chain('instruction')
    expect(hudSend).toHaveBeenCalledWith(IPC.PROCESSING_SHOW_DISCARD_HINT)
  })

  it('delegates to start() when there is no active session', () => {
    sessionFsm.chain('instruction')
    expect(sessionFsm.current()!.mode).toBe('instruction')
    expect(sessionFsm.current()!.phase).toBe('recording')
  })

  it('switches mode on the active session and marks it chained', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.chain('instruction')
    expect(s.mode).toBe('instruction')
    expect(s.phase).toBe('chained')
    expect(s.instruction.engaged).toBe(true)
    expect(hudSend).toHaveBeenCalledWith(IPC.RECORDING_START, 'instruction', s.id)
    expect(setTrayRecordingMock).toHaveBeenCalledWith('instruction')
  })
})

describe('recordingAck()', () => {
  it('is a no-op when there is no active session', () => {
    expect(() => sessionFsm.recordingAck('whatever')).not.toThrow()
  })

  it('is a no-op for a foreign session id', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.recordingAck('not-this-session')
    expect(s.ackTimer).not.toBeNull()
  })

  it('clears the ack guard timer', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.recordingAck(s.id)
    expect(s.ackTimer).toBeNull()
  })

  it('is a no-op when called twice (timer already cleared)', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.recordingAck(s.id)
    expect(() => sessionFsm.recordingAck(s.id)).not.toThrow()
  })

  it('logs a warning when no ack ever arrives', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sessionFsm.start('dictation')
    await tick(TIMEOUTS.request) // > ACK_GUARD_MS (2000ms)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no RECORDING_ACK'), expect.any(String))
    warn.mockRestore()
  })
})

describe('stop()', () => {
  it('warns and no-ops when there is no active session', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sessionFsm.stop('dictation')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('resets keybinding state and no-ops while processing', async () => {
    runPipelineMock.mockReturnValue(new Promise(() => {})) // stay pending
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    keyBindingsMock.resetState.mockClear()
    sessionFsm.stop('dictation')
    expect(keyBindingsMock.resetState).toHaveBeenCalled()
  })

  it('ignores stop() when the phase is neither recording nor chained', async () => {
    sessionFsm.start('dictation')
    sessionFsm.stop('dictation') // -> awaiting-audio (no chunks yet)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    sessionFsm.stop('dictation') // phase is now 'awaiting-audio' — ignored
    expect(log).toHaveBeenCalledWith(expect.stringContaining('stop() ignored'), 'awaiting-audio', ')')
    log.mockRestore()
  })

  it('moves to awaiting-audio and requests the pipeline once audio resolves', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'output' } satisfies PipelineResult)
    await startAndFeedAudio()
    const s = sessionFsm.current()!
    sessionFsm.stop('dictation')
    expect(s.phase).toBe('awaiting-audio')
    expect(hudSend).toHaveBeenCalledWith(IPC.RECORDING_STOP, s.id)
    await tick(0)
    expect(runPipelineMock).toHaveBeenCalled()
  })
})

describe('waitForAudio via stop()', () => {
  it('resolves once AUDIO_FINAL arrives after stop()', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'skipped' } satisfies PipelineResult)
    sessionFsm.start('dictation')
    await tick(0)
    sessionFsm.stop('dictation') // no chunks yet -> waits
    await tick(0)
    expect(runPipelineMock).not.toHaveBeenCalled()
    sessionFsm.audioFinal({ buffer: bigBuffer(), chunkIndex: 0, totalChunks: 1, duration: 1, mode: 'dictation' })
    await tick(0)
    expect(runPipelineMock).toHaveBeenCalled()
  })

  it('proceeds anyway once the audio-arrival guard timer fires', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'skipped' } satisfies PipelineResult)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sessionFsm.start('dictation')
    await tick(0)
    sessionFsm.stop('dictation')
    await tick(TIMEOUTS.audioArrival + 10)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('audio arrival guard fired'))
    warn.mockRestore()
  })

  it('never calls the pipeline when the session was cancelled while awaiting audio', async () => {
    sessionFsm.start('dictation')
    await tick(0)
    sessionFsm.stop('dictation')
    sessionFsm.cancel()
    await tick(TIMEOUTS.audioArrival + 10)
    expect(runPipelineMock).not.toHaveBeenCalled()
  })
})

describe('audioChunk / audioFinal / audioDiscarded', () => {
  it('audioChunk holds and tracks the buffer for the active session', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.audioChunk({ buffer: smallBuffer(), chunkIndex: 0, mode: 'dictation' })
    expect(holdAudioMock).toHaveBeenCalledWith(`${s.id}-dictation`, expect.any(Buffer))
    expect(trackChunkMock).toHaveBeenCalledWith(s, 'dictation', 0, expect.any(Buffer))
  })

  it('audioChunk tracks small buffers too (no size gate without totalChunks)', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.audioChunk({ buffer: smallBuffer(), chunkIndex: 1, mode: 'dictation' })
    expect(s.dictation.chunks.size).toBe(1)
  })

  it('is a no-op for an unrecognized/foreign sessionId', () => {
    sessionFsm.start('dictation')
    sessionFsm.audioChunk({ buffer: smallBuffer(), chunkIndex: 0, mode: 'dictation', sessionId: 'nope' })
    expect(holdAudioMock).not.toHaveBeenCalled()
  })

  it('audioFinal is a no-op for an unrecognized/foreign sessionId', () => {
    sessionFsm.start('dictation')
    sessionFsm.audioFinal({
      buffer: bigBuffer(),
      chunkIndex: 0,
      totalChunks: 1,
      duration: 1,
      mode: 'dictation',
      sessionId: 'nope'
    })
    expect(holdAudioMock).not.toHaveBeenCalled()
  })

  it('audioFinal tracks a large enough final chunk and records total', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.audioFinal({ buffer: bigBuffer(), chunkIndex: 0, totalChunks: 3, duration: 2, mode: 'dictation' })
    expect(s.dictation.total).toBe(3)
    expect(trackChunkMock).toHaveBeenCalled()
  })

  it('skips transcription for a tiny trailing final chunk but still records total', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.audioFinal({ buffer: smallBuffer(), chunkIndex: 0, totalChunks: 1, duration: 0.1, mode: 'dictation' })
    expect(s.dictation.total).toBe(1)
    expect(trackChunkMock).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('final chunk under threshold'))
    log.mockRestore()
  })

  it('audioFinal resolves a pending waitForAudio resolver for its mode', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'skipped' } satisfies PipelineResult)
    sessionFsm.start('dictation')
    await tick(0)
    sessionFsm.stop('dictation')
    expect(sessionFsm.current()!.awaitResolvers.dictation).toBeTypeOf('function')
    sessionFsm.audioFinal({ buffer: bigBuffer(), chunkIndex: 0, totalChunks: 1, duration: 1, mode: 'dictation' })
    await tick(0)
    expect(runPipelineMock).toHaveBeenCalled()
  })

  it('audioDiscarded resolves both mode resolvers when present', async () => {
    sessionFsm.start('dictation')
    await tick(0)
    sessionFsm.stop('dictation')
    const s = sessionFsm.current()!
    expect(s.awaitResolvers.dictation).toBeTypeOf('function')
    runPipelineMock.mockResolvedValue({ outcome: 'skipped' } satisfies PipelineResult)
    sessionFsm.audioDiscarded(s.id)
    await tick(0)
    expect(s.awaitResolvers.dictation).toBeUndefined()
  })

  it('audioDiscarded is a no-op when no session matches', () => {
    expect(() => sessionFsm.audioDiscarded('nope')).not.toThrow()
  })

  it('accepts late audio for a cancelled session within its undo window', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.cancelWithUndo()
    sessionFsm.audioChunk({ buffer: smallBuffer(), chunkIndex: 5, mode: 'dictation', sessionId: s.id })
    expect(holdAudioMock).toHaveBeenCalledWith(`${s.id}-dictation`, expect.any(Buffer))
  })
})

describe('beginProcessing outcomes', () => {
  it('reports too-short and finishes without persisting when no audio was captured at all', async () => {
    sessionFsm.start('dictation')
    await tick(0)
    sessionFsm.stop('dictation') // no chunks ever arrive
    await tick(TIMEOUTS.audioArrival + 10)
    expect(hudSend).toHaveBeenCalledWith(IPC.SESSION_TOO_SHORT)
    expect(saveSessionMock).not.toHaveBeenCalled()
    expect(sessionFsm.current()).toBeNull()
  })

  it('swallows an AbortError from the pipeline without finishing the session', async () => {
    let rejectPipeline!: (e: unknown) => void
    runPipelineMock.mockReturnValue(new Promise((_r, rej) => (rejectPipeline = rej)))
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(sessionFsm.processing).toBe(true)
    const err = new Error('aborted')
    err.name = 'AbortError'
    rejectPipeline(err)
    await tick(0)
    expect(sessionFsm.processing).toBe(false)
    expect(reportErrorMock).not.toHaveBeenCalled()
    // Session was neither finished (no HUD hide dispatch) nor errored.
    expect(hudSend).not.toHaveBeenCalledWith(IPC.OUTPUT_ERROR, expect.anything(), expect.anything())
  })

  it('routes a generic pipeline rejection to handleError', async () => {
    runPipelineMock.mockRejectedValue(new Error('provider down'))
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(reportErrorMock).toHaveBeenCalledWith('session', 'provider down')
    expect(simplifyErrorMock).toHaveBeenCalledWith('provider down')
    expect(hudSend).toHaveBeenCalledWith(IPC.OUTPUT_ERROR, 'simplified:provider down', expect.any(String))
  })

  it('stringifies a non-Error rejection reason', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    runPipelineMock.mockRejectedValue('raw string failure')
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(reportErrorMock).toHaveBeenCalledWith('session', 'raw string failure')
  })

  it('ignores a stale pipeline resolution once the session was cancelled mid-flight', async () => {
    let resolvePipeline!: (r: PipelineResult) => void
    runPipelineMock.mockReturnValue(new Promise((r) => (resolvePipeline = r)))
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    sessionFsm.cancel() // this.session becomes null while the pipeline call is still pending
    resolvePipeline({ outcome: 'output' })
    await tick(0)
    // No OUTPUT_READY should be dispatched for the now-superseded session.
    expect(hudSend).not.toHaveBeenCalledWith(IPC.OUTPUT_READY, expect.anything(), expect.anything())
  })

  it('ignores a stale pipeline rejection once the session was cancelled mid-flight', async () => {
    let rejectPipeline!: (e: unknown) => void
    runPipelineMock.mockReturnValue(new Promise((_r, rej) => (rejectPipeline = rej)))
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    sessionFsm.cancel()
    rejectPipeline(new Error('too late'))
    await tick(0)
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})

describe('handleResult outcomes', () => {
  it('outcome "skipped" finishes as done with a short delay, no HUD output event', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'skipped' } satisfies PipelineResult)
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(saveSessionMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }))
    expect(hudSend).not.toHaveBeenCalledWith(IPC.OUTPUT_READY, expect.anything(), expect.anything())
    expect(hudSend).not.toHaveBeenCalledWith(IPC.OUTPUT_FALLBACK, expect.anything(), expect.anything())
  })

  it('outcome "fallback" sends OUTPUT_FALLBACK and records the error message', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'fallback', message: 'partial notice' } satisfies PipelineResult)
    await startAndFeedAudio()
    const s = sessionFsm.current()!
    s.output = 'raw fallback text'
    sessionFsm.stop('dictation')
    await tick(0)
    expect(hudSend).toHaveBeenCalledWith(IPC.OUTPUT_FALLBACK, 'raw fallback text', s.id, 'partial notice')
    expect(saveSessionMock).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'partial notice' }))
  })

  it('outcome "fallback" defaults errorMessage to null when no message is given', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'fallback' } satisfies PipelineResult)
    await startAndFeedAudio()
    const s = sessionFsm.current()!
    sessionFsm.stop('dictation')
    await tick(0)
    expect(s.errorMessage).toBeNull()
  })

  it('outcome "output" sends OUTPUT_READY', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'output' } satisfies PipelineResult)
    await startAndFeedAudio()
    const s = sessionFsm.current()!
    s.output = 'final text'
    sessionFsm.stop('dictation')
    await tick(0)
    expect(hudSend).toHaveBeenCalledWith(IPC.OUTPUT_READY, 'final text', s.id)
  })

  it('wires the pipeline helperCommand dep through to keyListener.command', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'output' } satisfies PipelineResult)
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    const deps = runPipelineMock.mock.calls[0][1] as { helperCommand: (cmd: string) => unknown }
    deps.helperCommand('PASTE')
    expect(keyListenerMock.command).toHaveBeenCalledWith('PASTE')
  })

  it('emits a fully-populated complete Session record and persists it', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'output' } satisfies PipelineResult)
    await startAndFeedAudio()
    const s = sessionFsm.current()!
    s.dictationTranscript = 'hi there'
    s.instructionTranscript = 'do it'
    s.selectedText = 'sel'
    s.selectedTextRole = 'context'
    s.output = 'final'
    s.audioRef = 'ref.webm'
    sessionFsm.stop('dictation')
    await tick(0)
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: s.id,
        flowType: 'dictation',
        dictationTranscript: 'hi there',
        instructionTranscript: 'do it',
        selectedText: 'sel',
        selectedTextRole: 'context',
        output: 'final',
        audioRef: 'ref.webm',
        status: 'done'
      })
    )
  })

  it('logs but does not throw when saveSession rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    saveSessionMock.mockRejectedValueOnce(new Error('disk full'))
    runPipelineMock.mockResolvedValue({ outcome: 'output' } satisfies PipelineResult)
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('saveSession failed'), 'disk full')
    err.mockRestore()
  })

  it('stringifies a non-Error saveSession rejection reason', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    // eslint-disable-next-line prefer-promise-reject-errors
    saveSessionMock.mockRejectedValueOnce('disk gremlins')
    runPipelineMock.mockResolvedValue({ outcome: 'output' } satisfies PipelineResult)
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('saveSession failed'), 'disk gremlins')
    err.mockRestore()
  })
})

describe('finish() teardown + HUD hide', () => {
  it('runs teardown and hides the HUD after the outcome delay', async () => {
    runPipelineMock.mockResolvedValue({ outcome: 'output' } satisfies PipelineResult)
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0) // lets handleResult -> finish() run, scheduling the hide timer
    await tick(1200) // OUTPUT_READY delay
    expect(resumePausedMediaMock).toHaveBeenCalled()
    expect(setTrayIdleMock).toHaveBeenCalled()
    expect(keyListenerMock.enableEscape).toHaveBeenCalledWith(false)
    expect(keyBindingsMock.resetState).toHaveBeenCalled()
    expect(hudSend).toHaveBeenCalledWith(IPC.HUD_HIDE)
  })
})

describe('cancel()', () => {
  it('is a no-op when there is no active session', () => {
    sessionFsm.cancel()
    expect(releaseAudioMock).not.toHaveBeenCalled()
  })

  it('aborts the session, releases audio, tears down, and hides the HUD', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.cancel()
    expect(s.abort.signal.aborted).toBe(true)
    expect(releaseAudioMock).toHaveBeenCalledWith(`${s.id}-dictation`)
    expect(releaseAudioMock).toHaveBeenCalledWith(`${s.id}-instruction`)
    expect(sessionFsm.current()).toBeNull()
    expect(setTrayIdleMock).toHaveBeenCalled()
    expect(hudSend).toHaveBeenCalledWith(IPC.HUD_HIDE)
  })

  it('clears processingNow so a subsequent start() is accepted', async () => {
    let resolvePipeline!: (r: PipelineResult) => void
    runPipelineMock.mockReturnValue(new Promise((r) => (resolvePipeline = r)))
    await startAndFeedAudio()
    sessionFsm.stop('dictation')
    await tick(0)
    expect(sessionFsm.processing).toBe(true)
    sessionFsm.cancel()
    expect(sessionFsm.processing).toBe(false)
    sessionFsm.start('instruction')
    expect(sessionFsm.current()!.mode).toBe('instruction')
    resolvePipeline({ outcome: 'skipped' }) // let the orphaned pipeline call settle
    await tick(0)
  })
})

describe('cancelWithUndo() / undoCancel()', () => {
  it('cancelWithUndo is a no-op when there is no active session', () => {
    sessionFsm.cancelWithUndo()
    expect(hudSend).not.toHaveBeenCalledWith(IPC.SESSION_CANCELLED)
  })

  it('moves the session into the undo window and announces SESSION_CANCELLED', () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.cancelWithUndo()
    expect(s.abort.signal.aborted).toBe(true)
    expect(hudSend).toHaveBeenCalledWith(IPC.RECORDING_STOP, s.id)
    expect(hudSend).toHaveBeenCalledWith(IPC.SESSION_CANCELLED)
    expect(sessionFsm.current()).toBeNull()
  })

  it('releases audio and hides the HUD once the undo window expires', async () => {
    sessionFsm.start('dictation')
    const s = sessionFsm.current()!
    sessionFsm.cancelWithUndo()
    await tick(TIMEOUTS.undoWindow + 10)
    expect(releaseAudioMock).toHaveBeenCalledWith(`${s.id}-dictation`)
    expect(hudSend).toHaveBeenCalledWith(IPC.HUD_HIDE)
  })

  it('undoCancel is a no-op when there is no cancelled session', () => {
    expect(() => sessionFsm.undoCancel()).not.toThrow()
    expect(sessionFsm.current()).toBeNull()
  })

  it('undoCancel restores the session with a fresh AbortController and resumes processing', async () => {
    runPipelineMock.mockReturnValue(new Promise(() => {})) // stay pending — just verifying it was invoked
    await startAndFeedAudio()
    const s = sessionFsm.current()!
    sessionFsm.cancelWithUndo()
    expect(s.abort.signal.aborted).toBe(true)
    sessionFsm.undoCancel()
    expect(sessionFsm.current()).toBe(s)
    expect(s.phase).toBe('processing')
    expect(s.abort.signal.aborted).toBe(false) // replaced with a fresh controller
    expect(showHUDMock).toHaveBeenCalled()
    await tick(0)
    expect(runPipelineMock).toHaveBeenCalled()
  })

  it('a stale undo-expiry timer for a superseded cancelled session is a no-op', async () => {
    // First cancel-with-undo cycle (never undone).
    sessionFsm.start('dictation')
    const first = sessionFsm.current()!
    sessionFsm.cancelWithUndo()

    // Second cycle starts and cancels-with-undo before the first timer fires,
    // replacing `cancelledSession` — the first timer's expiry callback fires
    // at the same virtual time, sees `cancelledSession` is no longer `first`,
    // and no-ops (line: `if (this.cancelledSession !== session) return`).
    sessionFsm.start('dictation')
    const second = sessionFsm.current()!
    sessionFsm.cancelWithUndo()

    releaseAudioMock.mockClear()
    await tick(TIMEOUTS.undoWindow + 10) // both timers fire, first's is a no-op
    expect(releaseAudioMock).not.toHaveBeenCalledWith(`${first.id}-dictation`)
    expect(releaseAudioMock).toHaveBeenCalledWith(`${second.id}-dictation`)
  })
})
