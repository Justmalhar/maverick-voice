// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PermissionsReport } from '../../shared/types'
import App from './App'
import { isOnboardingComplete, resetOnboarding, setOnboardingComplete } from './onboardingState'

vi.mock('./onboardingState', () => ({
  isOnboardingComplete: vi.fn(),
  resetOnboarding: vi.fn(),
  setOnboardingComplete: vi.fn()
}))

// React's module namespace is frozen under ESM, so vi.spyOn(React, 'useEffect')
// can't redefine it directly — wrap the export at mock time instead, gated by
// a mutable flag a single test flips on to freeze the app in its first render.
const reactControl = vi.hoisted(() => ({ skipEffects: false }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (...args: Parameters<typeof actual.useEffect>) => {
      if (reactControl.skipEffects) return
      return actual.useEffect(...args)
    }
  }
})

vi.mock('./Dictionary', () => ({ default: () => <div data-testid="page-dictionary">dictionary</div> }))
vi.mock('./History', () => ({ default: () => <div data-testid="page-history">history</div> }))
vi.mock('./Home', () => ({ default: () => <div data-testid="page-home">home</div> }))
vi.mock('./Replacements', () => ({ default: () => <div data-testid="page-replacements">replacements</div> }))
vi.mock('./Rules', () => ({ default: () => <div data-testid="page-rules">rules</div> }))
vi.mock('./Snippets', () => ({ default: () => <div data-testid="page-snippets">snippets</div> }))
vi.mock('./settings/Settings', () => ({
  default: ({ onReplayOnboarding }: { onReplayOnboarding: () => void }) => (
    <div data-testid="page-settings">
      <button type="button" onClick={onReplayOnboarding}>
        replay
      </button>
    </div>
  )
}))
vi.mock('./onboarding/Onboarding', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="page-onboarding">
      <button type="button" onClick={onComplete}>
        complete onboarding
      </button>
    </div>
  )
}))

function grantedReport(): PermissionsReport {
  return { mic: 'granted', accessibility: true, inputMonitoring: true, automation: 'granted', listenerAlive: true }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.electronAPI = {
    getSettings: vi.fn().mockResolvedValue({}),
    onSettingsChanged: vi.fn().mockReturnValue(() => {}),
    permissionsPreflight: vi.fn().mockResolvedValue(grantedReport())
  } as unknown as typeof window.electronAPI
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('renders the loading state before the mount effect flips the view', () => {
    // useEffect is stubbed out for this single test so we can observe the
    // synchronous first render before isOnboardingComplete() resolves the view.
    reactControl.skipEffects = true
    render(<App />)
    expect(screen.getByRole('status', { name: 'Loading Maverick Voice' })).toBeInTheDocument()
    reactControl.skipEffects = false
  })

  it('shows onboarding when onboarding is not complete', async () => {
    ;(isOnboardingComplete as Mock).mockReturnValue(false)
    render(<App />)
    expect(await screen.findByTestId('page-onboarding')).toBeInTheDocument()
  })

  it('completes onboarding and switches to main shell', async () => {
    ;(isOnboardingComplete as Mock).mockReturnValue(false)
    render(<App />)
    await screen.findByTestId('page-onboarding')
    await userEvent.click(screen.getByText('complete onboarding'))
    expect(setOnboardingComplete).toHaveBeenCalled()
    expect(await screen.findByTestId('page-home')).toBeInTheDocument()
  })

  it('shows main shell directly when onboarding is already complete', async () => {
    ;(isOnboardingComplete as Mock).mockReturnValue(true)
    render(<App />)
    expect(await screen.findByTestId('page-home')).toBeInTheDocument()
  })

  it('replays onboarding from settings', async () => {
    ;(isOnboardingComplete as Mock).mockReturnValue(true)
    render(<App />)
    await screen.findByTestId('page-home')
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await userEvent.click(screen.getByText('replay'))
    expect(resetOnboarding).toHaveBeenCalled()
    expect(await screen.findByTestId('page-onboarding')).toBeInTheDocument()
  })

  describe('MainShell tabs + permissions', () => {
    beforeEach(() => {
      ;(isOnboardingComplete as Mock).mockReturnValue(true)
    })

    it('switches the visible section when a tab is clicked, keeping others mounted-but-hidden', async () => {
      render(<App />)
      await screen.findByTestId('page-home')

      const homeSection = screen.getByTestId('page-home').closest('section')!
      const dictSection = screen.getByTestId('page-dictionary').closest('section')!
      expect(homeSection).not.toHaveAttribute('hidden')
      expect(dictSection).toHaveAttribute('hidden')

      await userEvent.click(screen.getByRole('button', { name: 'Dictionary' }))

      expect(homeSection).toHaveAttribute('hidden')
      expect(dictSection).not.toHaveAttribute('hidden')
      // still mounted, just hidden
      expect(screen.getByTestId('page-home')).toBeInTheDocument()
    })

    it('marks the active tab with aria-current', async () => {
      render(<App />)
      await screen.findByTestId('page-home')
      const homeTab = screen.getByRole('button', { name: 'Home' })
      const historyTab = screen.getByRole('button', { name: 'History' })
      expect(homeTab).toHaveAttribute('aria-current', 'page')
      expect(historyTab).not.toHaveAttribute('aria-current')

      await userEvent.click(historyTab)
      expect(historyTab).toHaveAttribute('aria-current', 'page')
      expect(homeTab).not.toHaveAttribute('aria-current')
    })

    it('shows no permission blocker when all permissions are granted', async () => {
      render(<App />)
      await screen.findByTestId('page-home')
      expect(screen.queryByText('Permission needed')).not.toBeInTheDocument()
    })

    it.each([
      ['mic not granted', { mic: 'denied', accessibility: true, inputMonitoring: true, automation: 'granted', listenerAlive: true }],
      ['accessibility missing', { mic: 'granted', accessibility: false, inputMonitoring: true, automation: 'granted', listenerAlive: true }],
      ['input monitoring missing', { mic: 'granted', accessibility: true, inputMonitoring: false, automation: 'granted', listenerAlive: true }],
      ['listener not alive', { mic: 'granted', accessibility: true, inputMonitoring: true, automation: 'granted', listenerAlive: false }]
    ])('shows a permission blocker when %s', async (_label, report) => {
      ;(window.electronAPI.permissionsPreflight as Mock).mockResolvedValue(report as PermissionsReport)
      render(<App />)
      expect(await screen.findByText('Permission needed')).toBeInTheDocument()
    })

    it('clicking the permission blocker switches to the settings tab', async () => {
      ;(window.electronAPI.permissionsPreflight as Mock).mockResolvedValue({
        mic: 'denied',
        accessibility: false,
        inputMonitoring: false,
        automation: 'denied',
        listenerAlive: false
      } as PermissionsReport)
      render(<App />)
      const blocker = await screen.findByText('Permission needed')
      await userEvent.click(blocker)
      expect(await screen.findByTestId('page-settings')).toBeInTheDocument()
    })

    it('re-checks permissions on window focus', async () => {
      render(<App />)
      await screen.findByTestId('page-home')
      expect(window.electronAPI.permissionsPreflight).toHaveBeenCalledTimes(1)
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      expect(window.electronAPI.permissionsPreflight).toHaveBeenCalledTimes(2)
    })

    it('swallows a rejected permissionsPreflight without crashing or showing a blocker', async () => {
      ;(window.electronAPI.permissionsPreflight as Mock).mockRejectedValue(new Error('nope'))
      render(<App />)
      await screen.findByTestId('page-home')
      await waitFor(() => expect(window.electronAPI.permissionsPreflight).toHaveBeenCalled())
      expect(screen.queryByText('Permission needed')).not.toBeInTheDocument()
    })

    it('unmounts cleanly, removing the focus listener', async () => {
      const { unmount } = render(<App />)
      await screen.findByTestId('page-home')
      unmount()
    })
  })
})
