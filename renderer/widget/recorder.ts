/**
 * MediaRecorder + VAD/chunking engine for the HUD widget.
 *
 * Ported from legacy/renderer/widget/useAudioRecorder.ts with the v2 fixes
 * from LEGACY-ISSUES §3 #3/#4:
 *  - ONE flush path (`flush`) shared by the VAD chunk cut and stopRecording —
 *    no duplicated finalization logic with divergent guards.
 *  - Every start/stop/chunk-emit is serialized through one promise queue, so
 *    a stop during an in-flight chunk emit waits for it and still delivers
 *    the final chunk, and a second start awaits the first (never leaking a
 *    MediaStream).
 *  - The awaited MediaRecorder stop is guarded by STOP_TIMEOUT_MS: a yanked
 *    mic resolves with a discard instead of hanging forever.
 *
 * Never logs audio content — sizes, durations and session ids only.
 */
import type { AppConfig, SessionMode } from '../../shared/types'

export const MIN_DURATION_MS = 500
export const MAX_DURATION_MS = 10 * 60 * 1000 // 10 minutes
const STOP_TIMEOUT_MS = 3000

// Defaults mirror AppConfig.chunking (tuned v1 values); overridden per start.
const DEFAULT_CHUNKING: AppConfig['chunking'] = {
  enabled: true,
  min_duration_ms: 30_000,
  silence_threshold_rms: 0.015,
  silence_duration_ms: 400,
  hard_cap_ms: 45_000,
  vad_poll_interval_ms: 100
}

export interface RecorderStartOptions {
  mode: SessionMode
  sessionId: string
  deviceId?: string
  chunkedTranscription: boolean
  chunking?: AppConfig['chunking']
  /** Called when the max-duration cap fires; owner should run its stop flow. */
  onMaxDuration?: () => void
}

export class Recorder {
  // Serialization queue — the single-flush-path guarantee lives here.
  private queue: Promise<void> = Promise.resolve()

  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private recorder: MediaRecorder | null = null

  // Frozen per recording (class fields play the role of v1's frozen refs).
  private mode: SessionMode = 'dictation'
  private sessionId = ''
  private chunking: AppConfig['chunking'] = DEFAULT_CHUNKING
  private chunkedEnabled = false

  private startTime = 0
  private chunkStartTime = 0
  private chunkIndex = 0
  private pending: Blob[] = [] // micro-blobs since last cut (whole recording when non-chunked)
  private audioSent = false
  private heardSpeech = false
  private silenceStart: number | null = null
  private vadActivated = false
  private cutQueued = false

  private vadInterval: ReturnType<typeof setInterval> | null = null
  private vadDelayTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task)
    // Keep the queue alive even if a task rejects (the caller still sees it).
    this.queue = run.catch(() => {})
    return run
  }

  /** Serialized: awaits/flushes any in-flight recording before starting. */
  start(opts: RecorderStartOptions): Promise<void> {
    return this.enqueue(async () => {
      if (this.recorder && this.recorder.state !== 'inactive') {
        console.log('[recorder] flushing previous recording before new start')
        await this.flush(true)
      }
      this.cleanup() // never leak a stream — always stop old tracks

      this.mode = opts.mode
      this.sessionId = opts.sessionId
      this.chunking = opts.chunking ?? DEFAULT_CHUNKING
      this.chunkedEnabled = opts.chunkedTranscription && opts.mode === 'dictation'
      this.audioSent = false
      this.heardSpeech = false
      this.chunkIndex = 0
      this.pending = []
      this.silenceStart = null
      this.vadActivated = false
      this.cutQueued = false

      console.log('[recorder] starting, mode:', this.mode, 'chunked:', this.chunkedEnabled)

      const constraints: MediaStreamConstraints = {
        audio: opts.deviceId
          ? { deviceId: { exact: opts.deviceId }, sampleRate: 16000 }
          : { sampleRate: 16000 }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      this.stream = stream

      this.audioContext = new AudioContext()
      const source = this.audioContext.createMediaStreamSource(stream)
      const analyser = this.audioContext.createAnalyser()
      analyser.fftSize = 128
      source.connect(analyser)
      this.analyser = analyser

      this.startMediaRecorder(stream)
      this.startTime = Date.now()
      this.chunkStartTime = Date.now()

      // RMS monitor always runs so heardSpeech is tracked even for short,
      // non-chunked dictations; chunk SPLITTING stays gated on vadActivated.
      this.startVad()
      if (this.chunkedEnabled) {
        console.log(`[recorder:vad] chunked mode — splitting activates after ${this.chunking.min_duration_ms}ms`)
        this.vadDelayTimer = setTimeout(() => {
          this.vadDelayTimer = null
          this.vadActivated = true
          console.log('[recorder:vad] chunk splitting activated')
        }, this.chunking.min_duration_ms)
      }

      this.maxTimer = setTimeout(() => {
        console.log('[recorder] max duration reached — auto-stopping')
        if (opts.onMaxDuration) opts.onMaxDuration()
        else void this.stop()
      }, MAX_DURATION_MS)
    })
  }

  /**
   * Stop and flush. Serialized behind any in-flight chunk emit (the final
   * chunk is still delivered) and internally bounded by STOP_TIMEOUT_MS —
   * a yanked mic resolves with a discard, never a hang.
   */
  stop(): Promise<void> {
    return this.enqueue(() => this.flush(true))
  }

  /**
   * THE single flush path. VAD chunk cuts call flush(false); stop and
   * start-over-active-recorder call flush(true). Shared guards, shared
   * stop-await, shared blob assembly — divergence only at the send.
   */
  private async flush(final: boolean): Promise<void> {
    const rec = this.recorder
    if (!rec || rec.state === 'inactive') {
      if (final) this.cleanup()
      return
    }
    if (this.audioSent) {
      console.log('[recorder] audio already sent — skipping flush')
      if (final) {
        try {
          rec.stop()
        } catch {
          /* ignore */
        }
        this.cleanup()
      }
      return
    }
    if (final) this.audioSent = true

    this.pauseVad()
    const stopped = await this.awaitRecorderStop(rec) // false = timed out (mic yanked)
    const blobs = this.pending
    this.pending = []
    const { mode, sessionId } = this
    const duration = Date.now() - this.startTime

    if (!final) {
      // VAD chunk cut: emit and keep rolling on the same live stream.
      if (blobs.length > 0) {
        const buffer = await new Blob(blobs, { type: 'audio/webm' }).arrayBuffer()
        console.log(`[recorder:vad] emitting chunk ${this.chunkIndex} (${buffer.byteLength} bytes)`)
        window.electronAPI.sendAudioChunk(buffer, this.chunkIndex, mode, sessionId)
        this.chunkIndex += 1
      } else {
        console.log(`[recorder:vad] chunk ${this.chunkIndex} had no data — skipping emit`)
      }
      this.chunkStartTime = Date.now()
      this.silenceStart = null
      if (this.stream?.active) {
        this.startMediaRecorder(this.stream)
        this.startVad()
      } else {
        console.log('[recorder:vad] stream no longer active — cannot restart after chunk')
      }
      return
    }

    // Final flush.
    const tooShort = duration < MIN_DURATION_MS
    const silent = this.chunkIndex === 0 && (!this.heardSpeech || blobs.length === 0)
    if (!stopped || tooShort || silent) {
      console.log('[recorder] discarding — stopped:', stopped, 'duration:', duration, 'heardSpeech:', this.heardSpeech)
      window.electronAPI.sendAudioDiscarded(mode, sessionId)
    } else if (this.chunkIndex > 0) {
      // Chunked recording: send remaining data (possibly empty) as the final chunk signal.
      const totalChunks = this.chunkIndex + (blobs.length > 0 ? 1 : 0)
      const buffer =
        blobs.length > 0 ? await new Blob(blobs, { type: 'audio/webm' }).arrayBuffer() : new ArrayBuffer(0)
      console.log(`[recorder] FINAL chunk ${this.chunkIndex}/${totalChunks} (${buffer.byteLength} bytes, ${duration}ms)`)
      window.electronAPI.sendAudioFinal(buffer, this.chunkIndex, totalChunks, duration, mode, sessionId)
    } else {
      // Non-chunked: the whole recording as one final buffer (totalChunks=1).
      const buffer = await new Blob(blobs, { type: 'audio/webm' }).arrayBuffer()
      console.log(`[recorder] final audio (${buffer.byteLength} bytes, ${duration}ms)`)
      window.electronAPI.sendAudioFinal(buffer, 0, 1, duration, mode, sessionId)
    }
    this.cleanup()
  }

  /** Stop the MediaRecorder and await onstop, bounded by STOP_TIMEOUT_MS. */
  private awaitRecorderStop(rec: MediaRecorder): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        console.log('[recorder] onstop never fired (mic yanked?) — timing out')
        rec.onstop = null
        resolve(false)
      }, STOP_TIMEOUT_MS)
      rec.onstop = () => {
        clearTimeout(timer)
        resolve(true)
      }
      try {
        rec.stop()
      } catch (err) {
        clearTimeout(timer)
        console.log('[recorder] recorder.stop() threw:', err)
        resolve(false)
      }
    })
  }

  private startMediaRecorder(stream: MediaStream): void {
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.pending.push(e.data)
    }
    rec.start(250) // collect data every 250ms
    this.recorder = rec
  }

  private startVad(): void {
    if (this.vadInterval || !this.analyser) return
    const analyser = this.analyser
    const data = new Uint8Array(analyser.frequencyBinCount)

    this.vadInterval = setInterval(() => {
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        const n = (data[i] - 128) / 128
        sumSquares += n * n
      }
      const rms = Math.sqrt(sumSquares / data.length)
      if (rms >= this.chunking.silence_threshold_rms) this.heardSpeech = true

      // Chunk-splitting only once VAD is activated (long chunked recordings).
      if (!this.vadActivated || this.cutQueued) return
      const elapsed = Date.now() - this.chunkStartTime

      if (elapsed >= this.chunking.hard_cap_ms) {
        console.log(`[recorder:vad] hard cap at ${elapsed}ms — cutting chunk ${this.chunkIndex}`)
        this.queueCut()
        return
      }
      if (elapsed < this.chunking.min_duration_ms) return

      if (rms < this.chunking.silence_threshold_rms) {
        if (this.silenceStart === null) {
          this.silenceStart = Date.now()
        } else if (Date.now() - this.silenceStart >= this.chunking.silence_duration_ms) {
          console.log(`[recorder:vad] silence at ${elapsed}ms — cutting chunk ${this.chunkIndex}`)
          this.queueCut()
        }
      } else {
        this.silenceStart = null
      }
    }, this.chunking.vad_poll_interval_ms)
  }

  private queueCut(): void {
    this.cutQueued = true
    this.pauseVad()
    void this.enqueue(async () => {
      this.cutQueued = false
      await this.flush(false)
    })
  }

  private pauseVad(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval)
      this.vadInterval = null
    }
  }

  private cleanup(): void {
    this.pauseVad()
    if (this.vadDelayTimer) {
      clearTimeout(this.vadDelayTimer)
      this.vadDelayTimer = null
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer)
      this.maxTimer = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
    this.analyser = null
    this.recorder = null
    this.vadActivated = false
    this.cutQueued = false
  }
}

/** Module singleton — StrictMode double-mounts never create a second engine. */
export const recorder = new Recorder()
