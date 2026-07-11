// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Recorder, MIN_DURATION_MS, MAX_DURATION_MS } from './recorder'
import type { ElectronAPI } from '../../shared/types'

/** Minimal MediaStream stub — just enough for cleanup()/stream.active checks. */
class FakeMediaStream {
  active = true
  private tracks: FakeTrack[] = [new FakeTrack()]
  getTracks(): FakeTrack[] {
    return this.tracks
  }
}
class FakeTrack {
  stop = vi.fn()
}

interface FakeRecorderInstance {
  state: 'inactive' | 'recording'
  ondataavailable: ((e: { data: { size: number } }) => void) | null
  onstop: (() => void) | null
  start: (ms?: number) => void
  stop: () => void
  emit(size: number): void
}

/** Controls how the stubbed MediaRecorder.stop() behaves per-test. */
let stopBehavior: 'sync' | 'async' | 'never' | 'throw' = 'sync'
let lastRecorderInstance: FakeRecorderInstance | null = null
let lastStream: FakeMediaStream | null = null
let getUserMediaBehavior: 'resolve' | 'reject' = 'resolve'
let audioContextCloseBehavior: 'resolve' | 'reject' = 'resolve'

function installGlobals(): void {
  ;(global as any).MediaRecorder = class implements FakeRecorderInstance {
    state: 'inactive' | 'recording' = 'recording'
    ondataavailable: ((e: { data: { size: number } }) => void) | null = null
    onstop: (() => void) | null = null
    constructor(
      public stream: FakeMediaStream,
      public opts: unknown
    ) {
      lastRecorderInstance = this
    }
    start(): void {
      this.state = 'recording'
    }
    stop(): void {
      if (stopBehavior === 'throw') {
        throw new Error('stop failed')
      }
      this.state = 'inactive'
      if (stopBehavior === 'sync') {
        this.onstop?.()
      } else if (stopBehavior === 'async') {
        setTimeout(() => this.onstop?.(), 10)
      }
      // 'never': don't call onstop at all — exercises the STOP_TIMEOUT_MS path.
    }
    emit(size: number): void {
      this.ondataavailable?.({ data: { size } as any })
    }
  }

  class FakeAnalyser {
    fftSize = 0
    frequencyBinCount = 4
    getByteTimeDomainData(arr: Uint8Array): void {
      // Silence by default (mid-point 128).
      arr.fill(analyserRms)
    }
  }
  let analyserInstance: FakeAnalyser | null = null

  ;(global as any).AudioContext = class {
    createMediaStreamSource(_stream: unknown): { connect: (n: unknown) => void } {
      return { connect: vi.fn() }
    }
    createAnalyser(): FakeAnalyser {
      analyserInstance = new FakeAnalyser()
      return analyserInstance
    }
    close(): Promise<void> {
      return audioContextCloseBehavior === 'reject' ? Promise.reject(new Error('close failed')) : Promise.resolve()
    }
  }

  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockImplementation(() => {
        if (getUserMediaBehavior === 'reject') return Promise.reject(new Error('denied'))
        lastStream = new FakeMediaStream()
        return Promise.resolve(lastStream)
      })
    },
    configurable: true
  })
}

// Byte value fed to getByteTimeDomainData — 128 = silence, drive higher for "speech".
let analyserRms = 128

function mockElectronAPI(): ElectronAPI {
  return {
    onRecordingStart: vi.fn(),
    onRecordingStop: vi.fn(),
    recordingAck: vi.fn(),
    sendAudioChunk: vi.fn(),
    sendAudioFinal: vi.fn(),
    sendAudioDiscarded: vi.fn(),
    onOutputReady: vi.fn(),
    onOutputFallback: vi.fn(),
    onOutputError: vi.fn(),
    onSessionCancelled: vi.fn(),
    onSessionTooShort: vi.fn(),
    onProcessingDiscardHint: vi.fn(),
    widgetStop: vi.fn(),
    widgetCancel: vi.fn(),
    widgetUndoCancel: vi.fn(),
    widgetReady: vi.fn(),
    onHudHide: vi.fn(),
    hudExitDone: vi.fn(),
    getSessions: vi.fn(),
    retrySession: vi.fn(),
    onRetryStatus: vi.fn(),
    deleteSession: vi.fn(),
    clearAllSessions: vi.fn(),
    getUsage: vi.fn(),
    resetUsage: vi.fn(),
    getProviderKeyStatus: vi.fn(),
    setProviderKey: vi.fn(),
    testProviderKey: vi.fn(),
    clearProviderKey: vi.fn(),
    listModels: vi.fn(),
    getSettings: vi.fn(),
    onSettingsChanged: vi.fn(),
    setWidgetPosition: vi.fn(),
    setSoundFeedback: vi.fn(),
    setChunkedTranscription: vi.fn(),
    setOutputMode: vi.fn(),
    setInputDevice: vi.fn(),
    setActivationMode: vi.fn(),
    setAutoFormat: vi.fn(),
    setInstructionEnabled: vi.fn(),
    setAppAwareFormatting: vi.fn(),
    setPauseMediaDuringDictation: vi.fn(),
    setDictationBinding: vi.fn(),
    setDictionary: vi.fn(),
    setReplacements: vi.fn(),
    setSnippets: vi.fn(),
    setRules: vi.fn(),
    writeLog: vi.fn(),
    setSTTSettings: vi.fn(),
    setLLMSettings: vi.fn(),
    getTheme: vi.fn(),
    setTheme: vi.fn(),
    permissionsPreflight: vi.fn(),
    openPermissionPane: vi.fn(),
    requestMicPermission: vi.fn(),
    getKeyCapability: vi.fn(),
    getAppConfig: vi.fn(),
    openExternal: vi.fn(),
    onDevErrorLog: vi.fn()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  stopBehavior = 'sync'
  analyserRms = 128
  lastRecorderInstance = null
  lastStream = null
  getUserMediaBehavior = 'resolve'
  audioContextCloseBehavior = 'resolve'
  installGlobals()
  ;(window as any).electronAPI = mockElectronAPI()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

describe('Recorder', () => {
  it('getAnalyser returns null before start and the analyser after', async () => {
    const rec = new Recorder()
    expect(rec.getAnalyser()).toBeNull()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    expect(rec.getAnalyser()).not.toBeNull()
  })

  it('discards a too-short recording (< MIN_DURATION_MS)', async () => {
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    lastRecorderInstance!.emit(100)
    vi.advanceTimersByTime(MIN_DURATION_MS - 100)
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioDiscarded).toHaveBeenCalledWith('dictation', 's1')
    expect(window.electronAPI.sendAudioFinal).not.toHaveBeenCalled()
  })

  it('discards a silent recording with no heard speech', async () => {
    const rec = new Recorder()
    analyserRms = 128 // silence
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    // Advance past MIN_DURATION_MS but never emit data / never exceed silence threshold.
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioDiscarded).toHaveBeenCalledWith('dictation', 's1')
  })

  it('sends a normal (non-chunked) recording as final', async () => {
    const rec = new Recorder()
    analyserRms = 255 // loud -> heardSpeech = true
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    // Let VAD poll at least once to set heardSpeech.
    vi.advanceTimersByTime(100)
    lastRecorderInstance!.emit(500)
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
    const args = (window.electronAPI.sendAudioFinal as any).mock.calls[0]
    expect(args[1]).toBe(0) // chunkIndex
    expect(args[2]).toBe(1) // totalChunks
    expect(args[4]).toBe('dictation')
    expect(args[5]).toBe('s1')
    expect(window.electronAPI.sendAudioDiscarded).not.toHaveBeenCalled()
  })

  it('handles chunked dictation: VAD silence cut emits a chunk, then final chunk on stop', async () => {
    const rec = new Recorder()
    const chunking = {
      enabled: true,
      min_duration_ms: 1000,
      silence_threshold_rms: 0.5,
      silence_duration_ms: 200,
      hard_cap_ms: 100_000,
      vad_poll_interval_ms: 100
    }
    analyserRms = 255 // loud -> rms ~1 > threshold while we want speech
    await rec.start({
      mode: 'dictation',
      sessionId: 's1',
      chunkedTranscription: true,
      chunking
    })
    await flushMicrotasks()

    // Activate chunk splitting (after min_duration_ms).
    vi.advanceTimersByTime(1000)
    lastRecorderInstance!.emit(400)

    // Now go silent to trigger the VAD silence cut.
    analyserRms = 128
    vi.advanceTimersByTime(300) // >= silence_duration_ms after silence starts
    await flushMicrotasks()

    expect(window.electronAPI.sendAudioChunk).toHaveBeenCalledTimes(1)
    const chunkArgs = (window.electronAPI.sendAudioChunk as any).mock.calls[0]
    expect(chunkArgs[1]).toBe(0) // chunkIndex
    expect(chunkArgs[2]).toBe('dictation')
    expect(chunkArgs[3]).toBe('s1')

    // Continue recording, then stop -> final chunk with totalChunks.
    lastRecorderInstance!.emit(200)
    await rec.stop()
    await flushMicrotasks()

    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
    const finalArgs = (window.electronAPI.sendAudioFinal as any).mock.calls[0]
    expect(finalArgs[1]).toBe(1) // chunkIndex after the first cut
    expect(finalArgs[2]).toBe(2) // totalChunks = chunkIndex(1) + 1 (has blobs)
  })

  it('hard cap triggers a queued cut even before silence', async () => {
    const rec = new Recorder()
    const chunking = {
      enabled: true,
      min_duration_ms: 100,
      silence_threshold_rms: 0.5,
      silence_duration_ms: 100000, // never trip via silence
      hard_cap_ms: 500,
      vad_poll_interval_ms: 100
    }
    analyserRms = 255
    await rec.start({
      mode: 'dictation',
      sessionId: 's1',
      chunkedTranscription: true,
      chunking
    })
    await flushMicrotasks()
    lastRecorderInstance!.emit(300)
    vi.advanceTimersByTime(600) // exceed hard cap
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioChunk).toHaveBeenCalledTimes(1)

    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
  })

  it('chunked mode is not activated for instruction mode (chunkedEnabled requires dictation)', async () => {
    const rec = new Recorder()
    analyserRms = 255
    await rec.start({
      mode: 'instruction',
      sessionId: 's1',
      chunkedTranscription: true,
      chunking: {
        enabled: true,
        min_duration_ms: 100,
        silence_threshold_rms: 0.5,
        silence_duration_ms: 50,
        hard_cap_ms: 200,
        vad_poll_interval_ms: 50
      }
    })
    await flushMicrotasks()
    lastRecorderInstance!.emit(300)
    vi.advanceTimersByTime(1000)
    await flushMicrotasks()
    // Never chunked since mode !== 'dictation'.
    expect(window.electronAPI.sendAudioChunk).not.toHaveBeenCalled()
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
  })

  it('stop() times out awaiting onstop (mic yanked) and discards', async () => {
    stopBehavior = 'never'
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    analyserRms = 255
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    lastRecorderInstance!.emit(500)

    const stopPromise = rec.stop()
    await flushMicrotasks()
    vi.advanceTimersByTime(3000) // STOP_TIMEOUT_MS
    await stopPromise
    await flushMicrotasks()

    expect(window.electronAPI.sendAudioDiscarded).toHaveBeenCalledWith('dictation', 's1')
    expect(window.electronAPI.sendAudioFinal).not.toHaveBeenCalled()
  })

  it('rec.stop() throwing synchronously resolves as a discard', async () => {
    stopBehavior = 'throw'
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    analyserRms = 255
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioDiscarded).toHaveBeenCalled()
  })

  it('calling start() twice back-to-back flushes/cleans up the first before the second', async () => {
    const rec = new Recorder()
    const p1 = rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    const p2 = rec.start({ mode: 'dictation', sessionId: 's2', chunkedTranscription: false })
    await Promise.all([p1, p2])
    await flushMicrotasks()
    // Second start's discard (from flushing first, since audioSent stays false
    // and it's a fresh/short "recording") shouldn't crash; session 2 is now active.
    expect(window.electronAPI.sendAudioDiscarded).toHaveBeenCalled()
    // The recorder should now be tracking session 2's recorder instance.
    expect(rec.getAnalyser()).not.toBeNull()
  })

  it('onMaxDuration callback fires after MAX_DURATION_MS', async () => {
    const rec = new Recorder()
    const onMaxDuration = vi.fn()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false, onMaxDuration })
    await flushMicrotasks()
    vi.advanceTimersByTime(MAX_DURATION_MS)
    await flushMicrotasks()
    expect(onMaxDuration).toHaveBeenCalledTimes(1)
  })

  it('without onMaxDuration, max duration triggers an internal stop()', async () => {
    const rec = new Recorder()
    analyserRms = 255
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    lastRecorderInstance!.emit(500)
    vi.advanceTimersByTime(MAX_DURATION_MS)
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
  })

  it('flush(false) VAD cut with no pending blobs skips emit and restarts recorder', async () => {
    const rec = new Recorder()
    const chunking = {
      enabled: true,
      min_duration_ms: 100,
      silence_threshold_rms: 0.5,
      silence_duration_ms: 100,
      hard_cap_ms: 100000,
      vad_poll_interval_ms: 100
    }
    analyserRms = 255
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: true, chunking })
    await flushMicrotasks()
    // No emit() -> pending stays empty; trigger silence cut with 0 blobs.
    vi.advanceTimersByTime(100) // activate
    analyserRms = 128 // go silent
    vi.advanceTimersByTime(200)
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioChunk).not.toHaveBeenCalled()
    // Recorder restarted on the same stream, since stream.active stays true.
    await rec.stop()
    await flushMicrotasks()
  })

  it('flush no-ops when recorder is inactive/null (double stop)', async () => {
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    analyserRms = 255
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    lastRecorderInstance!.emit(500)
    await rec.stop()
    await flushMicrotasks()
    window.electronAPI.sendAudioFinal = vi.fn()
    window.electronAPI.sendAudioDiscarded = vi.fn()
    // Second stop: recorder is already null/cleaned up -> flush returns early.
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).not.toHaveBeenCalled()
    expect(window.electronAPI.sendAudioDiscarded).not.toHaveBeenCalled()
  })

  it('flush skips re-send when audioSent already true but final stop is called again while active', async () => {
    // Drive: enqueue a final flush, then queue another final flush before the
    // first's cleanup nulls `recorder` — the second sees audioSent=true.
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    analyserRms = 255
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    lastRecorderInstance!.emit(500)
    stopBehavior = 'async' // keep the recorder 'active' while both stops are enqueued
    const p1 = rec.stop()
    const p2 = rec.stop()
    await vi.advanceTimersByTimeAsync(20)
    await Promise.all([p1, p2])
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
  })

  it('passes an exact deviceId constraint through to getUserMedia when provided', async () => {
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false, deviceId: 'mic-42' })
    await flushMicrotasks()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'mic-42' }, sampleRate: 16000 }
    })
  })

  it('flush(false) on an already-cleaned-up (null) recorder is a no-op regardless of `final`', async () => {
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    analyserRms = 255
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    lastRecorderInstance!.emit(500)
    await rec.stop() // recorder is now null (cleaned up)
    await flushMicrotasks()
    window.electronAPI.sendAudioFinal = vi.fn()
    window.electronAPI.sendAudioDiscarded = vi.fn()
    // White-box: directly drive the private flush(false) path on a null recorder.
    await (rec as any).flush(false)
    expect(window.electronAPI.sendAudioFinal).not.toHaveBeenCalled()
    expect(window.electronAPI.sendAudioDiscarded).not.toHaveBeenCalled()
  })

  it('flush(true) re-entrancy guard: audioSent already true + recorder still active just re-stops and cleans up', async () => {
    // Defensive guard only reachable by direct (white-box) re-entry, since the
    // public API always serializes flush calls through the internal queue.
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    ;(rec as any).audioSent = true
    await (rec as any).flush(true)
    expect(window.electronAPI.sendAudioFinal).not.toHaveBeenCalled()
    expect(window.electronAPI.sendAudioDiscarded).not.toHaveBeenCalled()
    expect(rec.getAnalyser()).toBeNull() // cleanup() ran
  })

  it('flush(false) re-entrancy guard: audioSent already true skips the stop/cleanup for a non-final call', async () => {
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    ;(rec as any).audioSent = true
    await (rec as any).flush(false)
    expect(window.electronAPI.sendAudioFinal).not.toHaveBeenCalled()
    expect(window.electronAPI.sendAudioDiscarded).not.toHaveBeenCalled()
    // Non-final guard hit: cleanup() is NOT called, so the analyser survives.
    expect(rec.getAnalyser()).not.toBeNull()
  })

  it('logs and skips restarting after a VAD cut when the underlying stream is no longer active', async () => {
    const rec = new Recorder()
    const chunking = {
      enabled: true,
      min_duration_ms: 100,
      silence_threshold_rms: 0.5,
      silence_duration_ms: 100,
      hard_cap_ms: 100_000,
      vad_poll_interval_ms: 100
    }
    analyserRms = 255
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: true, chunking })
    await flushMicrotasks()
    vi.advanceTimersByTime(100) // activate chunk splitting
    lastRecorderInstance!.emit(300)
    lastStream!.active = false // simulate the mic/stream dying mid-recording
    analyserRms = 128 // go silent -> triggers the cut
    vi.advanceTimersByTime(200)
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioChunk).toHaveBeenCalledTimes(1)
    // No new MediaRecorder/VAD restart since the stream is inactive.
    expect(rec.getAnalyser()).not.toBeNull() // analyser field untouched, but no new recorder started
  })

  it('does not push a zero-size ondataavailable blob into pending', async () => {
    const rec = new Recorder()
    analyserRms = 255
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    lastRecorderInstance!.emit(0) // ignored
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    await rec.stop()
    await flushMicrotasks()
    // No real data ever pushed -> silent/empty recording is discarded.
    expect(window.electronAPI.sendAudioDiscarded).toHaveBeenCalled()
    expect(window.electronAPI.sendAudioFinal).not.toHaveBeenCalled()
  })

  it('startVad() re-entry guard: calling it again while already running is a no-op', async () => {
    const rec = new Recorder()
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    // White-box: startVad() already ran once inside start(); vadInterval is set.
    expect(() => (rec as any).startVad()).not.toThrow()
  })

  it('a fresh VAD chunk is protected from an immediate re-cut before its own min_duration_ms elapses', async () => {
    const rec = new Recorder()
    const chunking = {
      enabled: true,
      min_duration_ms: 1000,
      silence_threshold_rms: 0.5,
      silence_duration_ms: 200,
      hard_cap_ms: 100_000,
      vad_poll_interval_ms: 100
    }
    analyserRms = 255
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: true, chunking })
    await flushMicrotasks()
    vi.advanceTimersByTime(1000) // activate chunk splitting
    lastRecorderInstance!.emit(400)

    analyserRms = 128 // go silent -> first cut (proven margin: 300ms > silence_duration_ms)
    vi.advanceTimersByTime(300)
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioChunk).toHaveBeenCalledTimes(1)

    // Still silent, but the new chunk just started (chunkStartTime just reset)
    // — elapsed < min_duration_ms guards against an immediate second cut.
    vi.advanceTimersByTime(300)
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioChunk).toHaveBeenCalledTimes(1)
    lastRecorderInstance!.emit(150) // give the second chunk some data to cut

    // Once past min_duration_ms for the new chunk, silence cuts it too.
    vi.advanceTimersByTime(1000)
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioChunk).toHaveBeenCalledTimes(2)

    await rec.stop()
    await flushMicrotasks()
  })

  it('cleanup() clears a pending vadDelayTimer when stopped before chunk-splitting activates', async () => {
    const rec = new Recorder()
    const chunking = {
      enabled: true,
      min_duration_ms: 5000,
      silence_threshold_rms: 0.5,
      silence_duration_ms: 100,
      hard_cap_ms: 100_000,
      vad_poll_interval_ms: 100
    }
    analyserRms = 255
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: true, chunking })
    await flushMicrotasks()
    lastRecorderInstance!.emit(500)
    // Stop well before min_duration_ms (5000ms) — the vadDelayTimer is still pending.
    vi.advanceTimersByTime(600)
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
    // Advancing further must not fire the stale vadDelayTimer (it was cleared).
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
  })

  it('enqueue keeps the queue alive after a rejected task (getUserMedia failure), so the next start() still runs', async () => {
    getUserMediaBehavior = 'reject'
    const rec = new Recorder()
    await expect(rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })).rejects.toThrow()
    await flushMicrotasks()

    getUserMediaBehavior = 'resolve'
    await rec.start({ mode: 'dictation', sessionId: 's2', chunkedTranscription: false })
    await flushMicrotasks()
    expect(rec.getAnalyser()).not.toBeNull()
  })

  it('cleanup swallows a rejected AudioContext.close() without throwing', async () => {
    audioContextCloseBehavior = 'reject'
    const rec = new Recorder()
    analyserRms = 255
    await rec.start({ mode: 'dictation', sessionId: 's1', chunkedTranscription: false })
    await flushMicrotasks()
    lastRecorderInstance!.emit(500)
    vi.advanceTimersByTime(MIN_DURATION_MS + 50)
    await rec.stop()
    await flushMicrotasks()
    expect(window.electronAPI.sendAudioFinal).toHaveBeenCalledTimes(1)
  })
})
