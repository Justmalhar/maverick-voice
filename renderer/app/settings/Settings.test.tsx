// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Settings from './Settings'

afterEach(() => cleanup())

vi.mock('./AdvancedSection', () => ({ default: () => <div data-testid="AdvancedSection" /> }))
vi.mock('./AppearanceSection', () => ({ default: () => <div data-testid="AppearanceSection" /> }))
vi.mock('./AudioSection', () => ({ default: () => <div data-testid="AudioSection" /> }))
vi.mock('./BehaviorSection', () => ({ default: () => <div data-testid="BehaviorSection" /> }))
vi.mock('./HelpSection', () => ({
  default: ({ onReplayOnboarding }: { onReplayOnboarding: () => void }) => (
    <button data-testid="HelpSection" onClick={onReplayOnboarding}>
      help
    </button>
  )
}))
vi.mock('./PermissionsSection', () => ({ default: () => <div data-testid="PermissionsSection" /> }))
vi.mock('./PrivacySection', () => ({ default: () => <div data-testid="PrivacySection" /> }))
vi.mock('./LlmProviderSection', () => ({ default: () => <div data-testid="LlmProviderSection" /> }))
vi.mock('./ShortcutsSection', () => ({ default: () => <div data-testid="ShortcutsSection" /> }))
vi.mock('./SttProviderSection', () => ({ default: () => <div data-testid="SttProviderSection" /> }))

describe('Settings', () => {
  it('renders the page header and every section, wiring onReplayOnboarding through to HelpSection', async () => {
    const onReplayOnboarding = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<Settings onReplayOnboarding={onReplayOnboarding} />)

    expect(screen.getByText('Settings')).toBeInTheDocument()
    for (const id of [
      'SttProviderSection',
      'LlmProviderSection',
      'ShortcutsSection',
      'AudioSection',
      'BehaviorSection',
      'AppearanceSection',
      'PermissionsSection',
      'AdvancedSection',
      'PrivacySection',
      'HelpSection'
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }

    await user.click(screen.getByTestId('HelpSection'))
    expect(onReplayOnboarding).toHaveBeenCalledTimes(1)
  })
})
