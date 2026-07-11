// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI, UsageSummary } from '../../../shared/types'
import UsageSection from './UsageSection'

afterEach(() => cleanup())

function emptyWindow() {
  return { sttSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} }
}

function usageFixture(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    today: emptyWindow(),
    month: emptyWindow(),
    allTime: emptyWindow(),
    ...overrides
  }
}

function mockApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  return {
    getUsage: vi.fn().mockResolvedValue(usageFixture()),
    resetUsage: vi.fn().mockResolvedValue(usageFixture()),
    ...overrides
  } as unknown as ElectronAPI
}

describe('UsageSection', () => {
  it('renders "—" placeholders for cost and every stat before getUsage resolves', () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ getUsage: vi.fn(() => new Promise<never>(() => {})) })
    render(<UsageSection />)
    // cost header + STT audio + Input tokens + Output tokens all format `undefined` as '—'.
    expect(screen.getAllByText('—')).toHaveLength(4)
  })

  it('formats cost, count, and duration figures once usage resolves', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      getUsage: vi.fn().mockResolvedValue(
        usageFixture({
          today: {
            sttSeconds: 125,
            inputTokens: 2_500_000,
            outputTokens: 1_500,
            costUsd: 3.456,
            byModel: { 'gpt-4o-mini': { costUsd: 1.2 }, 'whisper-large-v3': { costUsd: 0.005 } }
          }
        })
      )
    })
    render(<UsageSection />)
    await waitFor(() => expect(screen.getByText('$3.46')).toBeInTheDocument())
    expect(screen.getByText('2.1 min')).toBeInTheDocument() // 125s -> 2.1min
    expect(screen.getByText('2.5M')).toBeInTheDocument()
    expect(screen.getByText('1.5K')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument()
    expect(screen.getByText('$1.20')).toBeInTheDocument()
    expect(screen.getByText('<$0.01')).toBeInTheDocument()
  })

  it('renders $0.00 for zero/negative cost and formats sub-minute durations in seconds', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      getUsage: vi.fn().mockResolvedValue(usageFixture({ today: { ...emptyWindow(), sttSeconds: 45, costUsd: 0 } }))
    })
    render(<UsageSection />)
    await waitFor(() => expect(screen.getByText('45s')).toBeInTheDocument())
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('hides the per-model breakdown when byModel is empty', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    render(<UsageSection />)
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())
    expect(screen.queryByText('Per model')).not.toBeInTheDocument()
  })

  it('switches usage window via the segmented control', async () => {
    const getUsage = vi.fn().mockResolvedValue(
      usageFixture({
        today: { ...emptyWindow(), costUsd: 1 },
        month: { ...emptyWindow(), costUsd: 22 }
      })
    )
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ getUsage })
    const user = userEvent.setup()
    render(<UsageSection />)
    await waitFor(() => expect(screen.getByText('$1.00')).toBeInTheDocument())
    await user.click(screen.getByRole('radio', { name: 'This month' }))
    expect(screen.getByText('$22.00')).toBeInTheDocument()
  })

  it('swallows a getUsage rejection (usage stays null)', async () => {
    const getUsage = vi.fn().mockRejectedValue(new Error('ipc down'))
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ getUsage })
    render(<UsageSection />)
    await waitFor(() => expect(getUsage).toHaveBeenCalled())
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('confirms then resets usage, showing the resetting label meanwhile', async () => {
    let resolveReset: (v: UsageSummary) => void = () => {}
    const resetUsage = vi.fn(
      () =>
        new Promise<UsageSummary>((resolve) => {
          resolveReset = resolve
        })
    )
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      getUsage: vi.fn().mockResolvedValue(usageFixture({ today: { ...emptyWindow(), costUsd: 9.99 } })),
      resetUsage
    })
    const user = userEvent.setup()
    render(<UsageSection />)
    await waitFor(() => expect(screen.getByText('$9.99')).toBeInTheDocument())

    await user.click(screen.getByText('Reset'))
    expect(screen.getByText('Confirm')).toBeInTheDocument()
    await user.click(screen.getByText('Confirm'))
    expect(screen.getByText('Resetting…')).toBeInTheDocument()
    resolveReset(usageFixture())
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())
    expect(resetUsage).toHaveBeenCalledTimes(1)
  })

  it('cancels the reset confirmation without calling resetUsage', async () => {
    const resetUsage = vi.fn().mockResolvedValue(usageFixture())
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ resetUsage })
    const user = userEvent.setup()
    render(<UsageSection />)
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())
    await user.click(screen.getByText('Reset'))
    await user.click(screen.getByText('Cancel'))
    expect(screen.getByText('Reset')).toBeInTheDocument()
    expect(resetUsage).not.toHaveBeenCalled()
  })

  it('best-effort swallows a resetUsage rejection and clears the resetting state', async () => {
    const resetUsage = vi.fn().mockRejectedValue(new Error('reset failed'))
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ resetUsage })
    const user = userEvent.setup()
    render(<UsageSection />)
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())
    await user.click(screen.getByText('Reset'))
    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(screen.getByText('Reset')).toBeInTheDocument())
  })
})
