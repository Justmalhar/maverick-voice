// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RendererSettings } from '../../../shared/types'
import BehaviorSection from './BehaviorSection'

afterEach(() => cleanup())

const mockUseSettings = vi.fn()
vi.mock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))

function baseSettings(overrides: Partial<RendererSettings> = {}): RendererSettings {
  return {
    outputMode: 'paste',
    autoFormat: false,
    appAwareFormatting: false,
    ...overrides
  } as RendererSettings
}

describe('BehaviorSection', () => {
  it('returns null while settings have not loaded', () => {
    mockUseSettings.mockReturnValue({ settings: null, update: vi.fn() })
    const { container } = render(<BehaviorSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reflects output mode and toggle state, and dispatches update() with the right keys', async () => {
    const update = vi.fn()
    mockUseSettings.mockReturnValue({
      settings: baseSettings({ outputMode: 'clipboard', autoFormat: true, appAwareFormatting: false }),
      update
    })
    const user = userEvent.setup()
    render(<BehaviorSection />)

    const outputGroup = screen.getByRole('radiogroup', { name: 'Output mode' })
    expect(within(outputGroup).getByRole('radio', { name: 'Copy to clipboard' })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(outputGroup).getByRole('radio', { name: 'Paste at cursor' }))
    expect(update).toHaveBeenCalledWith({ outputMode: 'paste' })

    expect(screen.getByLabelText('AI auto-format')).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByLabelText('AI auto-format'))
    expect(update).toHaveBeenCalledWith({ autoFormat: false })

    const adaptToggle = screen.getByLabelText('Adapt to active app')
    expect(adaptToggle).not.toBeDisabled()
    await user.click(adaptToggle)
    expect(update).toHaveBeenCalledWith({ appAwareFormatting: true })
  })

  it('disables "Adapt to active app" when autoFormat is off', () => {
    mockUseSettings.mockReturnValue({
      settings: baseSettings({ autoFormat: false, appAwareFormatting: false }),
      update: vi.fn()
    })
    render(<BehaviorSection />)
    expect(screen.getByLabelText('Adapt to active app')).toBeDisabled()
  })
})
