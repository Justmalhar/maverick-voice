// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RendererSettings } from '../../../shared/types'
import AppearanceSection from './AppearanceSection'

afterEach(() => cleanup())

const mockUseSettings = vi.fn()
vi.mock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))

const mockUseTheme = vi.fn()
vi.mock('../../theme/ThemeProvider', () => ({ useTheme: () => mockUseTheme() }))

function baseSettings(overrides: Partial<RendererSettings> = {}): RendererSettings {
  return {
    widgetPosition: 'center',
    ...overrides
  } as RendererSettings
}

describe('AppearanceSection', () => {
  it('returns null while settings have not loaded', () => {
    mockUseSettings.mockReturnValue({ settings: null, update: vi.fn() })
    mockUseTheme.mockReturnValue({ theme: 'system', setTheme: vi.fn() })
    const { container } = render(<AppearanceSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reflects the current theme and widget position, and dispatches changes', async () => {
    const setTheme = vi.fn()
    const update = vi.fn()
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme })
    mockUseSettings.mockReturnValue({ settings: baseSettings({ widgetPosition: 'right' }), update })
    const user = userEvent.setup()
    render(<AppearanceSection />)

    const themeGroup = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(within(themeGroup).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

    const widgetGroup = screen.getByRole('radiogroup', { name: 'Widget position' })
    expect(within(widgetGroup).getByRole('radio', { name: 'Right' })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(themeGroup).getByRole('radio', { name: 'Light' }))
    expect(setTheme).toHaveBeenCalledWith('light')

    await user.click(within(widgetGroup).getByRole('radio', { name: 'Center' }))
    expect(update).toHaveBeenCalledWith({ widgetPosition: 'center' })
  })
})
