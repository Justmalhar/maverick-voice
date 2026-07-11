import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppProfile, FlowType, SessionMode } from '../../shared/types'

// ── Shared mock state, declared via vi.hoisted so vi.mock factories (which are
// hoisted above imports) can reference them safely. ──────────────────────────
const {
  settingsStore,
  getApiKeyMock,
  hasApiKeyMock,
  persistAudioMock,
  recordLlmUsageMock,
  recordSttUsageMock,
  getLLMProviderMock,
  getTranscriptionProviderMock,
  copyToClipboardMock,
  injectOutputMock
} = vi.hoisted(() => {
  return {
    settingsStore: {} as Record<string, any>,
    getApiKeyMock: vi.fn(),
    hasApiKeyMock: vi.fn(),
    persistAudioMock: vi.fn(),
    recordLlmUsageMock: vi.fn(),
    recordSttUsageMock: vi.fn(),
    getLLMProviderMock: vi.fn(),
    getTranscriptionProviderMock: vi.fn(),
    copyToClipboardMock: vi.fn(),
    injectOutputMock: vi.fn()
  }
})

vi.mock('../store/settings', () => ({ getSetting: (key: string) => settingsStore[key] }))
vi.mock('../store/keys', () => ({ getApiKey: getApiKeyMock, hasApiKey: hasApiKeyMock }))
vi.mock('../store/audio', () => ({ persistAudio: persistAudioMock }))
vi.mock('../store/usage', () => ({ recordLlmUsage: recordLlmUsageMock, recordSttUsage: recordSttUsageMock }))
vi.mock('../providers/registry', () => ({
  getLLMProvider: getLLMProviderMock,
  getTranscriptionProvider: getTranscriptionProviderMock
}))
vi.mock('../output/inject', () => ({ copyToClipboard: copyToClipboardMock, injectOutput: injectOutputMock }))

// Real ./flows determineFlowType is used for realism, but one test overrides it
// to exercise pipeline.ts's defensive `default:` switch case (unreachable via
// the real determineFlowType, whose FlowType union is fully handled above it).
vi.mock('./flows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./flows')>()
  return { ...actual, determineFlowType: vi.fn(actual.determineFlowType) }
})

import { runPipeline, transcribeOne, trackChunk, newAudioTrack, type AudioTrack } from './pipeline'
import { determineFlowType } from './flows'
import { NoApiKeyError } from '../providers/types'
import type { SessionState } from './fsm'

function chunkTrack(opts: { engaged?: boolean; parts?: (string | { error: string })[] } = {}): AudioTrack {
  const track = newAudioTrack(opts.engaged ?? false)
  const parts = opts.parts ?? []
  parts.forEach((p, i) => {
    if (typeof p === 'string') {
      track.chunks.set(i, { buffer: Buffer.alloc(0), transcript: p, promise: Promise.resolve(), error: null })
    } else {
      track.chunks.set(i, { buffer: Buffer.alloc(0), transcript: null, promise: Promise.resolve(), error: p.error })
    }
  })
  if (parts.length) track.total = parts.length
  return track
}

function makeSession(overrides: Partial<Record<string, unknown>> = {}): SessionState {
  return {
    id: 'sess-1',
    mode: 'dictation' as SessionMode,
    phase: 'processing',
    abort: new AbortController(),
    startedAt: Date.now(),
    dictation: chunkTrack(),
    instruction: chunkTrack(),
    selectedText: null,
    selectedTextRole: null,
    appId: null,
    appName: null,
    profile: 'default' as AppProfile,
    dictationTranscript: null,
    instructionTranscript: null,
    flowType: 'dictation' as FlowType,
    output: null,
    errorMessage: null,
    audioRef: null,
    awaitResolvers: {},
    ackTimer: null,
    ...overrides
  } as unknown as SessionState
}

function makeLlmProvider(impl: (...a: unknown[]) => unknown) {
  return { complete: vi.fn(impl), testKey: vi.fn(), listModels: vi.fn() } as any
}

function makeSttProvider(overrides: Partial<{ requiresKey: boolean; transcribe: (...a: unknown[]) => unknown }> = {}) {
  return {
    id: 'groq',
    label: 'Groq',
    requiresKey: overrides.requiresKey,
    defaultModel: 'whisper',
    models: [],
    transcribe: vi.fn(overrides.transcribe ?? (async () => ({ text: 'hi', durationSeconds: 1 }))),
    testKey: vi.fn()
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(settingsStore)) delete settingsStore[k]
  Object.assign(settingsStore, {
    replacements: [],
    snippets: [],
    dictionary: [],
    autoFormat: false,
    appAwareFormatting: true,
    outputMode: 'paste',
    rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] },
    llmSettings: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '' },
    sttSettings: { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'auto', baseUrl: '' }
  })
  hasApiKeyMock.mockReturnValue(false)
  getApiKeyMock.mockReturnValue('test-key')
  persistAudioMock.mockResolvedValue(null)
  injectOutputMock.mockResolvedValue({})
})

describe('transcribeOne', () => {
  it('throws NoApiKeyError when the provider requires a key and none is available', async () => {
    getTranscriptionProviderMock.mockReturnValue(makeSttProvider())
    getApiKeyMock.mockReturnValue(null)
    await expect(transcribeOne(Buffer.from('a'), new AbortController().signal)).rejects.toBeInstanceOf(NoApiKeyError)
  })

  it('proceeds keyless when the provider explicitly does not require a key', async () => {
    const provider = makeSttProvider({ requiresKey: false, transcribe: async () => ({ text: 'local text' }) })
    getTranscriptionProviderMock.mockReturnValue(provider)
    getApiKeyMock.mockReturnValue(null)
    const text = await transcribeOne(Buffer.from('a'), new AbortController().signal)
    expect(text).toBe('local text')
    expect(recordSttUsageMock).toHaveBeenCalledWith('whisper-large-v3-turbo', 0)
  })

  it('passes language hint through unless "auto", and records duration seconds', async () => {
    settingsStore.sttSettings = { provider: 'groq', model: 'm', language: 'en', baseUrl: 'http://x' }
    const provider = makeSttProvider({ transcribe: async () => ({ text: 'hey', durationSeconds: 3.5 }) })
    getTranscriptionProviderMock.mockReturnValue(provider)
    await transcribeOne(Buffer.from('a'), new AbortController().signal)
    expect(provider.transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ language: 'en', baseUrl: 'http://x' }),
      'test-key',
      expect.anything()
    )
    expect(recordSttUsageMock).toHaveBeenCalledWith('m', 3.5)
  })

  it('omits the language hint when set to "auto"', async () => {
    settingsStore.sttSettings = { provider: 'groq', model: 'm', language: 'auto', baseUrl: '' }
    const provider = makeSttProvider()
    getTranscriptionProviderMock.mockReturnValue(provider)
    await transcribeOne(Buffer.from('a'), new AbortController().signal)
    expect(provider.transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ language: undefined, baseUrl: undefined }),
      'test-key',
      expect.anything()
    )
  })
})

describe('trackChunk', () => {
  it('records a successful transcription result on the chunk state', async () => {
    const provider = makeSttProvider({ transcribe: async () => ({ text: 'chunk text' }) })
    getTranscriptionProviderMock.mockReturnValue(provider)
    const session = makeSession()
    trackChunk(session, 'dictation', 0, Buffer.from('x'))
    const state = session.dictation.chunks.get(0)!
    await state.promise
    expect(state.transcript).toBe('chunk text')
    expect(state.error).toBeNull()
  })

  it('records the error message on the chunk state without throwing', async () => {
    const provider = makeSttProvider({
      transcribe: async () => {
        throw new Error('boom')
      }
    })
    getTranscriptionProviderMock.mockReturnValue(provider)
    const session = makeSession()
    trackChunk(session, 'instruction', 0, Buffer.from('x'))
    const state = session.instruction.chunks.get(0)!
    await state.promise
    expect(state.error).toBe('boom')
    expect(state.transcript).toBeNull()
  })

  it('stringifies a non-Error rejection reason', async () => {
    const provider = makeSttProvider({
      transcribe: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'plain string failure'
      }
    })
    getTranscriptionProviderMock.mockReturnValue(provider)
    const session = makeSession()
    trackChunk(session, 'dictation', 0, Buffer.from('x'))
    const state = session.dictation.chunks.get(0)!
    await state.promise
    expect(state.error).toBe('plain string failure')
  })
})

describe('runPipeline — full transcription failure', () => {
  it('throws the dictation chunk error when both tracks fail with no text', async () => {
    const session = makeSession({
      dictation: chunkTrack({ parts: [{ error: 'dict failed' }] }),
      instruction: chunkTrack({ parts: [{ error: 'instr failed' }] })
    })
    await expect(runPipeline(session, {})).rejects.toThrow('dict failed')
  })

  it('falls back to the instruction error when the dictation track has no firstError', async () => {
    const dictation = newAudioTrack(false)
    dictation.total = 1 // missing chunk entirely -> hadFailure true, firstError null
    const session = makeSession({
      dictation,
      instruction: chunkTrack({ parts: [{ error: 'instr failed' }] })
    })
    await expect(runPipeline(session, {})).rejects.toThrow('instr failed')
  })

  it('falls back to the generic message when neither track reports a firstError', async () => {
    const dictation = newAudioTrack(false)
    dictation.total = 1
    const instruction = newAudioTrack(false)
    instruction.total = 1
    const session = makeSession({ dictation, instruction })
    await expect(runPipeline(session, {})).rejects.toThrow('Transcription failed')
  })
})

describe('runPipeline — quote flow', () => {
  it('quotes the selected text with a "> " prefix', async () => {
    const session = makeSession({
      instruction: chunkTrack({ engaged: true }),
      selectedText: 'the selection',
      selectedTextRole: 'quote'
    })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('> the selection')
    expect(copyToClipboardMock).not.toHaveBeenCalled()
    expect(injectOutputMock).toHaveBeenCalledWith('> the selection', expect.anything())
  })
})

describe('runPipeline — collate edge cases', () => {
  it('tolerates a chunk whose promise field is null (defensive ?? fallback)', async () => {
    const dictation = newAudioTrack(false)
    dictation.chunks.set(0, { buffer: Buffer.alloc(0), transcript: 'already resolved', promise: null, error: null })
    dictation.total = 1
    const session = makeSession({ dictation })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('already resolved')
  })

  it('skips pushing a successful-but-empty chunk transcript', async () => {
    const dictation = newAudioTrack(false)
    dictation.chunks.set(0, { buffer: Buffer.alloc(0), transcript: '', promise: Promise.resolve(), error: null })
    dictation.chunks.set(1, { buffer: Buffer.alloc(0), transcript: 'real words', promise: Promise.resolve(), error: null })
    dictation.total = 2
    const session = makeSession({ dictation })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('real words')
  })
})

describe('runPipeline — dictation flow', () => {
  it('returns skipped when the dictation transcript is junk/empty', async () => {
    const session = makeSession()
    const result = await runPipeline(session, {})
    expect(result).toEqual({ outcome: 'skipped' })
  })

  it('pastes the raw transcript when autoFormat is off', async () => {
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('hello there')
    expect(getLLMProviderMock).not.toHaveBeenCalled()
  })

  it('writes to clipboard instead of pasting when outputMode is not "paste"', async () => {
    settingsStore.outputMode = 'clipboard'
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    await runPipeline(session, {})
    expect(copyToClipboardMock).toHaveBeenCalledWith('hello there')
    expect(injectOutputMock).not.toHaveBeenCalled()
  })

  it('skips the auto-format call entirely when the transcript is whitespace-only after replacements', async () => {
    settingsStore.autoFormat = true
    settingsStore.replacements = [{ id: '1', from: 'hi', to: '   ' }]
    const session = makeSession({ dictation: chunkTrack({ parts: ['hi'] }) })
    const result = await runPipeline(session, {})
    expect(getLLMProviderMock).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'skipped' })
  })

  it('applies app-aware auto-format using the session profile', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    const provider = makeLlmProvider(async () => ({ text: 'Hello there.', usage: { inputTokens: 5, outputTokens: 2 } }))
    getLLMProviderMock.mockReturnValue(provider)
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }), profile: 'email' })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('Hello there.')
    expect(recordLlmUsageMock).toHaveBeenCalledWith('gpt-4o-mini', 5, 2)
  })

  it('forces the default profile when appAwareFormatting is off', async () => {
    settingsStore.autoFormat = true
    settingsStore.appAwareFormatting = false
    hasApiKeyMock.mockReturnValue(true)
    const provider = makeLlmProvider(async (opts: any) => {
      expect(opts.system).not.toContain('TARGET:')
      return { text: 'Hello there.' }
    })
    getLLMProviderMock.mockReturnValue(provider)
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }), profile: 'email' })
    await runPipeline(session, {})
    expect(provider.complete).toHaveBeenCalled()
  })

  it('appends the always-on rules block to the auto-format system prompt when rules are enabled', async () => {
    settingsStore.autoFormat = true
    settingsStore.rules = {
      fixGrammar: true,
      removeFillers: false,
      smartPunctuation: false,
      professionalTone: false,
      custom: []
    }
    hasApiKeyMock.mockReturnValue(true)
    const provider = makeLlmProvider(async (opts: any) => {
      expect(opts.system).toContain('USER RULES')
      return { text: 'Hello there.' }
    })
    getLLMProviderMock.mockReturnValue(provider)
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    await runPipeline(session, {})
    expect(provider.complete).toHaveBeenCalled()
  })

  it('treats a missing `text` field on the formatter result as empty (falls back)', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({})))
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
    expect(session.output).toBe('hello there')
  })

  it('stringifies a non-Error rejection from the formatter in the warn log and still falls back', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(
      makeLlmProvider(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'formatter exploded'
      })
    )
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
  })

  it('falls back to raw text with a no-api-key notice when auto-format has no key', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(false)
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result).toEqual({ outcome: 'fallback', message: 'Add an API key in Settings to enable formatting' })
    expect(session.output).toBe('hello there')
  })

  it('falls back with a generic notice when the formatter returns empty text', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: '   ' })))
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result).toEqual({ outcome: 'fallback', message: 'Oops, formatting failed — raw text pasted' })
  })

  it('falls back when the formatter response is a refusal', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: "I can't help with that." })))
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
  })

  it('falls back when the formatter hallucinates far more text than it was given', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    const long = 'x'.repeat(500)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: long })))
    const session = makeSession({ dictation: chunkTrack({ parts: ['short'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
  })

  it('falls back with a generic notice when the formatter throws a non-abort error', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(
      makeLlmProvider(async () => {
        throw new Error('network blip')
      })
    )
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
  })

  it('propagates an AbortError thrown by the formatter instead of falling back', async () => {
    settingsStore.autoFormat = true
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(
      makeLlmProvider(async () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      })
    )
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    await expect(runPipeline(session, {})).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports a chunk-failure notice when a dictation chunk failed to transcribe', async () => {
    const session = makeSession({
      dictation: chunkTrack({ parts: ['hello there', { error: 'chunk 2 failed' }] })
    })
    const result = await runPipeline(session, {})
    expect(result).toEqual({
      outcome: 'fallback',
      message: 'Part of the recording could not be transcribed — output may be missing words.'
    })
  })
})

describe('runPipeline — context flow', () => {
  it('runs the spoken command against the selection', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: 'shortened' })))
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['make it shorter'] }),
      selectedText: 'a long selection',
      selectedTextRole: 'context'
    })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('shortened')
  })

  it('records zero usage when the provider result omits token counts', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: 'shortened' })))
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['make it shorter'] }),
      selectedText: 'a long selection',
      selectedTextRole: 'context'
    })
    await runPipeline(session, {})
    expect(recordLlmUsageMock).toHaveBeenCalledWith('gpt-4o-mini', 0, 0)
  })

  it('falls back to the raw instruction transcript when there is no API key', async () => {
    hasApiKeyMock.mockReturnValue(false)
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['do something'] }),
      selectedText: 'sel',
      selectedTextRole: 'context'
    })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
    expect(session.output).toBe('do something')
  })

  it('treats a missing `text` field on the transform result as empty (falls back)', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({})))
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['do something'] }),
      selectedText: 'sel',
      selectedTextRole: 'context'
    })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
    expect(session.output).toBe('do something')
  })

  it('falls back to the raw instruction transcript when the LLM succeeds but returns empty/refusal text', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: '   ' })))
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['do something'] }),
      selectedText: 'sel',
      selectedTextRole: 'context'
    })
    const result = await runPipeline(session, {})
    expect(result).toEqual({ outcome: 'fallback', message: 'Oops, formatting failed — raw text pasted' })
    expect(session.output).toBe('do something')
  })

  it('propagates an AbortError thrown by the transform LLM call instead of falling back', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(
      makeLlmProvider(async () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      })
    )
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['do something'] }),
      selectedText: 'sel',
      selectedTextRole: 'context'
    })
    await expect(runPipeline(session, {})).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stringifies a non-Error rejection from the transform LLM call and falls back to the raw transcript', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(
      makeLlmProvider(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'llm exploded'
      })
    )
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['do something'] }),
      selectedText: 'sel',
      selectedTextRole: 'context'
    })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('fallback')
    expect(session.output).toBe('do something')
  })

  it('reports the missing-audio notice when the instruction track had a failed chunk', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: 'ok' })))
    const session = makeSession({
      instruction: chunkTrack({ engaged: true, parts: ['do it', { error: 'boom' }] }),
      selectedText: 'sel',
      selectedTextRole: 'context'
    })
    const result = await runPipeline(session, {})
    expect(result).toEqual({
      outcome: 'fallback',
      message: 'Part of the recording could not be transcribed — output may be missing words.'
    })
  })
})

describe('runPipeline — transform flow', () => {
  it('applies the spoken command to the dictated content, with reference text when role is context', async () => {
    hasApiKeyMock.mockReturnValue(true)
    const provider = makeLlmProvider(async (opts: any) => {
      expect(opts.user).toContain('[REFERENCE TEXT]')
      return { text: 'transformed' }
    })
    getLLMProviderMock.mockReturnValue(provider)
    const session = makeSession({
      dictation: chunkTrack({ parts: ['dictated content'] }),
      instruction: chunkTrack({ engaged: true, parts: ['make it a list'] }),
      selectedText: 'reference material',
      selectedTextRole: 'context'
    })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('transformed')
  })

  it('omits reference text when the selection role is not "context" (e.g. quote)', async () => {
    hasApiKeyMock.mockReturnValue(true)
    const provider = makeLlmProvider(async (opts: any) => {
      expect(opts.user).not.toContain('[REFERENCE TEXT]')
      return { text: 'transformed' }
    })
    getLLMProviderMock.mockReturnValue(provider)
    const session = makeSession({
      dictation: chunkTrack({ parts: ['dictated content'] }),
      instruction: chunkTrack({ engaged: true, parts: ['make it a list'] }),
      selectedText: 'quoted text',
      selectedTextRole: 'quote'
    })
    await runPipeline(session, {})
  })
})

describe('runPipeline — instruction-only flow', () => {
  it('generates content from the spoken instruction alone', async () => {
    hasApiKeyMock.mockReturnValue(true)
    getLLMProviderMock.mockReturnValue(makeLlmProvider(async () => ({ text: 'generated content' })))
    const session = makeSession({ instruction: chunkTrack({ engaged: true, parts: ['write a haiku'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('generated content')
  })
})

describe('runPipeline — degraded clipboard-only paste', () => {
  it('reports the clipboard-only fallback message when injectOutput degrades', async () => {
    injectOutputMock.mockResolvedValue({ degraded: 'clipboard-only' })
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result).toEqual({ outcome: 'fallback', message: 'Copied — press Ctrl+V', degraded: 'clipboard-only' })
  })
})

describe('runPipeline — audio persistence', () => {
  it('prefers the dictation audio path, falling back to the instruction path, then null', async () => {
    persistAudioMock.mockResolvedValueOnce('dict.webm').mockResolvedValueOnce('instr.webm')
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    await runPipeline(session, {})
    expect(session.audioRef).toBe('dict.webm')
  })

  it('falls back to the instruction path when the dictation path is empty', async () => {
    persistAudioMock.mockResolvedValueOnce(null).mockResolvedValueOnce('instr.webm')
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    await runPipeline(session, {})
    expect(session.audioRef).toBe('instr.webm')
  })

  it('leaves audioRef null when neither path persisted', async () => {
    persistAudioMock.mockResolvedValue(null)
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    await runPipeline(session, {})
    expect(session.audioRef).toBeNull()
  })
})

describe('runPipeline — defensive default flow-type branch', () => {
  it('falls through to the dictation transcript when flow routing returns an unknown type', async () => {
    ;(determineFlowType as any).mockReturnValueOnce('unknown-flow' as FlowType)
    const session = makeSession({ dictation: chunkTrack({ parts: ['hello there'] }) })
    const result = await runPipeline(session, {})
    expect(result.outcome).toBe('output')
    expect(session.output).toBe('hello there')
  })
})
