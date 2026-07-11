// ════════════════════════════════════════════════════════════════════════
// electron/main.ts — boot order + wiring only. See SYSTEM-DESIGN §4.1: this
// replaces the 940-line v1 main.ts; every module here owns its own logic.
// ════════════════════════════════════════════════════════════════════════

// EPIPE swallow guards — broken pipes on quit must not crash the process.
process.stdout.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err
})
process.stderr.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err
})

import { app } from 'electron'
import { closeLogger, initLogger } from './logger'
import { initStores, flushStores } from './store/index'
import { getSetting, setSetting } from './store/settings'
import { createDashboard, showDashboard } from './windows/dashboard'
import { createHUD } from './windows/hud'
import { createTray } from './windows/tray'
import { registerSettingsIpc } from './ipc/settings'
import { registerSessionIpc } from './ipc/session'
import { registerUsageIpc } from './ipc/usage'
import { registerPermissionsIpc } from './ipc/permissions'
import { registerProviderKeysIpc } from './ipc/providerKeys'
import { keyListener } from './keys/listener'
import { keyBindings, type KeyAction } from './keys/bindings'
import { detectCapability } from './keys/capability'
import { sessionFsm } from './session/fsm'
import { startUpdater } from './updater'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showDashboard())

  /** Push persisted settings into the runtime managers; refine the cold-
   *  default dictation binding via capability detection when applicable
   *  (v1 M5 — Fn/Globe is silently dead on non-Apple keyboards). */
  async function restoreSettings(): Promise<void> {
    keyBindings.setActivationMode(getSetting('activationMode'))
    keyBindings.setInstructionEnabled(getSetting('instructionEnabled'))

    let binding = getSetting('dictationBinding')
    const coldDefaultKey = process.platform === 'darwin' ? 'fn' : 'right-ctrl'
    const isColdDefault = binding.type === 'key' && binding.key === coldDefaultKey
    if (isColdDefault) {
      try {
        const capability = await detectCapability()
        if (process.platform === 'darwin' && !capability.fnAvailable) {
          binding = capability.defaultBinding
          setSetting('dictationBinding', binding)
          console.log('[main] refined cold-default dictation binding (no Fn):', JSON.stringify(binding))
        }
      } catch (err) {
        console.warn('[main] capability detection failed:', err instanceof Error ? err.message : err)
      }
    }
    keyBindings.setBinding(binding)
  }

  function wireKeyboard(): void {
    keyListener.on('key', (event) => keyBindings.handleKey(event))
    keyBindings.on('action', (action: KeyAction) => {
      switch (action.type) {
        case 'session-start':
          sessionFsm.start(action.mode)
          break
        case 'chain-start':
          sessionFsm.chain(action.mode)
          break
        case 'session-stop':
          sessionFsm.stop(action.mode)
          break
        case 'chain-expired':
          // Direct-chaining means stop() already carries a session through
          // to processing on its own; this guard just prevents a double
          // trigger if a timed chain window is ever re-armed later.
          if (sessionFsm.processing) console.log('[main] ignoring chain-expired — still processing')
          break
        case 'cancel': {
          const current = sessionFsm.current()
          const recording = current && (current.phase === 'recording' || current.phase === 'chained')
          if (recording) sessionFsm.cancelWithUndo()
          else sessionFsm.cancel()
          break
        }
      }
    })
  }

  app.whenReady().then(async () => {
    initLogger()
    console.log(`[main] Maverick Voice ${app.getVersion()} starting | ${process.platform}/${process.arch} | electron ${process.versions.electron}`)
    await initStores()

    createDashboard()
    createHUD()
    createTray()

    registerSettingsIpc()
    registerSessionIpc()
    registerUsageIpc()
    registerPermissionsIpc()
    registerProviderKeysIpc()

    await restoreSettings()

    try {
      const ok = keyListener.start()
      if (!ok) console.warn('[main] key listener failed to start — hotkeys disabled')
    } catch (err) {
      console.error('[main] key listener crashed at startup (IPC still works):', err instanceof Error ? err.message : err)
    }
    wireKeyboard()

    startUpdater()

    app.on('activate', () => showDashboard())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    console.log('[main] quitting')
    keyListener.stop()
    void flushStores()
    closeLogger()
  })
}
