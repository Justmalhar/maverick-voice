import { describe, it, expect } from 'vitest'
import { APP_CONFIG, TIMEOUTS, PRICING } from './config'

describe('config', () => {
  it('exposes app config, timeouts, and pricing table shapes', () => {
    expect(APP_CONFIG.version).toBe('2.0.0-dev.0')
    expect(APP_CONFIG.chunking.enabled).toBe(true)
    expect(APP_CONFIG.junk_detection.max_length).toBe(2)
    expect(TIMEOUTS.audioArrival).toBe(2_000)
    expect(PRICING['whisper-large-v3-turbo'].perAudioHour).toBeCloseTo(0.04)
    expect(PRICING['gpt-4o-mini'].perMInputTokens).toBeCloseTo(0.15)
  })
})
