// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import type { DictationBinding, RendererSettings } from '../../../shared/types'

afterEach(() => cleanup())

const mockUseSettings = vi.fn()
vi.mock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))

// DICTATION_KEY_OPTIONS and MODIFIER_CHOICES are computed once at module
// load from the IS_MAC constant in '../../ui' — force it per test via a
// fresh module registry (jsdom's default UA is not "Macintosh").
async function loadWithPlatform(isMac: boolean): Promise<ComponentType> {
  vi.resetModules()
  vi.doMock('../../ui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ui')>()
    return { ...actual, IS_MAC: isMac }
  })
  vi.doMock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))
  const mod = await import('./ShortcutsSection')
  return mod.default
}

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('../../ui')
})

function settingsWith(binding: DictationBinding, activationMode: RendererSettings['activationMode'] = 'tap-toggle'): RendererSettings {
  return { dictationBinding: binding, activationMode } as RendererSettings
}

describe('ShortcutsSection', () => {
  it('returns null while settings have not loaded', async () => {
    mockUseSettings.mockReturnValue({ settings: null, update: vi.fn() })
    const ShortcutsSection = await loadWithPlatform(false)
    const { container } = render(<ShortcutsSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('off-mac offers Right Ctrl/Right Alt single-key options', async () => {
    mockUseSettings.mockReturnValue({ settings: settingsWith({ type: 'key', key: 'right-ctrl' }), update: vi.fn() })
    const ShortcutsSection = await loadWithPlatform(false)
    render(<ShortcutsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dictation trigger' })
    expect(within(group).getByRole('radio', { name: 'Right Ctrl' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'Right Alt' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'Right Ctrl' })).toHaveAttribute('aria-checked', 'true')
  })

  it('on-mac offers Fn/Right Option single-key options', async () => {
    mockUseSettings.mockReturnValue({ settings: settingsWith({ type: 'key', key: 'fn' }), update: vi.fn() })
    const ShortcutsSection = await loadWithPlatform(true)
    render(<ShortcutsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dictation trigger' })
    expect(within(group).getByRole('radio', { name: 'Fn' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'Right Option' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'Fn' })).toHaveAttribute('aria-checked', 'true')
  })

  it('picking a single-key option persists it and clears any in-progress combo', async () => {
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: settingsWith({ type: 'combo', mods: ['ctrl', 'shift'] }), update })
    const ShortcutsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<ShortcutsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dictation trigger' })
    await user.click(within(group).getByRole('radio', { name: 'Right Ctrl' }))
    expect(update).toHaveBeenCalledWith({ dictationBinding: { type: 'key', key: 'right-ctrl' } })
    // combo editor should be gone now that a single key is picked.
    expect(screen.queryByText('No combo set')).not.toBeInTheDocument()
  })

  it('shows the combo editor when the binding is already a combo, listing current mods as chips', async () => {
    mockUseSettings.mockReturnValue({
      settings: settingsWith({ type: 'combo', mods: ['ctrl', 'shift'] }),
      update: vi.fn()
    })
    const ShortcutsSection = await loadWithPlatform(false)
    render(<ShortcutsSection />)
    expect(screen.getByText(/Pick at least two to avoid clashing with system shortcuts\./)).toBeInTheDocument()
    const chipsGroup = screen.getByRole('group', { name: 'Combo modifiers' })
    expect(within(chipsGroup).getByRole('button', { name: 'Ctrl', pressed: true })).toBeInTheDocument()
    expect(within(chipsGroup).getByRole('button', { name: 'Shift', pressed: true })).toBeInTheDocument()
  })

  it('switching the picker to "Custom combo" enters draft mode with an empty combo', async () => {
    mockUseSettings.mockReturnValue({ settings: settingsWith({ type: 'key', key: 'right-ctrl' }), update: vi.fn() })
    const ShortcutsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<ShortcutsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dictation trigger' })
    await user.click(within(group).getByRole('radio', { name: 'Custom combo' }))
    expect(screen.getByText('No combo set')).toBeInTheDocument()
    expect(screen.getByText('Pick at least two modifiers to save.')).toBeInTheDocument()
  })

  it('does not persist a combo of fewer than two modifiers, but does at two or more', async () => {
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: settingsWith({ type: 'key', key: 'right-ctrl' }), update })
    const ShortcutsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<ShortcutsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dictation trigger' })
    await user.click(within(group).getByRole('radio', { name: 'Custom combo' }))

    const chipsGroup = screen.getByRole('group', { name: 'Combo modifiers' })
    await user.click(within(chipsGroup).getByRole('button', { name: 'Ctrl' }))
    expect(update).not.toHaveBeenCalled()
    expect(screen.getByText('Pick at least two modifiers to save.')).toBeInTheDocument()

    await user.click(within(chipsGroup).getByRole('button', { name: 'Shift' }))
    expect(update).toHaveBeenCalledWith({ dictationBinding: { type: 'combo', mods: ['ctrl', 'shift'] } })
  })

  it('re-picking "Custom combo" while already in combo mode re-seeds the draft from the current binding', async () => {
    // Covers the binding.type === 'combo' ? true branch inside
    // handlePickerChange (only reachable when combo is already active and
    // the Segmented control's onClick fires again for the already-selected option).
    mockUseSettings.mockReturnValue({
      settings: settingsWith({ type: 'combo', mods: ['ctrl', 'shift'] }),
      update: vi.fn()
    })
    const ShortcutsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<ShortcutsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dictation trigger' })
    await user.click(within(group).getByRole('radio', { name: 'Custom combo' }))
    const chipsGroup = screen.getByRole('group', { name: 'Combo modifiers' })
    expect(within(chipsGroup).getByRole('button', { name: 'Ctrl', pressed: true })).toBeInTheDocument()
    expect(within(chipsGroup).getByRole('button', { name: 'Shift', pressed: true })).toBeInTheDocument()
  })

  it('pickerValue falls back to the combo option for a binding of neither known type', async () => {
    // Covers the otherwise-unreachable (binding.type === 'key' ? ... : COMBO_OPTION)
    // else branch — DictationBinding is a closed union at the type level, so
    // this is only reachable via a cast to an invalid runtime shape.
    mockUseSettings.mockReturnValue({
      settings: settingsWith({ type: 'unknown' } as unknown as DictationBinding),
      update: vi.fn()
    })
    const ShortcutsSection = await loadWithPlatform(false)
    render(<ShortcutsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dictation trigger' })
    expect(within(group).getByRole('radio', { name: 'Custom combo' })).toHaveAttribute('aria-checked', 'true')
  })

  it('toggling an active modifier off removes it from the combo', async () => {
    // NOTE: modifierLabel()'s own IS_MAC comes from a real, unmocked
    // './data/keyLabels' -> './data/platform' import chain (distinct from
    // the barrel's IS_MAC this test mocks), so labels always render in their
    // off-mac form ('Alt' for the 'option' modifier) regardless of the
    // platform this test forces for ShortcutsSection's own MODIFIER_CHOICES.
    const update = vi.fn()
    mockUseSettings.mockReturnValue({
      settings: settingsWith({ type: 'combo', mods: ['ctrl', 'shift', 'option'] }),
      update
    })
    const ShortcutsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<ShortcutsSection />)
    const chipsGroup = screen.getByRole('group', { name: 'Combo modifiers' })
    await user.click(within(chipsGroup).getByRole('button', { name: 'Alt' }))
    expect(update).toHaveBeenCalledWith({ dictationBinding: { type: 'combo', mods: ['ctrl', 'shift'] } })
  })

  it('includes an extra (fn) modifier choice on mac only', async () => {
    // Assert by button *count* rather than the fn label text — see the note
    // above on why modifierLabel's mac/non-mac label text can't be forced
    // via this file's IS_MAC mock.
    mockUseSettings.mockReturnValue({ settings: settingsWith({ type: 'combo', mods: [] }), update: vi.fn() })
    const MacSection = await loadWithPlatform(true)
    const { unmount } = render(<MacSection />)
    expect(within(screen.getByRole('group', { name: 'Combo modifiers' })).getAllByRole('button')).toHaveLength(5)
    unmount()
    cleanup()

    const NonMacSection = await loadWithPlatform(false)
    render(<NonMacSection />)
    expect(within(screen.getByRole('group', { name: 'Combo modifiers' })).getAllByRole('button')).toHaveLength(4)
  })

  it('reflects and updates the activation mode', async () => {
    const update = vi.fn()
    mockUseSettings.mockReturnValue({
      settings: settingsWith({ type: 'key', key: 'right-ctrl' }, 'push-to-talk'),
      update
    })
    const ShortcutsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<ShortcutsSection />)
    expect(screen.getByText('Hold the key to record, release to submit.')).toBeInTheDocument()
    const group = screen.getByRole('radiogroup', { name: 'Activation mode' })
    await user.click(within(group).getByRole('radio', { name: 'Tap toggle' }))
    expect(update).toHaveBeenCalledWith({ activationMode: 'tap-toggle' })
  })

  it('renders the instruction key row with a link to Advanced', async () => {
    mockUseSettings.mockReturnValue({ settings: settingsWith({ type: 'key', key: 'right-ctrl' }), update: vi.fn() })
    const ShortcutsSection = await loadWithPlatform(false)
    render(<ShortcutsSection />)
    expect(screen.getByText('Caps Lock')).toBeInTheDocument()
    const link = screen.getByText('Advanced')
    expect(link).toHaveAttribute('href', '#advanced')
  })
})
