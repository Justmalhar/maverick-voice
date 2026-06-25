import type { DictationKey, ModifierKey, ActivationMode, ProviderModel } from '../../../shared/types'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)

// Full Whisper large-v3 language set (~99 languages) for the STT hint dropdown.
// value = ISO-639-1 code forwarded verbatim to Groq; 'auto' first => detect.
// Native <select> type-to-search makes the long list navigable.
export const STT_LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'ru', label: 'Russian' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'ja', label: 'Japanese' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'tr', label: 'Turkish' },
  { value: 'pl', label: 'Polish' },
  { value: 'ca', label: 'Catalan' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ar', label: 'Arabic' },
  { value: 'sv', label: 'Swedish' },
  { value: 'it', label: 'Italian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'hi', label: 'Hindi' },
  { value: 'fi', label: 'Finnish' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'he', label: 'Hebrew' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'el', label: 'Greek' },
  { value: 'ms', label: 'Malay' },
  { value: 'cs', label: 'Czech' },
  { value: 'ro', label: 'Romanian' },
  { value: 'da', label: 'Danish' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'ta', label: 'Tamil' },
  { value: 'no', label: 'Norwegian' },
  { value: 'th', label: 'Thai' },
  { value: 'ur', label: 'Urdu' },
  { value: 'hr', label: 'Croatian' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'la', label: 'Latin' },
  { value: 'mi', label: 'Maori' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'cy', label: 'Welsh' },
  { value: 'sk', label: 'Slovak' },
  { value: 'te', label: 'Telugu' },
  { value: 'fa', label: 'Persian' },
  { value: 'lv', label: 'Latvian' },
  { value: 'bn', label: 'Bengali' },
  { value: 'sr', label: 'Serbian' },
  { value: 'az', label: 'Azerbaijani' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'kn', label: 'Kannada' },
  { value: 'et', label: 'Estonian' },
  { value: 'mk', label: 'Macedonian' },
  { value: 'br', label: 'Breton' },
  { value: 'eu', label: 'Basque' },
  { value: 'is', label: 'Icelandic' },
  { value: 'hy', label: 'Armenian' },
  { value: 'ne', label: 'Nepali' },
  { value: 'mn', label: 'Mongolian' },
  { value: 'bs', label: 'Bosnian' },
  { value: 'kk', label: 'Kazakh' },
  { value: 'sq', label: 'Albanian' },
  { value: 'sw', label: 'Swahili' },
  { value: 'gl', label: 'Galician' },
  { value: 'mr', label: 'Marathi' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'si', label: 'Sinhala' },
  { value: 'km', label: 'Khmer' },
  { value: 'sn', label: 'Shona' },
  { value: 'yo', label: 'Yoruba' },
  { value: 'so', label: 'Somali' },
  { value: 'af', label: 'Afrikaans' },
  { value: 'oc', label: 'Occitan' },
  { value: 'ka', label: 'Georgian' },
  { value: 'be', label: 'Belarusian' },
  { value: 'tg', label: 'Tajik' },
  { value: 'sd', label: 'Sindhi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'am', label: 'Amharic' },
  { value: 'yi', label: 'Yiddish' },
  { value: 'lo', label: 'Lao' },
  { value: 'uz', label: 'Uzbek' },
  { value: 'fo', label: 'Faroese' },
  { value: 'ht', label: 'Haitian Creole' },
  { value: 'ps', label: 'Pashto' },
  { value: 'tk', label: 'Turkmen' },
  { value: 'nn', label: 'Norwegian Nynorsk' },
  { value: 'mt', label: 'Maltese' },
  { value: 'sa', label: 'Sanskrit' },
  { value: 'lb', label: 'Luxembourgish' },
  { value: 'my', label: 'Burmese' },
  { value: 'bo', label: 'Tibetan' },
  { value: 'tl', label: 'Tagalog' },
  { value: 'mg', label: 'Malagasy' },
  { value: 'as', label: 'Assamese' },
  { value: 'tt', label: 'Tatar' },
  { value: 'haw', label: 'Hawaiian' },
  { value: 'ln', label: 'Lingala' },
  { value: 'ha', label: 'Hausa' },
  { value: 'ba', label: 'Bashkir' },
  { value: 'jw', label: 'Javanese' },
  { value: 'su', label: 'Sundanese' },
  { value: 'yue', label: 'Cantonese' }
]

// Groq LLM chat models for the dropdown. 'groq' is shared with STT, so
// listModels('groq') returns the Whisper models — these LLM models are kept as
// a static catalogue here (the authoritative runtime list + pricing live in
// electron/providers/llm/groq.ts and electron/config.ts).
export const GROQ_LLM_MODELS: ProviderModel[] = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (versatile)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (instant)' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' }
]

// Platform-aware dictation key choices.
export const DICTATION_KEY_OPTIONS: { value: DictationKey; label: string }[] = IS_MAC
  ? [
      { value: 'fn', label: 'Fn (Globe)' },
      { value: 'right-option', label: 'Right Option' }
    ]
  : [
      { value: 'right-ctrl', label: 'Right Ctrl' },
      { value: 'right-alt', label: 'Right Alt' }
    ]

// Sentinel for the "Custom combo" segmented option — distinct from any
// DictationKey so the picker can switch the binding into combo mode.
export const COMBO_OPTION = '__combo__'

// Default dictation key per platform (used when switching combo -> single key).
export const DEFAULT_DICTATION_KEY: DictationKey = IS_MAC ? 'fn' : 'right-ctrl'

// Platform-aware modifier chips for the custom combo picker. ModifierKey is the
// darwin vocabulary; the resolver maps cmd->Win and option->Alt on win32, so we
// keep the same value union and only relabel for Windows.
export const MODIFIER_CHIPS: { value: ModifierKey; label: string }[] = IS_MAC
  ? [
      { value: 'cmd', label: '⌘ Cmd' },
      { value: 'ctrl', label: '⌃ Ctrl' },
      { value: 'option', label: '⌥ Option' },
      { value: 'shift', label: '⇧ Shift' },
      { value: 'fn', label: 'fn' }
    ]
  : [
      { value: 'cmd', label: 'Win' },
      { value: 'ctrl', label: 'Ctrl' },
      { value: 'option', label: 'Alt' },
      { value: 'shift', label: 'Shift' }
    ]

/** Short keycap label for an active-combo chip (e.g. '⌘'). */
export function modifierCapLabel(mod: ModifierKey): string {
  if (IS_MAC) {
    switch (mod) {
      case 'cmd':
        return '⌘'
      case 'ctrl':
        return '⌃'
      case 'option':
        return '⌥'
      case 'shift':
        return '⇧'
      case 'fn':
        return 'fn'
    }
  }
  switch (mod) {
    case 'cmd':
      return 'Win'
    case 'ctrl':
      return 'Ctrl'
    case 'option':
      return 'Alt'
    case 'shift':
      return 'Shift'
    case 'fn':
      return 'fn'
  }
}


export const ACTIVATION_MODES: { value: ActivationMode; label: string; blurb: string }[] = [
  { value: 'tap-toggle', label: 'Tap toggle', blurb: 'Tap once to start, tap again to stop.' },
  { value: 'push-to-talk', label: 'Push to talk', blurb: 'Hold the key to record, release to submit.' },
  { value: 'double-tap-push', label: 'Dual mode', blurb: 'Double-tap for hands-free, or hold to push-to-talk.' }
]

