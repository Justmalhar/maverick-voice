import { useEffect, useRef, type ReactNode } from 'react'

interface WaveformProps {
  analyserNode: AnalyserNode | null
  width?: number
  height?: number
}

/**
 * Live frequency-bar visualizer for the HUD pill — ported near-verbatim from
 * v1 (DPR-scaled canvas, rAF loop, Float32Array smoothing, no per-frame React
 * state). v2 change: the bar color is resolved at DRAW time from the canvas'
 * computed `--ink` token — NOT an effect dependency — so a theme or mode
 * switch never tears down and rebuilds the canvas/rAF loop (v1 bug C6).
 */
export default function Waveform({
  analyserNode,
  width = 84,
  height = 22
}: WaveformProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyserNode) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const bufferLength = analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    // Compact: fewer bars for small widths
    const barCount = Math.max(12, Math.round(width / 4))
    const barGap = 1.5
    const barWidth = (width - (barCount - 1) * barGap) / barCount
    const minBarHeight = 1.5
    const smoothing = 0.7
    const smoothed = new Float32Array(barCount)

    let raf = 0
    function draw(): void {
      raf = requestAnimationFrame(draw)
      analyserNode!.getByteFrequencyData(dataArray)

      // Token read at draw time — tracks theme/mode changes without a rebuild.
      const color = getComputedStyle(canvas!).getPropertyValue('--ink').trim() || 'currentColor'

      ctx!.clearRect(0, 0, width, height)

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.floor(Math.pow(i / barCount, 1.3) * bufferLength)
        const rawValue = dataArray[binIndex] / 255

        smoothed[i] = smoothed[i] * smoothing + rawValue * (1 - smoothing)
        const value = smoothed[i]

        const barHeight = Math.max(minBarHeight, value * height * 0.9)
        const x = i * (barWidth + barGap)
        const y = (height - barHeight) / 2

        // Center bars brighter, edges dimmer
        const centerFactor = 1 - Math.abs(i / barCount - 0.5) * 0.6
        const opacity = (0.3 + value * 0.7) * centerFactor
        ctx!.globalAlpha = opacity
        ctx!.fillStyle = color
        ctx!.beginPath()
        ctx!.roundRect(x, y, barWidth, barHeight, barWidth / 2)
        ctx!.fill()
      }
      ctx!.globalAlpha = 1
    }

    draw()

    return () => {
      cancelAnimationFrame(raf)
    }
  }, [analyserNode, width, height])

  return <canvas ref={canvasRef} style={{ width, height, display: 'block' }} aria-hidden="true" />
}
