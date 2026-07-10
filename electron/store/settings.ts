import Store from 'electron-store'
import type {
  ActivationMode,
  DictationBinding,
  DictionaryWord,
  InstructionKey,
  LLMSettings,
  OutputMode,
  RendererSettings,
  ReplacementEntry,
  RulesSettings,
  Snippet,
  STTSettings,
  ThemeSetting,
  WidgetPosition
} from '../../shared/types'

interface SettingsSchema {
  theme: ThemeSetting
  widgetPosition: WidgetPosition
  soundFeedback: boolean
  chunkedTranscription: boolean
  outputMode: OutputMode
  inputDeviceId: string
  dictationBinding: DictationBinding
  instructionKey: InstructionKey
  activationMode: ActivationMode
  instructionEnabled: boolean
  autoFormat: boolean
  appAwareFormatting: boolean
  pauseMediaDuringDictation: boolean
  dictionary: DictionaryWord[]
  replacements: ReplacementEntry[]
  snippets: Snippet[]
  rules: RulesSettings
  sttSettings: STTSettings
  llmSettings: LLMSettings
}

function platformDefaultBinding(): DictationBinding {
  // Capability-aware refinement (Fn detection) happens in keys/capability.ts;
  // this is only the cold-boot default.
  if (process.platform === 'darwin') return { type: 'key', key: 'fn' }
  return { type: 'key', key: 'right-ctrl' }
}

const DEFAULTS: SettingsSchema = {
  theme: 'system',
  widgetPosition: 'center',
  soundFeedback: true,
  chunkedTranscription: true,
  outputMode: 'paste',
  inputDeviceId: '',
  dictationBinding: platformDefaultBinding(),
  instructionKey: 'caps-lock',
  activationMode: 'tap-toggle',
  instructionEnabled: false,
  autoFormat: false,
  appAwareFormatting: true,
  pauseMediaDuringDictation: false,
  dictionary: [],
  replacements: [],
  snippets: [],
  rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] },
  sttSettings: { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'en', baseUrl: '' },
  llmSettings: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '' }
}

const store = new Store<SettingsSchema>({ defaults: DEFAULTS })

// One-time migration: dictionary used to hold {from,to} replacement pairs.
// Those move to `replacements`; dictionary now holds single vocabulary words.
{
  const legacy = store.get('dictionary') as unknown as Array<Record<string, string>>
  if (legacy.some((e) => e && typeof e.from === 'string')) {
    const migrated = legacy.filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string')
      .map((e) => ({ id: e.id, from: e.from, to: e.to }))
    store.set('replacements', [...migrated, ...store.get('replacements')])
    store.set('dictionary', [])
    console.log(`[settings] migrated ${migrated.length} dictionary entries to replacements`)
  }
}

export function getSetting<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] {
  return store.get(key)
}

export function setSetting<K extends keyof SettingsSchema>(key: K, value: SettingsSchema[K]): void {
  store.set(key, value)
}

/** The batched snapshot the renderer reads once (IPC.SETTINGS_GET). */
export function getRendererSettings(): RendererSettings {
  return {
    theme: store.get('theme'),
    widgetPosition: store.get('widgetPosition'),
    soundFeedback: store.get('soundFeedback'),
    chunkedTranscription: store.get('chunkedTranscription'),
    outputMode: store.get('outputMode'),
    inputDeviceId: store.get('inputDeviceId'),
    dictationBinding: store.get('dictationBinding'),
    instructionKey: store.get('instructionKey'),
    activationMode: store.get('activationMode'),
    instructionEnabled: store.get('instructionEnabled'),
    autoFormat: store.get('autoFormat'),
    appAwareFormatting: store.get('appAwareFormatting'),
    pauseMediaDuringDictation: store.get('pauseMediaDuringDictation'),
    dictionary: store.get('dictionary'),
    replacements: store.get('replacements'),
    snippets: store.get('snippets'),
    rules: store.get('rules'),
    sttSettings: store.get('sttSettings'),
    llmSettings: store.get('llmSettings')
  }
}
