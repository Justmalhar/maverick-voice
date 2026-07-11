import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

let files: Record<string, string> = {}
let readFileImpl: ((p: string) => Promise<string>) | null = null
let writeFileImpl: ((p: string, data: string) => Promise<void>) | null = null

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (p: string) => (readFileImpl ? readFileImpl(p) : defaultReadFile(p)),
    writeFile: (p: string, data: string) => (writeFileImpl ? writeFileImpl(p, data) : defaultWriteFile(p, data)),
    rename: (from: string, to: string) => defaultRename(from, to)
  }
}))

function enoent(): NodeJS.ErrnoException {
  const e = new Error('ENOENT') as NodeJS.ErrnoException
  e.code = 'ENOENT'
  return e
}
async function defaultReadFile(p: string): Promise<string> {
  if (p in files) return files[p]
  throw enoent()
}
async function defaultWriteFile(p: string, data: string): Promise<void> {
  files[p] = data
}
async function defaultRename(from: string, to: string): Promise<void> {
  files[to] = files[from]
  delete files[from]
}

const FILE = '/mock/userData/usage.json'

describe('store/usage', () => {
  beforeEach(() => {
    files = {}
    readFileImpl = null
    writeFileImpl = null
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function fresh() {
    vi.resetModules()
    return import('./usage')
  }

  it('warmUsage on ENOENT leaves an empty summary', async () => {
    const mod = await fresh()
    await mod.warmUsage()
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.sttSeconds).toBe(0)
  })

  it('warmUsage merges pre-existing usage.json additively on top of anything recorded before load finished', async () => {
    files[FILE] = JSON.stringify({ '2020-01-01': { 'whisper-large-v3-turbo': { sttSeconds: 100, inputTokens: 0, outputTokens: 0 } } })
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 10) // recorded before load() resolves
    await mod.warmUsage()
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.sttSeconds).toBe(110)
  })

  it('a non-ENOENT load error is warned and treated as empty', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    readFileImpl = async () => {
      throw new Error('read boom')
    }
    const mod = await fresh()
    await mod.warmUsage()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load'), 'read boom')
  })

  it('a non-ENOENT-shaped (null) rejection during load is still treated as empty (optional-chaining guard)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    readFileImpl = async () => {
      throw null // e?.code on a null error must not throw
    }
    const mod = await fresh()
    await mod.warmUsage()
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.sttSeconds).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load'), null)
  })

  it('a malformed (non-object) usage.json is ignored', async () => {
    files[FILE] = JSON.stringify('not an object')
    const mod = await fresh()
    await mod.warmUsage()
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.sttSeconds).toBe(0)
  })

  it('recordSttUsage ignores non-finite or non-positive durations', async () => {
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 0)
    mod.recordSttUsage('whisper-large-v3-turbo', -5)
    mod.recordSttUsage('whisper-large-v3-turbo', NaN)
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.sttSeconds).toBe(0)
  })

  it('recordLlmUsage ignores when both token counts are zero/invalid', async () => {
    const mod = await fresh()
    mod.recordLlmUsage('gpt-4o-mini', 0, 0)
    mod.recordLlmUsage('gpt-4o-mini', NaN, -1)
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.inputTokens).toBe(0)
    expect(summary.allTime.outputTokens).toBe(0)
  })

  it('recordLlmUsage records when only input tokens are positive', async () => {
    const mod = await fresh()
    mod.recordLlmUsage('gpt-4o-mini', 50, 0)
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.inputTokens).toBe(50)
  })

  it('recordLlmUsage records when only output tokens are positive', async () => {
    const mod = await fresh()
    mod.recordLlmUsage('gpt-4o-mini', 0, 20)
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.outputTokens).toBe(20)
  })

  it('bumps and flushes stt + llm usage after the debounce, keyed by model', async () => {
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 30)
    mod.recordLlmUsage('gpt-4o-mini', 100, 200)
    await vi.advanceTimersByTimeAsync(500)
    const written = JSON.parse(files[FILE])
    const today = Object.keys(written)[0]
    expect(written[today]['whisper-large-v3-turbo'].sttSeconds).toBe(30)
    expect(written[today]['gpt-4o-mini']).toEqual({ sttSeconds: 0, inputTokens: 100, outputTokens: 200 })
  })

  it('costs a model with only perAudioHour pricing', async () => {
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 3600) // 1 hour @ $0.04/hr
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.costUsd).toBeCloseTo(0.04)
    expect(summary.allTime.byModel['whisper-large-v3-turbo'].costUsd).toBeCloseTo(0.04)
  })

  it('costs a model with both perMInputTokens and perMOutputTokens pricing', async () => {
    const mod = await fresh()
    mod.recordLlmUsage('gpt-4o-mini', 1_000_000, 1_000_000) // $0.15 + $0.6
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.costUsd).toBeCloseTo(0.75)
  })

  it('a model absent from PRICING costs $0', async () => {
    const mod = await fresh()
    mod.recordLlmUsage('totally-unpriced-model', 1_000_000, 1_000_000)
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.costUsd).toBe(0)
  })

  it('buckets usage into today / month / all-time windows correctly', async () => {
    files[FILE] = JSON.stringify({
      '2000-01-01': { 'gpt-4o-mini': { sttSeconds: 0, inputTokens: 10, outputTokens: 10 } }
    })
    const mod = await fresh()
    mod.recordLlmUsage('gpt-4o-mini', 5, 5) // recorded today
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.inputTokens).toBe(15)
    expect(summary.today.inputTokens).toBe(5)
    expect(summary.month.inputTokens).toBe(5)
  })

  it('resetUsage wipes all recorded usage', async () => {
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 30)
    await mod.resetUsage()
    const summary = await mod.getUsageSummary()
    expect(summary.allTime.sttSeconds).toBe(0)
    expect(JSON.parse(files[FILE])).toEqual({})
  })

  it('flushUsage writes out any pending dirty state immediately', async () => {
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 12)
    await mod.flushUsage()
    expect(files[FILE]).toBeDefined()
  })

  it('flushUsage with nothing dirty is a no-op', async () => {
    const mod = await fresh()
    await mod.warmUsage()
    await mod.flushUsage()
    expect(files[FILE]).toBeUndefined()
  })

  it('a failed atomic write keeps dirty=true and logs an error, retried on next flush', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 5)
    writeFileImpl = async () => {
      throw new Error('disk full')
    }
    await mod.flushUsage()
    expect(files[FILE]).toBeUndefined()
    expect(errSpy).toHaveBeenCalledWith('[usage] flush failed:', 'disk full')

    writeFileImpl = null
    await mod.flushUsage()
    expect(files[FILE]).toBeDefined()
  })

  it('a non-Error write rejection during flush is stringified as-is', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 5)
    writeFileImpl = async () => {
      throw 'plain string write failure'
    }
    await mod.flushUsage()
    expect(errSpy).toHaveBeenCalledWith('[usage] flush failed:', 'plain string write failure')
  })

  it('a pending flush timer is cleared when flushUsage runs early', async () => {
    const mod = await fresh()
    mod.recordSttUsage('whisper-large-v3-turbo', 5)
    await mod.flushUsage()
    expect(files[FILE]).toBeDefined()
    await vi.advanceTimersByTimeAsync(500) // stale timer must not double-fire or throw
  })

  describe('best-effort catch blocks (a "never throws" guarantee)', () => {
    // Force localDateStr()`s internal `new Date()` to throw so the defensive
    // try/catch wrappers are exercised — proving usage recording/summarizing
    // never propagates an error into the pipeline.
    class BoomDate {
      constructor() {
        throw new Error('date boom')
      }
      static now(): number {
        return 0
      }
    }
    // Throws a non-Error to exercise the `err instanceof Error ? … : err` false branch.
    class BoomStringDate {
      constructor() {
        throw 'string boom'
      }
      static now(): number {
        return 0
      }
    }

    it('recordSttUsage swallows and warns on an internal throw', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mod = await fresh()
      vi.stubGlobal('Date', BoomDate)
      try {
        expect(() => mod.recordSttUsage('m', 5)).not.toThrow()
      } finally {
        vi.unstubAllGlobals()
      }
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to record STT usage'), 'date boom')
    })

    it('recordLlmUsage swallows and warns on an internal throw', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mod = await fresh()
      vi.stubGlobal('Date', BoomDate)
      try {
        expect(() => mod.recordLlmUsage('m', 5, 5)).not.toThrow()
      } finally {
        vi.unstubAllGlobals()
      }
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to record LLM usage'), 'date boom')
    })

    it('getUsageSummary swallows and warns on an internal throw, returning empty windows', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mod = await fresh()
      await mod.warmUsage()
      vi.stubGlobal('Date', BoomDate)
      let summary
      try {
        summary = await mod.getUsageSummary()
      } finally {
        vi.unstubAllGlobals()
      }
      expect(summary!.allTime.sttSeconds).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to summarize usage'), 'date boom')
    })

    it('a non-Error internal throw is stringified as-is (record + summarize false branches)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mod = await fresh()
      await mod.warmUsage()
      vi.stubGlobal('Date', BoomStringDate)
      try {
        mod.recordSttUsage('m', 5)
        mod.recordLlmUsage('m', 5, 5)
        await mod.getUsageSummary()
      } finally {
        vi.unstubAllGlobals()
      }
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to record STT usage'), 'string boom')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to record LLM usage'), 'string boom')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to summarize usage'), 'string boom')
    })
  })
})
