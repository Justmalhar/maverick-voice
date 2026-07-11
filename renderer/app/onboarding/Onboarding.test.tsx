// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { KeyCapability, PermissionsReport } from '../../../shared/types'
import Onboarding from './Onboarding'

const platform = vi.hoisted(() => ({ IS_MAC: false, IS_WIN: false, IS_LINUX: false }))

vi.mock('../../ui', () => ({
  get IS_MAC() {
    return platform.IS_MAC
  },
  get IS_WIN() {
    return platform.IS_WIN
  },
  get IS_LINUX() {
    return platform.IS_LINUX
  },
  LoadingDots: ({ label }: { label?: string }) => (
    <span role="status" aria-label={label} />
  )
}))

vi.mock('./steps', () => ({
  WelcomeStep: () => <div data-testid="step-welcome">welcome</div>,
  HowItWorksStep: () => <div data-testid="step-how-it-works">how-it-works</div>,
  PrivacyStep: () => <div data-testid="step-privacy">privacy</div>,
  ProviderKeysStep: () => <div data-testid="step-provider-keys">provider-keys</div>,
  MicStep: ({ report, onChange }: { report: PermissionsReport; onChange: () => void }) => (
    <div data-testid="step-mic">
      mic:{report.mic}
      <button type="button" onClick={onChange}>
        mic-refresh
      </button>
    </div>
  ),
  SystemPermissionsStep: ({ report, onChange }: { report: PermissionsReport; onChange: () => void }) => (
    <div data-testid="step-system-permissions">
      accessibility:{String(report.accessibility)}
      <button type="button" onClick={onChange}>
        sys-refresh
      </button>
    </div>
  ),
  ShortcutsStep: ({ capability }: { capability: KeyCapability }) => (
    <div data-testid="step-shortcuts">fn:{String(capability.fnAvailable)}</div>
  ),
  ReadyStep: ({ capability }: { capability: KeyCapability }) => (
    <div data-testid="step-ready">fn:{String(capability.fnAvailable)}</div>
  )
}))

function report(overrides: Partial<PermissionsReport> = {}): PermissionsReport {
  return { mic: 'granted', accessibility: true, inputMonitoring: true, automation: 'granted', listenerAlive: true, ...overrides }
}

function capability(overrides: Partial<KeyCapability> = {}): KeyCapability {
  return { fnAvailable: true, globeConflict: false, defaultBinding: { type: 'key', key: 'fn' }, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  platform.IS_MAC = false
  platform.IS_WIN = false
  platform.IS_LINUX = false
  window.electronAPI = {
    permissionsPreflight: vi.fn().mockResolvedValue(report()),
    getKeyCapability: vi.fn().mockResolvedValue(capability())
  } as unknown as typeof window.electronAPI
})

afterEach(() => cleanup())

describe('Onboarding', () => {
  it('shows a loading state until both the permissions report and key capability resolve', () => {
    let resolveReport!: (r: PermissionsReport) => void
    ;(window.electronAPI.permissionsPreflight as Mock).mockReturnValue(
      new Promise((res) => {
        resolveReport = res
      })
    )
    render(<Onboarding onComplete={vi.fn()} />)
    expect(screen.getByRole('status', { name: 'Preparing setup' })).toBeInTheDocument()
    resolveReport(report())
  })

  it('walks through every step in order on a platform where system-permissions is skipped (win32)', async () => {
    platform.IS_WIN = true
    const onComplete = vi.fn()
    render(<Onboarding onComplete={onComplete} />)

    expect(await screen.findByTestId('step-welcome')).toBeInTheDocument()
    expect(screen.getByText('1 of 7')).toBeInTheDocument()
    // aria-hidden collapses the computed accessible name to '', so query by
    // text content instead of role+name here.
    expect(screen.getByText('Back')).toHaveAttribute('aria-hidden', 'true')

    const next = () => userEvent.click(screen.getByRole('button', { name: /Continue|Get started/ }))

    await next()
    expect(screen.getByTestId('step-how-it-works')).toBeInTheDocument()
    await next()
    expect(screen.getByTestId('step-privacy')).toBeInTheDocument()
    await next()
    expect(screen.getByTestId('step-provider-keys')).toBeInTheDocument()
    await next()
    expect(screen.getByTestId('step-mic')).toBeInTheDocument()
    await next()
    // system-permissions is skipped on win32
    expect(screen.getByTestId('step-shortcuts')).toBeInTheDocument()
    await next()
    expect(screen.getByTestId('step-ready')).toBeInTheDocument()
    expect(screen.getByText('7 of 7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(onComplete).toHaveBeenCalled()
  })

  it('goes back a step with the Back button', async () => {
    render(<Onboarding onComplete={vi.fn()} />)
    await screen.findByTestId('step-welcome')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByTestId('step-how-it-works')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument()
  })

  it('includes system-permissions on mac when a permission is not yet granted', async () => {
    ;(window.electronAPI.permissionsPreflight as Mock).mockResolvedValue(report({ accessibility: false }))
    platform.IS_MAC = true
    render(<Onboarding onComplete={vi.fn()} />)
    expect(await screen.findByText('1 of 8')).toBeInTheDocument()
  })

  it('skips system-permissions on mac when both accessibility and inputMonitoring are granted', async () => {
    platform.IS_MAC = true
    render(<Onboarding onComplete={vi.fn()} />)
    expect(await screen.findByText('1 of 7')).toBeInTheDocument()
  })

  it('includes system-permissions on linux wayland', async () => {
    ;(window.electronAPI.permissionsPreflight as Mock).mockResolvedValue(
      report({ linux: { sessionType: 'wayland', xdotool: false, secretService: true } })
    )
    platform.IS_LINUX = true
    render(<Onboarding onComplete={vi.fn()} />)
    expect(await screen.findByText('1 of 8')).toBeInTheDocument()
  })

  it('skips system-permissions on linux non-wayland (x11)', async () => {
    ;(window.electronAPI.permissionsPreflight as Mock).mockResolvedValue(
      report({ linux: { sessionType: 'x11', xdotool: true, secretService: true } })
    )
    platform.IS_LINUX = true
    render(<Onboarding onComplete={vi.fn()} />)
    expect(await screen.findByText('1 of 7')).toBeInTheDocument()
  })

  it('re-fetches the permissions report on window focus and passes onChange through to steps', async () => {
    render(<Onboarding onComplete={vi.fn()} />)
    await screen.findByTestId('step-welcome')
    expect(window.electronAPI.permissionsPreflight).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(window.electronAPI.permissionsPreflight).toHaveBeenCalledTimes(2)
  })

  it('MicStep onChange re-runs the refresh callback', async () => {
    render(<Onboarding onComplete={vi.fn()} />)
    await screen.findByTestId('step-welcome')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByTestId('step-mic')).toBeInTheDocument()
    const calls = (window.electronAPI.permissionsPreflight as Mock).mock.calls.length
    await userEvent.click(screen.getByText('mic-refresh'))
    expect((window.electronAPI.permissionsPreflight as Mock).mock.calls.length).toBe(calls + 1)
  })

  it('clamps stepIndex down when activeSteps shrinks (system-permissions becomes skippable mid-flow)', async () => {
    ;(window.electronAPI.permissionsPreflight as Mock).mockResolvedValue(report({ accessibility: false }))
    platform.IS_MAC = true
    render(<Onboarding onComplete={vi.fn()} />)
    // welcome -> how-it-works -> privacy -> provider-keys -> mic -> system-permissions
    await screen.findByTestId('step-welcome')
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    }
    expect(await screen.findByTestId('step-system-permissions')).toBeInTheDocument()

    // Now the permission gets granted and window focus triggers a refresh that
    // removes 'system-permissions' from activeSteps while stepIndex still points at it.
    ;(window.electronAPI.permissionsPreflight as Mock).mockResolvedValue(report({ accessibility: true, inputMonitoring: true }))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    // stepIndex clamped to the new last valid index (shortcuts, since ready
    // moved back one) — whichever step it lands on must still render validly.
    expect(screen.queryByTestId('step-system-permissions')).not.toBeInTheDocument()
  })

  it('shows a single progress indicator — top segmented bars only, no bottom dot row', async () => {
    const { container } = render(<Onboarding onComplete={vi.fn()} />)
    await screen.findByTestId('step-welcome')
    // Top bars: one per step, aria-hidden.
    const bars = container.querySelectorAll('.bg-surface-veil.rounded-full')
    expect(bars.length).toBeGreaterThan(0)
    // The old bottom dot row used h-1.5 w-1.5 rounded-full pips — must be gone.
    expect(container.querySelectorAll('.h-1\\.5.w-1\\.5.rounded-full').length).toBe(0)
  })

  it('gives the step content region a fixed min-height so the footer does not shift', async () => {
    const { container } = render(<Onboarding onComplete={vi.fn()} />)
    await screen.findByTestId('step-welcome')
    const contentRegion = screen.getByTestId('step-welcome').closest('.flex-1')
    expect(contentRegion).toHaveClass('min-h-[420px]')
    expect(container.querySelector('.border-t.border-stroke')).toBeInTheDocument()
  })
})
