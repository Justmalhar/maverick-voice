// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { playClick } from './sounds'

function makeParam(): { setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> } {
  return { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
}

function installAudioContextStub(opts?: { throwOnCreateOscillator?: boolean; state?: string }): {
  ctorSpy: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
} {
  const resume = vi.fn()
  const ctorSpy = vi.fn()

  ;(global as any).AudioContext = class {
    state = opts?.state ?? 'running'
    currentTime = 0
    destination = {}
    resume = resume
    constructor() {
      ctorSpy()
    }
    createOscillator(): any {
      if (opts?.throwOnCreateOscillator) throw new Error('boom')
      return {
        type: '',
        frequency: makeParam(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      }
    }
    createGain(): any {
      return { gain: makeParam(), connect: vi.fn() }
    }
  }

  return { ctorSpy, resume }
}

describe('playClick', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('creates one AudioContext and reuses it across multiple calls (lazy singleton)', async () => {
    const { ctorSpy } = installAudioContextStub()
    const { playClick: pc } = await import('./sounds')
    pc('start')
    pc('stop')
    expect(ctorSpy).toHaveBeenCalledTimes(1)
  })

  it('resumes a suspended context', async () => {
    const { resume } = installAudioContextStub({ state: 'suspended' })
    const { playClick: pc } = await import('./sounds')
    pc('start')
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('does not resume a running context', async () => {
    const { resume } = installAudioContextStub({ state: 'running' })
    const { playClick: pc } = await import('./sounds')
    pc('start')
    expect(resume).not.toHaveBeenCalled()
  })

  it('swallows errors silently (non-critical sound)', async () => {
    installAudioContextStub({ throwOnCreateOscillator: true })
    const { playClick: pc } = await import('./sounds')
    expect(() => pc('start')).not.toThrow()
  })

  it("plays the 'stop' variant without throwing", async () => {
    installAudioContextStub()
    const { playClick: pc } = await import('./sounds')
    expect(() => pc('stop')).not.toThrow()
  })
})
