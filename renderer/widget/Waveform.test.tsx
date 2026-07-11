// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import Waveform from './Waveform'

function makeCtxStub(): {
  ctx: {
    clearRect: ReturnType<typeof vi.fn>
    beginPath: ReturnType<typeof vi.fn>
    roundRect: ReturnType<typeof vi.fn>
    fill: ReturnType<typeof vi.fn>
    scale: ReturnType<typeof vi.fn>
    globalAlpha: number
    fillStyle: string
  }
} {
  const ctx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    fillStyle: ''
  }
  return { ctx }
}

function makeAnalyser(binCount = 32): AnalyserNode {
  return {
    frequencyBinCount: binCount,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => {
      arr.fill(200)
    })
  } as unknown as AnalyserNode
}

let rafCallbacks: FrameRequestCallback[] = []
let rafId = 0

beforeEach(() => {
  rafCallbacks = []
  rafId = 0
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      rafId += 1
      rafCallbacks.push(cb)
      return rafId
    })
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Waveform', () => {
  it('renders a canvas element', () => {
    const { container } = render(<Waveform analyserNode={null} />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('does nothing (no draw loop) when analyserNode is null', () => {
    render(<Waveform analyserNode={null} />)
    expect(rafCallbacks.length).toBe(0)
  })

  it('does nothing when getContext returns null', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as any
    render(<Waveform analyserNode={makeAnalyser()} />)
    expect(rafCallbacks.length).toBe(0)
  })

  it('starts a draw loop and draws bars reading the --ink token', () => {
    const { ctx } = makeCtxStub()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctx) as any
    const originalGetComputedStyle = window.getComputedStyle
    window.getComputedStyle = vi.fn().mockReturnValue({
      getPropertyValue: vi.fn().mockReturnValue('  #ff0000  ')
    }) as any

    const analyser = makeAnalyser()
    const { unmount } = render(<Waveform analyserNode={analyser} width={84} height={22} />)

    expect(rafCallbacks.length).toBe(1)
    // Run one animation frame manually.
    rafCallbacks[0](0)

    expect(analyser.getByteFrequencyData).toHaveBeenCalled()
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 84, 22)
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.roundRect).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.fillStyle).toBe('#ff0000')

    unmount()
    expect(cancelAnimationFrame).toHaveBeenCalled()
    window.getComputedStyle = originalGetComputedStyle
  })

  it('falls back to currentColor when the --ink token is empty', () => {
    const { ctx } = makeCtxStub()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctx) as any
    const originalGetComputedStyle = window.getComputedStyle
    window.getComputedStyle = vi.fn().mockReturnValue({
      getPropertyValue: vi.fn().mockReturnValue('')
    }) as any

    render(<Waveform analyserNode={makeAnalyser()} />)
    rafCallbacks[0](0)
    expect(ctx.fillStyle).toBe('currentColor')
    window.getComputedStyle = originalGetComputedStyle
  })

  it('re-runs the effect (teardown + rebuild) when width/height/analyserNode change', () => {
    const { ctx } = makeCtxStub()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctx) as any
    window.getComputedStyle = vi.fn().mockReturnValue({
      getPropertyValue: vi.fn().mockReturnValue('blue')
    }) as any

    const analyser1 = makeAnalyser()
    const { rerender } = render(<Waveform analyserNode={analyser1} width={84} height={22} />)
    expect(rafCallbacks.length).toBe(1)

    const analyser2 = makeAnalyser()
    rerender(<Waveform analyserNode={analyser2} width={100} height={30} />)

    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(rafCallbacks.length).toBe(2)
  })

  it('falls back to a devicePixelRatio of 1 when window.devicePixelRatio is falsy', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 0, configurable: true })
    const { ctx } = makeCtxStub()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctx) as any
    window.getComputedStyle = vi.fn().mockReturnValue({
      getPropertyValue: vi.fn().mockReturnValue('green')
    }) as any

    const { container } = render(<Waveform analyserNode={makeAnalyser()} width={84} height={22} />)
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(84) // 84 * 1 (fallback), not 84 * 0
    expect(canvas.height).toBe(22)
  })
})
