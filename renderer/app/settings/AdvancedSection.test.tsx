// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RendererSettings } from '../../../shared/types'
import AdvancedSection from './AdvancedSection'

afterEach(() => cleanup())

const mockUseSettings = vi.fn()
vi.mock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))

function baseSettings(overrides: Partial<RendererSettings> = {}): RendererSettings {
  return {
    instructionEnabled: false,
    ...overrides
  } as RendererSettings
}

describe('AdvancedSection', () => {
  it('returns null while settings have not loaded', () => {
    mockUseSettings.mockReturnValue({ settings: null, update: vi.fn() })
    const { container } = render(<AdvancedSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides the instruction key row and sets last on the toggle row when disabled', () => {
    mockUseSettings.mockReturnValue({ settings: baseSettings({ instructionEnabled: false }), update: vi.fn() })
    render(<AdvancedSection />)
    expect(screen.getByLabelText('Edit selected text with voice')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Instruction key')).not.toBeInTheDocument()
  })

  it('shows the instruction key row when enabled and toggling calls update', async () => {
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: baseSettings({ instructionEnabled: true }), update })
    const user = userEvent.setup()
    render(<AdvancedSection />)
    expect(screen.getByText('Instruction key')).toBeInTheDocument()
    expect(screen.getByText('Caps Lock')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Edit selected text with voice'))
    expect(update).toHaveBeenCalledWith({ instructionEnabled: false })
  })
})
