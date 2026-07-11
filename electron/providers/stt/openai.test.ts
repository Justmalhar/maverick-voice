import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, recordSttUsageMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), recordSttUsageMock: vi.fn() }))
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return { ...actual, fetch: (...a: unknown[]) => fetchMock(...a) }
})
vi.mock('../../store/usage', () => ({ recordSttUsage: recordSttUsageMock }))

import { openaiSttProvider } from './openai'

// The concrete OpenAI STT provider's only real logic is the verboseJson
// predicate (gpt-4o-*-transcribe models can't report billed duration; only
// whisper-* can) — exercise both sides of it via the real factory output.
describe('providers/stt/openai (concrete factory)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    recordSttUsageMock.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('exposes the expected static shape', () => {
    expect(openaiSttProvider.id).toBe('openai')
    expect(openaiSttProvider.label).toBe('OpenAI')
    expect(openaiSttProvider.defaultModel).toBe('gpt-4o-mini-transcribe')
    expect(openaiSttProvider.models.map((m) => m.id)).toContain('whisper-1')
  })

  it('uses verbose_json (and reports duration) for whisper models', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'hi', duration: 3 }) })
    const result = await openaiSttProvider.transcribe(Buffer.from('a'), { model: 'whisper-1' }, 'key')
    expect(result.durationSeconds).toBe(3)
    expect(recordSttUsageMock).toHaveBeenCalledWith('whisper-1', 3)
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect(form.get('response_format')).toBe('verbose_json')
  })

  it('uses plain json (no duration reporting) for gpt-4o-*-transcribe models', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ text: 'hi' }) })
    const result = await openaiSttProvider.transcribe(Buffer.from('a'), { model: 'gpt-4o-mini-transcribe' }, 'key')
    expect(result.durationSeconds).toBeUndefined()
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect(form.get('response_format')).toBe('json')
  })
})
