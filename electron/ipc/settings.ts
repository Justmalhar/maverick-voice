import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc'
import type { RendererSettings, ThemeSetting } from '../../shared/types'
import { APP_CONFIG } from '../config'
import { getRendererSettings, getSetting, setSetting } from '../store/settings'
import { setHUDPosition } from '../windows/hud'
import { keyBindings } from '../keys/bindings'

function broadcast(partial: Partial<RendererSettings>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.SETTINGS_CHANGED, partial)
  }
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => getRendererSettings())
  ipcMain.handle(IPC.CONFIG_GET, () => APP_CONFIG)

  ipcMain.handle(IPC.THEME_GET, () => getSetting('theme'))
  ipcMain.on(IPC.THEME_SET, (_e, theme: ThemeSetting) => {
    setSetting('theme', theme)
    broadcast({ theme })
  })

  ipcMain.on(IPC.SET_WIDGET_POSITION, (_e, position: RendererSettings['widgetPosition']) => {
    setSetting('widgetPosition', position)
    setHUDPosition()
    broadcast({ widgetPosition: position })
  })
  ipcMain.on(IPC.SET_SOUND_FEEDBACK, (_e, enabled: boolean) => {
    setSetting('soundFeedback', enabled)
    broadcast({ soundFeedback: enabled })
  })
  ipcMain.on(IPC.SET_CHUNKED_TRANSCRIPTION, (_e, enabled: boolean) => {
    setSetting('chunkedTranscription', enabled)
    broadcast({ chunkedTranscription: enabled })
  })
  ipcMain.on(IPC.SET_OUTPUT_MODE, (_e, mode: RendererSettings['outputMode']) => {
    setSetting('outputMode', mode)
    broadcast({ outputMode: mode })
  })
  ipcMain.on(IPC.SET_INPUT_DEVICE, (_e, deviceId: string) => {
    setSetting('inputDeviceId', deviceId)
    broadcast({ inputDeviceId: deviceId })
  })
  ipcMain.on(IPC.SET_ACTIVATION_MODE, (_e, mode: RendererSettings['activationMode']) => {
    setSetting('activationMode', mode)
    keyBindings.setActivationMode(mode)
    broadcast({ activationMode: mode })
  })
  ipcMain.on(IPC.SET_AUTO_FORMAT, (_e, enabled: boolean) => {
    setSetting('autoFormat', enabled)
    broadcast({ autoFormat: enabled })
  })
  ipcMain.on(IPC.SET_INSTRUCTION_ENABLED, (_e, enabled: boolean) => {
    setSetting('instructionEnabled', enabled)
    keyBindings.setInstructionEnabled(enabled)
    broadcast({ instructionEnabled: enabled })
  })
  ipcMain.on(IPC.SET_APP_AWARE_FORMATTING, (_e, enabled: boolean) => {
    setSetting('appAwareFormatting', enabled)
    broadcast({ appAwareFormatting: enabled })
  })
  ipcMain.on(IPC.SET_PAUSE_MEDIA, (_e, enabled: boolean) => {
    setSetting('pauseMediaDuringDictation', enabled)
    broadcast({ pauseMediaDuringDictation: enabled })
  })
  ipcMain.on(IPC.SET_DICTATION_BINDING, (_e, binding: RendererSettings['dictationBinding']) => {
    setSetting('dictationBinding', binding)
    // keyBindings is the single source of truth for the live binding and
    // pushes it to keyListener.setBinding itself.
    keyBindings.setBinding(binding)
    broadcast({ dictationBinding: binding })
  })
  ipcMain.handle(IPC.SET_DICTIONARY, (_e, words: RendererSettings['dictionary']) => {
    setSetting('dictionary', words)
    broadcast({ dictionary: words })
  })
  ipcMain.handle(IPC.SET_REPLACEMENTS, (_e, entries: RendererSettings['replacements']) => {
    setSetting('replacements', entries)
    broadcast({ replacements: entries })
  })
  ipcMain.handle(IPC.SET_SNIPPETS, (_e, snippets: RendererSettings['snippets']) => {
    setSetting('snippets', snippets)
    broadcast({ snippets })
  })
  ipcMain.handle(IPC.SET_RULES, (_e, rules: RendererSettings['rules']) => {
    setSetting('rules', rules)
    broadcast({ rules })
  })
  ipcMain.on(IPC.STT_SETTINGS_SET, (_e, settings: RendererSettings['sttSettings']) => {
    setSetting('sttSettings', settings)
    broadcast({ sttSettings: settings })
  })
  ipcMain.on(IPC.LLM_SETTINGS_SET, (_e, settings: RendererSettings['llmSettings']) => {
    setSetting('llmSettings', settings)
    broadcast({ llmSettings: settings })
  })

  ipcMain.on(IPC.OPEN_EXTERNAL, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}
