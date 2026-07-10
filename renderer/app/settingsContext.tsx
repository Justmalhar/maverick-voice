import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ElectronAPI, RendererSettings } from '../../shared/types'

export interface SettingsContextValue {
  /** null until the initial batched SETTINGS_GET resolves. */
  settings: RendererSettings | null
  /** Optimistically merges + routes each changed key to its IPC setter. */
  update: (partial: Partial<RendererSettings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

/** Every tab reads/writes settings through this — ONE getSettings() call total. */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings() must be used within <SettingsProvider>')
  return ctx
}

type Setter = (api: ElectronAPI, value: never) => void

// One entry per RendererSettings key -> the IPC call that persists it.
// `theme` is included for completeness but AppearanceSection drives theme via
// useTheme()/setTheme() directly (ThemeProvider owns live matchMedia resolution).
const SETTERS: { [K in keyof RendererSettings]?: Setter } = {
  theme: (api, v) => api.setTheme(v),
  widgetPosition: (api, v) => api.setWidgetPosition(v),
  soundFeedback: (api, v) => api.setSoundFeedback(v),
  chunkedTranscription: (api, v) => api.setChunkedTranscription(v),
  outputMode: (api, v) => api.setOutputMode(v),
  inputDeviceId: (api, v) => api.setInputDevice(v),
  dictationBinding: (api, v) => api.setDictationBinding(v),
  activationMode: (api, v) => api.setActivationMode(v),
  instructionEnabled: (api, v) => api.setInstructionEnabled(v),
  autoFormat: (api, v) => api.setAutoFormat(v),
  appAwareFormatting: (api, v) => api.setAppAwareFormatting(v),
  pauseMediaDuringDictation: (api, v) => api.setPauseMediaDuringDictation(v),
  dictionary: (api, v) => void api.setDictionary(v).catch(() => {}),
  replacements: (api, v) => void api.setReplacements(v).catch(() => {}),
  snippets: (api, v) => void api.setSnippets(v).catch(() => {}),
  rules: (api, v) => void api.setRules(v).catch(() => {}),
  sttSettings: (api, v) => api.setSTTSettings(v),
  llmSettings: (api, v) => api.setLLMSettings(v)
}

export function SettingsProvider({ children }: { children: ReactNode }): ReactNode {
  const [settings, setSettings] = useState<RendererSettings | null>(null)

  useEffect(() => {
    let mounted = true
    window.electronAPI
      .getSettings()
      .then((s) => {
        if (mounted) setSettings(s)
      })
      .catch(() => {
        console.error('[settings] failed to load settings')
      })
    const unsubscribe = window.electronAPI.onSettingsChanged((partial) => {
      setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  function update(partial: Partial<RendererSettings>): void {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
    const api = window.electronAPI
    for (const key of Object.keys(partial) as (keyof RendererSettings)[]) {
      const setter = SETTERS[key]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- keyed dispatch, value type matches key by construction
      if (setter) (setter as (api: ElectronAPI, value: any) => void)(api, partial[key])
    }
  }

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}
