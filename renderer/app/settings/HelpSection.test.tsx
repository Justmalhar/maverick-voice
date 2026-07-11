// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI } from '../../../shared/types'
import HelpSection from './HelpSection'

afterEach(() => cleanup())

function mockApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  return {
    getAppConfig: vi.fn().mockResolvedValue({ version: '1.2.3', chunking: {}, junk_detection: {} }),
    openExternal: vi.fn(),
    ...overrides
  } as unknown as ElectronAPI
}

describe('HelpSection', () => {
  it('shows an em-dash until getAppConfig resolves, then the version', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    render(<HelpSection onReplayOnboarding={vi.fn()} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('1.2.3')).toBeInTheDocument())
  })

  it('swallows a getAppConfig rejection and keeps showing the em-dash', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      getAppConfig: vi.fn().mockRejectedValue(new Error('no ipc'))
    })
    render(<HelpSection onReplayOnboarding={vi.fn()} />)
    await waitFor(() => expect((window.electronAPI.getAppConfig as ReturnType<typeof vi.fn>)).toHaveBeenCalled())
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('calls onReplayOnboarding when Replay is clicked', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    const onReplayOnboarding = vi.fn()
    const user = userEvent.setup()
    render(<HelpSection onReplayOnboarding={onReplayOnboarding} />)
    await user.click(screen.getByText('Replay'))
    expect(onReplayOnboarding).toHaveBeenCalledTimes(1)
  })

  it('opens the GitHub source link via openExternal', async () => {
    const openExternal = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ openExternal })
    const user = userEvent.setup()
    render(<HelpSection onReplayOnboarding={vi.fn()} />)
    await user.click(screen.getByText('Open GitHub →'))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/justmalhar/maverick-voice')
  })
})
