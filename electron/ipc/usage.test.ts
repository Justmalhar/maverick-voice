import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, getUsageSummary, resetUsage } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getUsageSummary: vi.fn(),
  resetUsage: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)),
    on: vi.fn()
  }
}))
vi.mock('../store/usage', () => ({ getUsageSummary, resetUsage }))

import { IPC } from '../../shared/ipc'
import { registerUsageIpc } from './usage'

describe('ipc/usage', () => {
  beforeEach(() => {
    handlers.clear()
    getUsageSummary.mockReset()
    resetUsage.mockReset()
    registerUsageIpc()
  })
  afterEach(() => vi.restoreAllMocks())

  it('USAGE_GET returns the current summary', async () => {
    getUsageSummary.mockResolvedValue({ today: 'x' })
    const result = await handlers.get(IPC.USAGE_GET)!()
    expect(result).toEqual({ today: 'x' })
  })

  it('USAGE_RESET wipes usage then returns the fresh (empty) summary', async () => {
    getUsageSummary.mockResolvedValue({ today: 'empty' })
    const result = await handlers.get(IPC.USAGE_RESET)!()
    expect(resetUsage).toHaveBeenCalled()
    expect(result).toEqual({ today: 'empty' })
  })
})
