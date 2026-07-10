// ─── electron/ipc/permissions.ts — permissions + key-capability IPC registrar ───
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { PermissionPane } from '../../shared/types'
import { openSettingsPane, preflight, requestMicPermission } from '../permissions'
import { detectCapability } from '../keys/capability'

export function registerPermissionsIpc(): void {
  ipcMain.handle(IPC.PERM_PREFLIGHT, () => preflight())
  ipcMain.on(IPC.PERM_OPEN_PANE, (_e, pane: PermissionPane) => openSettingsPane(pane))
  ipcMain.handle(IPC.PERM_REQUEST_MIC, () => requestMicPermission())
  ipcMain.handle(IPC.KEY_CAPABILITY, () => detectCapability())
}
