import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, onHandlers, openSettingsPane, preflight, requestMicPermission, detectCapability } = vi.hoisted(
  () => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    onHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    openSettingsPane: vi.fn(),
    preflight: vi.fn(),
    requestMicPermission: vi.fn(),
    detectCapability: vi.fn()
  })
)
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)),
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => onHandlers.set(channel, fn))
  }
}))
vi.mock('../permissions', () => ({ openSettingsPane, preflight, requestMicPermission }))
vi.mock('../keys/capability', () => ({ detectCapability }))

import { IPC } from '../../shared/ipc'
import { registerPermissionsIpc } from './permissions'

describe('ipc/permissions', () => {
  beforeEach(() => {
    handlers.clear()
    onHandlers.clear()
    openSettingsPane.mockReset()
    preflight.mockReset()
    requestMicPermission.mockReset()
    detectCapability.mockReset()
    registerPermissionsIpc()
  })
  afterEach(() => vi.restoreAllMocks())

  it('PERM_PREFLIGHT delegates to preflight()', async () => {
    preflight.mockResolvedValue({ mic: 'granted' })
    const result = await handlers.get(IPC.PERM_PREFLIGHT)!()
    expect(result).toEqual({ mic: 'granted' })
  })

  it('PERM_OPEN_PANE delegates to openSettingsPane(pane)', () => {
    onHandlers.get(IPC.PERM_OPEN_PANE)!(null, 'accessibility')
    expect(openSettingsPane).toHaveBeenCalledWith('accessibility')
  })

  it('PERM_REQUEST_MIC delegates to requestMicPermission()', async () => {
    requestMicPermission.mockResolvedValue(true)
    const result = await handlers.get(IPC.PERM_REQUEST_MIC)!()
    expect(result).toBe(true)
  })

  it('KEY_CAPABILITY delegates to detectCapability()', async () => {
    detectCapability.mockResolvedValue({ fnAvailable: true })
    const result = await handlers.get(IPC.KEY_CAPABILITY)!()
    expect(result).toEqual({ fnAvailable: true })
  })
})
