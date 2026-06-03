// ════════════════════════════════════════════════════════════════════════
// electron/main.ts — Maverick Voice main-process orchestration hub.
//
// Owns the app lifecycle (single-instance lock, boot order, quit cleanup),
// wires every IPC channel declared in shared/ipc.ts to the appropriate module,
// connects the keyListener → keyboardManager → sessionManager pipeline, and
// manages the Escape-key ownership machine + session persistence.
//
// Settings live in electron-store. Provider keys live in keyStore (safeStorage).
// There is NO remote backend, NO auth/deep-link, NO auto-updater, NO local
// whisper/llama — those were stripped from the reference unmute port.
// ════════════════════════════════════════════════════════════════════════

// ─── EPIPE guards (cross-platform safe) ───
// Prevent crashes when writing to a broken pipe (e.g. parent process gone).
process.stdout?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
})
process.stderr?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
})

import { app, ipcMain, globalShortcut, shell, systemPreferences } from 'electron'
import Store from 'electron-store'
import { IPC } from '../shared/ipc'
import type {
  STTSettings,
  LLMSettings,
  DictationKey,
  InstructionKey,
  ActivationMode,
  ProviderId,
  ProviderModel,
  AppConfig,
  OutputMode,
} from '../shared/types'

import { APP_CONFIG } from './config'
import {
  createMainWindow,
  createWidgetWindow,
  getMainWindow,
  showMainWindow,
  setHUDPosition,
  markHUDReady,
} from './windowManager'
import { createTray } from './tray'
import { sessionManager, cleanTranscript } from './sessionManager'
import { keyboardManager, KeyboardEvent } from './keyboard'
import { keyListener } from './keyListener'
import {
  initDB,
  saveSession,
  getSessions,
  getSession,
  updateSessionResult,
  closeDB,
} from './db'
import { getUsageSummary, resetUsage } from './usageTracker'
import { getAudioFilePath, loadAudioFile, loadAudioChunks } from './audio'
import { initErrorLogger, broadcastError } from './errorLogger'
import {
  getApiKey,
  hasApiKey,
  setApiKey,
  clearApiKey,
  getMaskedKey,
} from './keyStore'
import {
  getTranscriptionProvider,
  getLLMProvider,
} from './providers/registry'

// ════════════════════════════════════════════════════════════════════════
// Single-instance lock — a second launch focuses the existing window.
// ════════════════════════════════════════════════════════════════════════

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

app.on('second-instance', () => {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
})

// ════════════════════════════════════════════════════════════════════════
// Settings persistence (electron-store).
// ════════════════════════════════════════════════════════════════════════

// Platform-aware defaults. macOS dictation defaults to the Globe/Fn key; win32
// to Right-Ctrl. Instruction defaults to Right Shift on both (keyListener
// resolves Right Shift → Caps Lock on darwin for the native source).
const DEFAULT_DICTATION_KEY: DictationKey = process.platform === 'darwin' ? 'fn' : 'right-ctrl'
const DEFAULT_INSTRUCTION_KEY: InstructionKey = 'right-shift'

interface StoreSchema {
  widgetPosition: 'center' | 'right'
  soundFeedback: boolean
  chunkedTranscription: boolean
  outputMode: OutputMode
  inputDeviceId: string
  dictationKey: DictationKey
  instructionKey: InstructionKey
  activationMode: ActivationMode
  sttSettings: STTSettings
  llmSettings: LLMSettings
}

const STORE_DEFAULTS: StoreSchema = {
  widgetPosition: 'center',
  soundFeedback: true,
  chunkedTranscription: true,
  outputMode: 'paste',
  inputDeviceId: '',
  dictationKey: DEFAULT_DICTATION_KEY,
  instructionKey: DEFAULT_INSTRUCTION_KEY,
  activationMode: 'tap-toggle',
  sttSettings: { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'en' },
  llmSettings: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '' },
}

const store = new Store<StoreSchema>({ defaults: STORE_DEFAULTS })

/** Push persisted settings into the runtime managers on boot. */
function restoreSettings(): void {
  const sttSettings = store.get('sttSettings')
  const llmSettings = store.get('llmSettings')
  sessionManager.setSTTSettings(sttSettings)
  sessionManager.setLLMSettings(llmSettings)

  const outputMode = store.get('outputMode')
  sessionManager.setOutputMode(outputMode)

  const dictationKey = store.get('dictationKey')
  keyboardManager.setDictationKey(dictationKey)
  keyListener.setDictationKey(dictationKey)

  const instructionKey = store.get('instructionKey')
  keyboardManager.setInstructionKey(instructionKey)
  keyListener.setInstructionKey(instructionKey)

  const activationMode = store.get('activationMode')
  keyboardManager.setActivationMode(activationMode)

  const widgetPosition = store.get('widgetPosition')
  setHUDPosition(widgetPosition)

  console.log(
    '[main] Settings restored —',
    'stt:', JSON.stringify(sttSettings),
    '| llm:', JSON.stringify(llmSettings),
    '| outputMode:', outputMode,
    '| dictationKey:', dictationKey,
    '| instructionKey:', instructionKey,
    '| activationMode:', activationMode,
    '| widgetPosition:', widgetPosition
  )
}

// ════════════════════════════════════════════════════════════════════════
// Session persistence — save every completed session to SQLite.
// ════════════════════════════════════════════════════════════════════════

function setupSessionPersistence(): void {
  sessionManager.onSessionComplete = (session) => {
    const audioPath =
      getAudioFilePath(session.sessionId + '-dictation') ||
      getAudioFilePath(session.sessionId + '-instruction') ||
      getAudioFilePath(session.sessionId + '-dictation-final')
    saveSession({
      sessionId: session.sessionId,
      flowType: session.flowType,
      dictationTranscript: session.dictationTranscript,
      instructionTranscript: session.instructionTranscript,
      selectedText: session.selectedText,
      selectedTextRole: session.selectedTextRole,
      output: session.output,
      audioFilePath: audioPath,
      status: session.status === 'error' ? 'error' : 'done',
      errorMessage: session.errorMessage,
      createdAt: session.createdAt,
    })
    console.log('[main] Session saved:', session.sessionId, session.status)
  }
}

// ════════════════════════════════════════════════════════════════════════
// Keyboard wiring + Escape-owner machine.
// ════════════════════════════════════════════════════════════════════════

// Escape-key ownership — registered only while a dictation/instruction session
// is active (recording) and stays registered through processing so Esc can
// discard in-flight provider calls.
let escapeOwner: 'none' | 'dictation' = 'none'

function setupKeyboard(): void {
  keyboardManager.on('keyboard', (event: KeyboardEvent) => {
    console.log('[main] Keyboard event:', event)

    switch (event.type) {
      case 'session-start':
        sessionManager.startSession(event.mode)
        break
      case 'chain-start':
        sessionManager.chainSession(event.mode)
        break
      case 'session-stop':
        sessionManager.stopRecording(event.mode)
        break
      case 'chain-expired':
        // The chain-expired processing guard: never start a second
        // processSession while one is already in flight.
        if (sessionManager.processing) {
          console.log('[main] Ignoring chain-expired — still processing previous session')
          break
        }
        sessionManager.processSession()
        break
    }
  })

  // While recording: Escape cancels with a 3s undo window.
  // While processing: Escape discards the in-flight provider calls.
  sessionManager.onRecordingStarted = () => {
    if (escapeOwner === 'none') {
      try {
        globalShortcut.register('Escape', () => {
          if (sessionManager.processing) {
            console.log('[main] Escape during processing — cancelling session')
            sessionManager.cancelSession()
          } else {
            sessionManager.cancelSessionWithUndo()
          }
        })
        escapeOwner = 'dictation'
      } catch (err) {
        console.warn('[main] Failed to register Escape shortcut:', err instanceof Error ? err.message : err)
      }
    }
  }

  // Keep Escape registered through processing (do NOT unregister here) so the
  // user can press Esc to discard while provider calls are in flight. Escape is
  // unregistered in onSessionEnded instead.
  sessionManager.onRecordingStopped = () => {
    // Intentionally a no-op — see comment above.
  }

  // When a session fully ends (cancel, Escape, processing complete): reset the
  // keyboard routing state and release the Escape shortcut.
  sessionManager.onSessionEnded = () => {
    keyboardManager.resetState()
    if (escapeOwner === 'dictation') {
      try {
        globalShortcut.unregister('Escape')
      } catch {
        // Ignore — may already be unregistered.
      }
      escapeOwner = 'none'
    }
  }

  // When a session-start/chain/stop is rejected (e.g. a key press during
  // processing): reset the keyboard toggle state so it doesn't get stuck, but
  // leave Escape registered (it should stay active during processing).
  sessionManager.onSessionRejected = () => {
    keyboardManager.resetState()
  }

  keyboardManager.start()
}

// ════════════════════════════════════════════════════════════════════════
// Retry a saved session from its on-disk audio (re-transcribe + clean, no LLM).
// ════════════════════════════════════════════════════════════════════════

const retryingSessionIds = new Set<string>()

async function retrySessionFromAudio(sessionId: string): Promise<void> {
  const mainWindow = getMainWindow()
  if (!mainWindow?.webContents) return

  if (retryingSessionIds.has(sessionId)) {
    console.log('[retry] Already retrying session:', sessionId)
    return
  }
  retryingSessionIds.add(sessionId)

  try {
    // 1. Load the session row.
    const dbSession = getSession(sessionId)
    if (!dbSession) throw new Error('Session not found')

    // 2. Resolve the on-disk audio. A CHUNKED dictation never writes a single
    //    '<id>-dictation' file — it persists per-chunk WebM files (and only the
    //    LAST chunk under '<id>-dictation-final'), so reconstructing one name is
    //    insufficient. Prefer the ordered per-chunk files when present; fall
    //    back to the single-buffer file (dictation → instruction →
    //    dictation-final, matching setupSessionPersistence's resolution).
    const chunkBuffers = loadAudioChunks(sessionId)
    const singleBuffer =
      chunkBuffers.length === 0
        ? loadAudioFile(sessionId + '-dictation') ||
          loadAudioFile(sessionId + '-instruction') ||
          loadAudioFile(sessionId + '-dictation-final')
        : null
    if (chunkBuffers.length === 0 && !singleBuffer) {
      throw new Error('Audio file not found or unreadable')
    }

    // 3. Tell the renderer the retry has started.
    mainWindow.webContents.send(IPC.SESSION_RETRY_STATUS, sessionId, 'processing')

    // 4. Need a key for the configured STT provider.
    const stt = sessionManager.getSTTSettings()
    if (!hasApiKey(stt.provider)) {
      throw new Error(`Add your ${stt.provider} API key in Settings to retry.`)
    }

    // 5. Re-transcribe via the configured STT provider. Chunk files are
    //    independent WebM clips (one MediaRecorder per macro chunk) so they
    //    must be transcribed individually and stitched — mirroring the live
    //    chunked path — rather than byte-concatenated.
    const provider = getTranscriptionProvider(stt.provider)
    const key = getApiKey(stt.provider)!
    const transcribeOptions = {
      model: stt.model,
      language: stt.language === 'auto' ? undefined : stt.language,
      mimeType: 'audio/webm',
    } as const

    let transcript: string
    if (chunkBuffers.length > 0) {
      console.log(
        '[retry] Transcribing',
        chunkBuffers.length,
        'chunk(s) via STT provider:',
        stt.provider,
        '| model:',
        stt.model
      )
      const parts: string[] = []
      for (let i = 0; i < chunkBuffers.length; i++) {
        const { text } = await provider.transcribe(chunkBuffers[i], transcribeOptions, key)
        parts.push(text)
      }
      // cleanTranscript strips Whisper non-speech sentinels wherever they appear
      // (including between stitched chunks), so a plain ordered join + clean
      // reproduces the live stitchChunks() result without an LLM merge.
      transcript = cleanTranscript(parts.join(' '))
    } else {
      console.log('[retry] Transcribing audio via STT provider:', stt.provider, '| model:', stt.model)
      const { text } = await provider.transcribe(singleBuffer!, transcribeOptions, key)
      transcript = text
    }

    console.log('[retry] Transcript:', JSON.stringify(transcript))
    if (!transcript || transcript.trim() === '' || transcript === '[BLANK_AUDIO]') {
      throw new Error('Audio could not be transcribed (empty or blank)')
    }

    // 6. Raw-by-default: retry just re-transcribes and cleans (never the LLM).
    const output = cleanTranscript(transcript)

    // 7. Persist the updated result.
    updateSessionResult(sessionId, {
      dictationTranscript: transcript,
      output,
      status: 'done',
      errorMessage: null,
      flowType: 'dictation',
    })

    // 8. Notify the renderer: done (with the patched fields).
    mainWindow.webContents.send(IPC.SESSION_RETRY_STATUS, sessionId, 'done', {
      dictationTranscript: transcript,
      output,
      status: 'done',
      errorMessage: null,
      flowType: 'dictation',
    })

    console.log('[retry] ✅ Session retried successfully:', sessionId)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Retry failed'
    console.error('[retry] ❌ Error:', errorMsg)
    broadcastError('session', errorMsg)

    updateSessionResult(sessionId, {
      dictationTranscript: null,
      output: null,
      status: 'error',
      errorMessage: errorMsg,
    })

    getMainWindow()?.webContents.send(IPC.SESSION_RETRY_STATUS, sessionId, 'error', {
      status: 'error',
      errorMessage: errorMsg,
    })
  } finally {
    retryingSessionIds.delete(sessionId)
  }
}

// ════════════════════════════════════════════════════════════════════════
// Provider key-test routing — groq.testKey(key) vs openai/openrouter
// .testKey(key, baseUrl?).
// ════════════════════════════════════════════════════════════════════════

async function testProviderKey(
  provider: ProviderId,
  key: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (provider === 'groq') {
      return await getTranscriptionProvider('groq').testKey(key)
    }
    // openai | openrouter — pass the configured baseUrl override (if any).
    const llm = getLLMProvider(provider)
    const baseUrl = sessionManager.getLLMSettings().baseUrl || undefined
    return await llm.testKey(key, baseUrl)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Key test failed' }
  }
}

/** Static model list a provider advertises for the Settings dropdown. */
function listModelsFor(provider: ProviderId): ProviderModel[] {
  try {
    if (provider === 'groq') return getTranscriptionProvider('groq').models
    return getLLMProvider(provider).models
  } catch (err) {
    console.warn('[main] listModels failed for', provider, err instanceof Error ? err.message : err)
    return []
  }
}

// ════════════════════════════════════════════════════════════════════════
// IPC handlers — every channel in shared/ipc.ts that is R->M or R<->M.
// ════════════════════════════════════════════════════════════════════════

function setupIPC(): void {
  // ─── Audio streaming (R->M) ───
  ipcMain.on(
    IPC.AUDIO_READY,
    (_e, buffer: ArrayBuffer, duration: number, mode: 'dictation' | 'instruction', sessionId?: string) => {
      console.log('[main] Audio received, mode:', mode, 'duration:', duration, 'bytes:', buffer.byteLength)
      sessionManager.receiveAudio(Buffer.from(buffer), duration, mode, sessionId)
    }
  )

  ipcMain.on(
    IPC.AUDIO_CHUNK,
    (_e, buffer: ArrayBuffer, chunkIndex: number, mode: 'dictation' | 'instruction', sessionId?: string) => {
      console.log(`[main] Audio chunk ${chunkIndex} received (${buffer.byteLength} bytes, mode: ${mode})`)
      sessionManager.receiveAudioChunk(Buffer.from(buffer), chunkIndex, mode, sessionId)
    }
  )

  ipcMain.on(
    IPC.AUDIO_FINAL_CHUNK,
    (
      _e,
      buffer: ArrayBuffer,
      chunkIndex: number,
      totalChunks: number,
      duration: number,
      mode: 'dictation' | 'instruction',
      sessionId?: string
    ) => {
      console.log(
        `[main] Final audio chunk ${chunkIndex} received (${buffer.byteLength} bytes, totalChunks: ${totalChunks}, mode: ${mode})`
      )
      sessionManager.receiveAudioFinalChunk(Buffer.from(buffer), chunkIndex, totalChunks, duration, mode, sessionId)
    }
  )

  ipcMain.on(IPC.AUDIO_DISCARDED, (_e, mode: 'dictation' | 'instruction', sessionId?: string) => {
    console.log('[main] Audio discarded (too short), mode:', mode)
    sessionManager.discardSession(sessionId)
  })

  // ─── Widget control (R->M) ───
  // HUD Stop button: drive the same stop+process path the hotkey uses. Route
  // through the keyboard state machine so its toggle state stays consistent
  // (otherwise the next hotkey press would think a session is still active).
  // If the keyboard has no active session (edge case), fall back to driving the
  // sessionManager directly so the click is never a dead end.
  ipcMain.on(IPC.WIDGET_STOP, () => {
    console.log('[main] HUD Stop clicked')
    const stopped = keyboardManager.stopActiveSession()
    if (stopped) return
    if (sessionManager.processing) {
      console.log('[main] HUD Stop ignored — already processing')
      return
    }
    if (!sessionManager.getCurrentSession()) {
      console.log('[main] HUD Stop ignored — no current session')
      return
    }
    // Fallback: stop recording then process now (mirrors session-stop →
    // chain-expired). processSession() polls briefly for in-flight audio IPC.
    sessionManager.stopRecording('dictation')
    sessionManager.processSession()
  })

  ipcMain.on(IPC.WIDGET_CANCEL, () => {
    console.log('[main] Session cancelled (widget)')
    sessionManager.cancelSession()
  })

  ipcMain.on(IPC.WIDGET_UNDO_CANCEL, () => {
    console.log('[main] Undo cancel requested (widget)')
    sessionManager.undoCancel()
  })

  // Widget renderer signals it mounted + registered listeners — gates showHUD().
  ipcMain.on(IPC.WIDGET_READY, () => markHUDReady())

  // ─── Session history (R<->M) ───
  ipcMain.on(IPC.SESSION_RETRY, (_e, sessionId: string) => {
    console.log('[main] Retry session:', sessionId)
    retrySessionFromAudio(sessionId)
  })

  ipcMain.handle(IPC.SESSION_LIST, () => getSessions())

  // ─── Usage (R<->M) ───
  ipcMain.handle(IPC.USAGE_GET, () => getUsageSummary())
  ipcMain.handle(IPC.USAGE_RESET, () => {
    resetUsage()
    return getUsageSummary()
  })

  // ─── Per-provider API keys (R<->M, safeStorage) ───
  ipcMain.handle(IPC.KEY_STATUS, (_e, provider: ProviderId) => {
    return { hasKey: hasApiKey(provider), masked: getMaskedKey(provider) }
  })

  ipcMain.handle(IPC.KEY_SET, (_e, provider: ProviderId, key: string) => {
    try {
      setApiKey(provider, key)
      return { success: true, masked: getMaskedKey(provider) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save key' }
    }
  })

  ipcMain.handle(IPC.KEY_TEST, async (_e, provider: ProviderId, key: string) => {
    return testProviderKey(provider, key)
  })

  ipcMain.on(IPC.KEY_CLEAR, (_e, provider: ProviderId) => {
    console.log('[main] Clearing key for provider:', provider)
    clearApiKey(provider)
  })

  // ─── STT / LLM provider settings (R<->M) ───
  ipcMain.handle(IPC.STT_SETTINGS_GET, () => sessionManager.getSTTSettings())
  ipcMain.on(IPC.STT_SETTINGS_SET, (_e, settings: STTSettings) => {
    console.log('[main] STT settings set:', JSON.stringify(settings))
    sessionManager.setSTTSettings(settings)
    store.set('sttSettings', settings)
  })

  ipcMain.handle(IPC.LLM_SETTINGS_GET, () => sessionManager.getLLMSettings())
  ipcMain.on(IPC.LLM_SETTINGS_SET, (_e, settings: LLMSettings) => {
    console.log('[main] LLM settings set:', JSON.stringify(settings))
    sessionManager.setLLMSettings(settings)
    store.set('llmSettings', settings)
  })

  ipcMain.handle(IPC.LIST_MODELS, (_e, provider: ProviderId) => listModelsFor(provider))

  // ─── Permissions (macOS; win32 resolves granted/no-op) ───
  ipcMain.handle(IPC.PERM_MIC_STATUS, () => {
    if (process.platform !== 'darwin') return 'granted'
    return systemPreferences.getMediaAccessStatus('microphone')
  })

  ipcMain.handle(IPC.PERM_REQUEST_MIC, async () => {
    if (process.platform !== 'darwin') return true
    try {
      return await systemPreferences.askForMediaAccess('microphone')
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.PERM_ACCESSIBILITY_STATUS, () => {
    if (process.platform !== 'darwin') return true
    return systemPreferences.isTrustedAccessibilityClient(false)
  })

  ipcMain.handle(IPC.PERM_REQUEST_ACCESSIBILITY, () => {
    if (process.platform !== 'darwin') return true
    // prompt=true surfaces the macOS Accessibility prompt and adds the app to
    // the list, so the user only has to flip the toggle.
    return systemPreferences.isTrustedAccessibilityClient(true)
  })

  ipcMain.on(IPC.PERM_OPEN_MIC_SETTINGS, () => {
    if (process.platform !== 'darwin') return
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  })

  ipcMain.on(IPC.PERM_OPEN_ACCESSIBILITY_SETTINGS, () => {
    if (process.platform !== 'darwin') return
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  })

  ipcMain.on(IPC.PERM_OPEN_KEYBOARD_SETTINGS, () => {
    if (process.platform !== 'darwin') return
    // Point users at "Press 🌐/Fn key to: Do Nothing" to free the Fn key. The
    // modern System Settings URL works on macOS 13+; fall back to the legacy one.
    shell
      .openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension')
      .catch(() => shell.openExternal('x-apple.systempreferences:com.apple.preference.keyboard'))
  })

  // ─── External links (R->M) ───
  ipcMain.on(IPC.OPEN_EXTERNAL, (_e, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  // ─── Local app config (R<->M) — APP_CONFIG + store overrides ───
  ipcMain.handle(IPC.CONFIG_GET, (): AppConfig => {
    // The renderer reads chunking at recording start; honour the user's
    // chunked-transcription toggle by layering it over the constant default.
    return {
      ...APP_CONFIG,
      chunking: {
        ...APP_CONFIG.chunking,
        enabled: store.get('chunkedTranscription'),
      },
    }
  })

  // ─── Appearance / behaviour settings ───
  ipcMain.on(IPC.SET_WIDGET_POSITION, (_e, position: 'center' | 'right') => {
    console.log('[main] Widget position set:', position)
    if (position === 'center' || position === 'right') {
      setHUDPosition(position)
      store.set('widgetPosition', position)
    }
  })
  ipcMain.handle(IPC.GET_WIDGET_POSITION, () => store.get('widgetPosition'))

  ipcMain.on(IPC.SET_SOUND_FEEDBACK, (_e, enabled: boolean) => {
    console.log('[main] Sound feedback set:', enabled)
    store.set('soundFeedback', !!enabled)
  })
  ipcMain.handle(IPC.GET_SOUND_FEEDBACK, () => store.get('soundFeedback'))

  ipcMain.on(IPC.SET_CHUNKED_TRANSCRIPTION, (_e, enabled: boolean) => {
    console.log('[main] Chunked transcription set:', enabled)
    store.set('chunkedTranscription', !!enabled)
  })
  ipcMain.handle(IPC.GET_CHUNKED_TRANSCRIPTION, () => store.get('chunkedTranscription'))

  ipcMain.on(IPC.SET_OUTPUT_MODE, (_e, mode: OutputMode) => {
    if (mode !== 'paste' && mode !== 'clipboard') return
    console.log('[main] Output mode set:', mode)
    sessionManager.setOutputMode(mode)
    store.set('outputMode', mode)
  })
  ipcMain.handle(IPC.GET_OUTPUT_MODE, () => store.get('outputMode'))

  ipcMain.on(IPC.SET_INPUT_DEVICE, (_e, deviceId: string) => {
    const value = typeof deviceId === 'string' ? deviceId : ''
    console.log('[main] Input device set:', value || '(system default)')
    store.set('inputDeviceId', value)
  })
  ipcMain.handle(IPC.GET_INPUT_DEVICE, () => store.get('inputDeviceId'))

  // ─── Key bindings ───
  ipcMain.on(IPC.SET_DICTATION_KEY, (_e, key: DictationKey) => {
    console.log('[main] Dictation key set:', key)
    keyboardManager.setDictationKey(key)
    keyListener.setDictationKey(key)
    store.set('dictationKey', key)
  })
  ipcMain.handle(IPC.GET_DICTATION_KEY, () => keyboardManager.getDictationKey())

  ipcMain.on(IPC.SET_INSTRUCTION_KEY, (_e, key: InstructionKey) => {
    console.log('[main] Instruction key set:', key)
    keyboardManager.setInstructionKey(key)
    keyListener.setInstructionKey(key)
    store.set('instructionKey', key)
  })
  ipcMain.handle(IPC.GET_INSTRUCTION_KEY, () => keyboardManager.getInstructionKey())

  ipcMain.on(IPC.SET_ACTIVATION_MODE, (_e, mode: ActivationMode) => {
    console.log('[main] Activation mode set:', mode)
    keyboardManager.setActivationMode(mode)
    store.set('activationMode', mode)
  })
  ipcMain.handle(IPC.GET_ACTIVATION_MODE, () => keyboardManager.getActivationMode())
}

// ════════════════════════════════════════════════════════════════════════
// App lifecycle.
// ════════════════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  // Boot order (per INTERFACES.md): DB → settings → windows → tray → error
  // logger → session persistence → IPC → keyboard. IPC is registered BEFORE
  // the keyboard so a key-listener crash can't block IPC handlers.
  initDB()
  restoreSettings()
  createMainWindow()
  createWidgetWindow()
  createTray()

  initErrorLogger(() => getMainWindow())

  setupSessionPersistence()
  setupIPC()

  try {
    setupKeyboard()
  } catch (err) {
    console.error(
      '[main] setupKeyboard failed (app still works, hotkeys disabled):',
      err instanceof Error ? err.message : err
    )
  }

  app.on('activate', () => {
    // Dock click: surface (or recreate) the dashboard. Checking
    // getAllWindows().length === 0 would never fire — the hidden HUD widget
    // window almost always still exists.
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  // On macOS, apps typically stay alive (tray-resident) until the user quits.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  keyListener.stop()
  closeDB()
})
