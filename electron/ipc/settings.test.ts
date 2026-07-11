import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  onHandlers,
  windows,
  getAllWindows,
  openExternal,
  getRendererSettings,
  getSetting,
  setSetting,
  setHUDPosition,
  keyBindings
} = vi.hoisted(() => {
  const windows: Array<{ webContents: { send: (...a: unknown[]) => void } }> = []
  return {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    onHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    windows,
    getAllWindows: vi.fn(() => windows),
    openExternal: vi.fn(async () => {}),
    getRendererSettings: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    setHUDPosition: vi.fn(),
    keyBindings: { setActivationMode: vi.fn(), setInstructionEnabled: vi.fn(), setBinding: vi.fn() }
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)),
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => onHandlers.set(channel, fn))
  },
  BrowserWindow: { getAllWindows },
  shell: { openExternal }
}))
vi.mock('../store/settings', () => ({ getRendererSettings, getSetting, setSetting }))
vi.mock('../windows/hud', () => ({ setHUDPosition }))
vi.mock('../keys/bindings', () => ({ keyBindings }))

import { IPC } from '../../shared/ipc'
import { registerSettingsIpc } from './settings'
import { APP_CONFIG } from '../config'

function lastBroadcast(): unknown {
  const win = windows[0]
  const call = (win.webContents.send as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!
  return call[1]
}

describe('ipc/settings', () => {
  beforeEach(() => {
    handlers.clear()
    onHandlers.clear()
    windows.length = 0
    windows.push({ webContents: { send: vi.fn() } })
    getAllWindows.mockClear()
    openExternal.mockClear()
    getRendererSettings.mockReset()
    getSetting.mockReset()
    setSetting.mockReset()
    setHUDPosition.mockReset()
    keyBindings.setActivationMode.mockReset()
    keyBindings.setInstructionEnabled.mockReset()
    keyBindings.setBinding.mockReset()
    registerSettingsIpc()
  })
  afterEach(() => vi.restoreAllMocks())

  it('SETTINGS_GET returns the batched renderer snapshot', () => {
    getRendererSettings.mockReturnValue({ theme: 'dark' })
    expect(handlers.get(IPC.SETTINGS_GET)!()).toEqual({ theme: 'dark' })
  })

  it('CONFIG_GET returns the static APP_CONFIG', () => {
    expect(handlers.get(IPC.CONFIG_GET)!()).toBe(APP_CONFIG)
  })

  it('THEME_GET reads the stored theme', () => {
    getSetting.mockReturnValue('system')
    expect(handlers.get(IPC.THEME_GET)!()).toBe('system')
  })

  it('THEME_SET stores and broadcasts the new theme', () => {
    onHandlers.get(IPC.THEME_SET)!(null, 'dark')
    expect(setSetting).toHaveBeenCalledWith('theme', 'dark')
    expect(lastBroadcast()).toEqual({ theme: 'dark' })
  })

  it('SET_WIDGET_POSITION stores, repositions the HUD, and broadcasts', () => {
    onHandlers.get(IPC.SET_WIDGET_POSITION)!(null, 'right')
    expect(setSetting).toHaveBeenCalledWith('widgetPosition', 'right')
    expect(setHUDPosition).toHaveBeenCalled()
    expect(lastBroadcast()).toEqual({ widgetPosition: 'right' })
  })

  it('SET_SOUND_FEEDBACK stores and broadcasts', () => {
    onHandlers.get(IPC.SET_SOUND_FEEDBACK)!(null, false)
    expect(setSetting).toHaveBeenCalledWith('soundFeedback', false)
    expect(lastBroadcast()).toEqual({ soundFeedback: false })
  })

  it('SET_CHUNKED_TRANSCRIPTION stores and broadcasts', () => {
    onHandlers.get(IPC.SET_CHUNKED_TRANSCRIPTION)!(null, false)
    expect(setSetting).toHaveBeenCalledWith('chunkedTranscription', false)
    expect(lastBroadcast()).toEqual({ chunkedTranscription: false })
  })

  it('SET_OUTPUT_MODE stores and broadcasts', () => {
    onHandlers.get(IPC.SET_OUTPUT_MODE)!(null, 'type')
    expect(setSetting).toHaveBeenCalledWith('outputMode', 'type')
    expect(lastBroadcast()).toEqual({ outputMode: 'type' })
  })

  it('SET_INPUT_DEVICE stores and broadcasts', () => {
    onHandlers.get(IPC.SET_INPUT_DEVICE)!(null, 'device-1')
    expect(setSetting).toHaveBeenCalledWith('inputDeviceId', 'device-1')
    expect(lastBroadcast()).toEqual({ inputDeviceId: 'device-1' })
  })

  it('SET_ACTIVATION_MODE stores, updates keyBindings, and broadcasts', () => {
    onHandlers.get(IPC.SET_ACTIVATION_MODE)!(null, 'dual-tap')
    expect(setSetting).toHaveBeenCalledWith('activationMode', 'dual-tap')
    expect(keyBindings.setActivationMode).toHaveBeenCalledWith('dual-tap')
    expect(lastBroadcast()).toEqual({ activationMode: 'dual-tap' })
  })

  it('SET_AUTO_FORMAT stores and broadcasts', () => {
    onHandlers.get(IPC.SET_AUTO_FORMAT)!(null, true)
    expect(setSetting).toHaveBeenCalledWith('autoFormat', true)
    expect(lastBroadcast()).toEqual({ autoFormat: true })
  })

  it('SET_INSTRUCTION_ENABLED stores, updates keyBindings, and broadcasts', () => {
    onHandlers.get(IPC.SET_INSTRUCTION_ENABLED)!(null, true)
    expect(setSetting).toHaveBeenCalledWith('instructionEnabled', true)
    expect(keyBindings.setInstructionEnabled).toHaveBeenCalledWith(true)
    expect(lastBroadcast()).toEqual({ instructionEnabled: true })
  })

  it('SET_APP_AWARE_FORMATTING stores and broadcasts', () => {
    onHandlers.get(IPC.SET_APP_AWARE_FORMATTING)!(null, false)
    expect(setSetting).toHaveBeenCalledWith('appAwareFormatting', false)
    expect(lastBroadcast()).toEqual({ appAwareFormatting: false })
  })

  it('SET_PAUSE_MEDIA stores and broadcasts', () => {
    onHandlers.get(IPC.SET_PAUSE_MEDIA)!(null, true)
    expect(setSetting).toHaveBeenCalledWith('pauseMediaDuringDictation', true)
    expect(lastBroadcast()).toEqual({ pauseMediaDuringDictation: true })
  })

  it('SET_DICTATION_BINDING stores, updates keyBindings (single source of truth), and broadcasts', () => {
    const binding = { type: 'key', key: 'fn' }
    onHandlers.get(IPC.SET_DICTATION_BINDING)!(null, binding)
    expect(setSetting).toHaveBeenCalledWith('dictationBinding', binding)
    expect(keyBindings.setBinding).toHaveBeenCalledWith(binding)
    expect(lastBroadcast()).toEqual({ dictationBinding: binding })
  })

  it('SET_DICTIONARY (handle) stores and broadcasts the whole list', () => {
    const words = [{ id: '1', word: 'Kubernetes' }]
    handlers.get(IPC.SET_DICTIONARY)!(null, words)
    expect(setSetting).toHaveBeenCalledWith('dictionary', words)
    expect(lastBroadcast()).toEqual({ dictionary: words })
  })

  it('SET_REPLACEMENTS (handle) stores and broadcasts the whole list', () => {
    const entries = [{ id: '1', from: 'teh', to: 'the' }]
    handlers.get(IPC.SET_REPLACEMENTS)!(null, entries)
    expect(setSetting).toHaveBeenCalledWith('replacements', entries)
    expect(lastBroadcast()).toEqual({ replacements: entries })
  })

  it('SET_SNIPPETS (handle) stores and broadcasts the whole list', () => {
    const snippets = [{ id: '1', trigger: 'sig', text: 'Best, X' }]
    handlers.get(IPC.SET_SNIPPETS)!(null, snippets)
    expect(setSetting).toHaveBeenCalledWith('snippets', snippets)
    expect(lastBroadcast()).toEqual({ snippets })
  })

  it('SET_RULES (handle) stores and broadcasts the whole object', () => {
    const rules = { fixGrammar: true, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    handlers.get(IPC.SET_RULES)!(null, rules)
    expect(setSetting).toHaveBeenCalledWith('rules', rules)
    expect(lastBroadcast()).toEqual({ rules })
  })

  it('STT_SETTINGS_SET stores and broadcasts', () => {
    const stt = { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'en', baseUrl: '' }
    onHandlers.get(IPC.STT_SETTINGS_SET)!(null, stt)
    expect(setSetting).toHaveBeenCalledWith('sttSettings', stt)
    expect(lastBroadcast()).toEqual({ sttSettings: stt })
  })

  it('LLM_SETTINGS_SET stores and broadcasts', () => {
    const llm = { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '' }
    onHandlers.get(IPC.LLM_SETTINGS_SET)!(null, llm)
    expect(setSetting).toHaveBeenCalledWith('llmSettings', llm)
    expect(lastBroadcast()).toEqual({ llmSettings: llm })
  })

  it('broadcast fans out to every open window', () => {
    windows.push({ webContents: { send: vi.fn() } })
    onHandlers.get(IPC.SET_AUTO_FORMAT)!(null, true)
    expect(windows[0].webContents.send).toHaveBeenCalledWith(IPC.SETTINGS_CHANGED, { autoFormat: true })
    expect(windows[1].webContents.send).toHaveBeenCalledWith(IPC.SETTINGS_CHANGED, { autoFormat: true })
  })

  describe('OPEN_EXTERNAL', () => {
    it('opens http(s) URLs', () => {
      onHandlers.get(IPC.OPEN_EXTERNAL)!(null, 'https://example.com')
      expect(openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('ignores non-http(s) URLs', () => {
      onHandlers.get(IPC.OPEN_EXTERNAL)!(null, 'file:///etc/passwd')
      expect(openExternal).not.toHaveBeenCalled()
    })
  })
})
