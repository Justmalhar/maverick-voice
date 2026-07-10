/**
 * HUD click sounds — v1's 880/660 Hz envelope, but through ONE lazily-created,
 * reused AudioContext instead of constructing a context per click (v1 bug C6).
 */
let ctx: AudioContext | null = null

export function playClick(type: 'start' | 'stop'): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime

    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.connect(gain)
    gain.connect(ctx.destination)

    // Start: higher pitch pop (880Hz), Stop: lower pitch (660Hz)
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(type === 'start' ? 880 : 660, t)

    // Subtle vibrato — gentle wobble
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.connect(lfoGain)
    lfoGain.connect(oscillator.frequency)
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(14, t)
    lfoGain.gain.setValueAtTime(8, t)
    lfo.start(t)
    lfo.stop(t + 0.08)

    // Softer envelope with slight vibration
    gain.gain.setValueAtTime(0.07, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)

    oscillator.start(t)
    oscillator.stop(t + 0.08)
  } catch {
    // Silently ignore — sound is non-critical
  }
}
