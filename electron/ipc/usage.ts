// ─── electron/ipc/usage.ts — usage summary IPC registrar ───
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { getUsageSummary, resetUsage } from '../store/usage'

export function registerUsageIpc(): void {
  ipcMain.handle(IPC.USAGE_GET, () => getUsageSummary())
  ipcMain.handle(IPC.USAGE_RESET, async () => {
    await resetUsage()
    return getUsageSummary()
  })
}
