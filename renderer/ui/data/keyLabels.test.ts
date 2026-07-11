import { afterEach, describe, expect, it, vi } from 'vitest'

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

async function loadKeyLabels(ua: string) {
  vi.resetModules()
  vi.stubGlobal('navigator', { userAgent: ua })
  return import('./keyLabels')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('keyLabels on macOS', () => {
  it('modifierLabel returns keycap symbols', async () => {
    const { modifierLabel } = await loadKeyLabels(MAC_UA)
    expect(modifierLabel('cmd')).toBe('⌘')
    expect(modifierLabel('ctrl')).toBe('⌃')
    expect(modifierLabel('option')).toBe('⌥')
    expect(modifierLabel('shift')).toBe('⇧')
    expect(modifierLabel('fn')).toBe('fn')
  })

  it('dictationBindingLabel covers every single-key case', async () => {
    const { dictationBindingLabel } = await loadKeyLabels(MAC_UA)
    expect(dictationBindingLabel({ type: 'key', key: 'fn' })).toBe('fn')
    expect(dictationBindingLabel({ type: 'key', key: 'right-option' })).toBe('Right ⌥')
    expect(dictationBindingLabel({ type: 'key', key: 'right-ctrl' })).toBe('Right Ctrl')
    expect(dictationBindingLabel({ type: 'key', key: 'right-alt' })).toBe('Right Alt')
  })

  it('dictationBindingLabel joins combo mods without a separator', async () => {
    const { dictationBindingLabel } = await loadKeyLabels(MAC_UA)
    expect(dictationBindingLabel({ type: 'combo', mods: ['cmd', 'shift'] })).toBe('⌘⇧')
  })

  it('instructionKeyLabel is always Caps Lock', async () => {
    const { instructionKeyLabel } = await loadKeyLabels(MAC_UA)
    expect(instructionKeyLabel()).toBe('Caps Lock')
  })
})

describe('keyLabels off macOS', () => {
  it('modifierLabel returns words', async () => {
    const { modifierLabel } = await loadKeyLabels(WIN_UA)
    expect(modifierLabel('cmd')).toBe('Win')
    expect(modifierLabel('ctrl')).toBe('Ctrl')
    expect(modifierLabel('option')).toBe('Alt')
    expect(modifierLabel('shift')).toBe('Shift')
    expect(modifierLabel('fn')).toBe('Fn')
  })

  it('dictationBindingLabel uses the word form for right-option', async () => {
    const { dictationBindingLabel } = await loadKeyLabels(WIN_UA)
    expect(dictationBindingLabel({ type: 'key', key: 'right-option' })).toBe('Right Alt')
  })

  it('dictationBindingLabel joins combo mods with +', async () => {
    const { dictationBindingLabel } = await loadKeyLabels(WIN_UA)
    expect(dictationBindingLabel({ type: 'combo', mods: ['ctrl', 'shift'] })).toBe('Ctrl+Shift')
  })
})
