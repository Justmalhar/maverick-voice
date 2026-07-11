import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const warmSessions = vi.fn(async () => {})
const flushSessions = vi.fn(async () => {})
const warmUsage = vi.fn(async () => {})
const flushUsage = vi.fn(async () => {})
const loadKeys = vi.fn(async () => {})
const ensureAudioDir = vi.fn(async () => {})

vi.mock('./sessions', () => ({ warmSessions, flushSessions }))
vi.mock('./usage', () => ({ warmUsage, flushUsage }))
vi.mock('./keys', () => ({ loadKeys }))
vi.mock('./audio', () => ({ ensureAudioDir }))

describe('store/index', () => {
  beforeEach(() => {
    warmSessions.mockReset().mockResolvedValue(undefined)
    flushSessions.mockReset().mockResolvedValue(undefined)
    warmUsage.mockReset().mockResolvedValue(undefined)
    flushUsage.mockReset().mockResolvedValue(undefined)
    loadKeys.mockReset().mockResolvedValue(undefined)
    ensureAudioDir.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('initStores warms every cache in parallel', async () => {
    const { initStores } = await import('./index')
    await initStores()
    expect(loadKeys).toHaveBeenCalled()
    expect(warmSessions).toHaveBeenCalled()
    expect(warmUsage).toHaveBeenCalled()
    expect(ensureAudioDir).toHaveBeenCalled()
  })

  it('initStores never rejects even if every warm-up fails, and logs each failure by label', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    loadKeys.mockRejectedValue(new Error('keys boom'))
    warmSessions.mockRejectedValue(new Error('sessions boom'))
    warmUsage.mockRejectedValue('usage plain string boom')
    ensureAudioDir.mockRejectedValue(new Error('audio boom'))
    const { initStores } = await import('./index')
    await expect(initStores()).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalledWith('[store] keys init failed:', 'keys boom')
    expect(errSpy).toHaveBeenCalledWith('[store] sessions init failed:', 'sessions boom')
    expect(errSpy).toHaveBeenCalledWith('[store] usage init failed:', 'usage plain string boom')
    expect(errSpy).toHaveBeenCalledWith('[store] audio init failed:', 'audio boom')
  })

  it('flushStores flushes both write-behind stores', async () => {
    const { flushStores } = await import('./index')
    await flushStores()
    expect(flushSessions).toHaveBeenCalled()
    expect(flushUsage).toHaveBeenCalled()
  })
})
