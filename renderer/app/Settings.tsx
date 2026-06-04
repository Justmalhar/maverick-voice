import { useState, useEffect, useCallback } from 'react'
// Deep-import the MONO sub-component only — the package barrel pulls Avatar/
// Combine variants that depend on antd, bloating the renderer bundle. The Mono
// component is pure React + SVG (currentColor), strictly monochrome.
import Groq from '@lobehub/icons/es/Groq/components/Mono'
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono'
import OpenRouter from '@lobehub/icons/es/OpenRouter/components/Mono'
import type {
  DictationKey,
  DictationBinding,
  ModifierKey,
  ActivationMode,
  STTSettings,
  LLMSettings,
  LLMProviderId,
  ProviderId,
  ProviderModel,
  UsageSummary
} from '../../shared/types'

// ─── Platform detection (renderer can't import process.platform) ───
// Electron sets a desktop UA; the OS token is reliable enough to gate the
// macOS-only permission rows + key vocabulary. win32 resolves permissions to
// granted/no-op in main.ts, so hiding those rows on Windows is purely cosmetic.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)

interface AudioDevice {
  deviceId: string
  label: string
}

interface SettingsProps {
  onDictationKeyChange?: (key: DictationKey) => void
}

// Full Whisper large-v3 language set (~99 languages) for the STT hint dropdown.
// value = ISO-639-1 code forwarded verbatim to Groq; 'auto' first => detect.
// Native <select> type-to-search makes the long list navigable.
const STT_LANGUAGES: { value: string; label: string }[] = [
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

/** Provider brand glyph (lobehub mono base components — currentColor). */
function ProviderGlyph({ provider }: { provider: ProviderId }) {
  switch (provider) {
    case 'groq':
      return <Groq size={18} />
    case 'openai':
      return <OpenAI size={18} />
    case 'openrouter':
      return <OpenRouter size={18} />
    default:
      return null
  }
}

/** Plain glass chip wrapping a provider glyph — engine/context affordance
 *  (no status dot). Grayscale-forced to stay strictly monochrome. */
function ProviderChip({ provider }: { provider: ProviderId }) {
  return (
    <span className="flex items-center justify-center w-8 h-8 rounded-mv-md bg-mv-white-04 border border-mv-border text-mv-text-primary shrink-0 [&_svg]:grayscale">
      <ProviderGlyph provider={provider} />
    </span>
  )
}

// Groq LLM chat models for the dropdown. 'groq' is shared with STT, so
// listModels('groq') returns the Whisper models — these LLM models are kept as
// a static catalogue here (the authoritative runtime list + pricing live in
// electron/providers/llm/groq.ts and electron/config.ts).
const GROQ_LLM_MODELS: ProviderModel[] = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (versatile)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (instant)' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' }
]

// Platform-aware dictation key choices.
const DICTATION_KEY_OPTIONS: { value: DictationKey; label: string }[] = IS_MAC
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
const COMBO_OPTION = '__combo__'

// Default dictation key per platform (used when switching combo -> single key).
const DEFAULT_DICTATION_KEY: DictationKey = IS_MAC ? 'fn' : 'right-ctrl'

// Platform-aware modifier chips for the custom combo picker. ModifierKey is the
// darwin vocabulary; the resolver maps cmd->Win and option->Alt on win32, so we
// keep the same value union and only relabel for Windows.
const MODIFIER_CHIPS: { value: ModifierKey; label: string }[] = IS_MAC
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
function modifierCapLabel(mod: ModifierKey): string {
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


const ACTIVATION_MODES: { value: ActivationMode; label: string; blurb: string }[] = [
  { value: 'tap-toggle', label: 'Tap toggle', blurb: 'Tap once to start, tap again to stop.' },
  { value: 'push-to-talk', label: 'Push to talk', blurb: 'Hold the key to record, release to submit.' },
  { value: 'double-tap-push', label: 'Dual mode', blurb: 'Double-tap for hands-free, or hold to push-to-talk.' }
]

/** Estimated USD; sub-cent totals show as "<$0.01". */
function fmtUsd(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

export default function Settings({ onDictationKeyChange }: SettingsProps = {}) {
  // ── Usage (compact 3-stat row) ──
  const [usage, setUsage] = useState<UsageSummary | null>(null)

  // ── Audio ──
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')

  // ── Behaviour / appearance ──
  const [outputMode, setOutputMode] = useState<'paste' | 'clipboard'>('paste')
  const [soundFeedback, setSoundFeedback] = useState(true)
  const [chunkedTranscription, setChunkedTranscription] = useState(true)
  const [widgetPosition, setWidgetPosition] = useState<'center' | 'right'>('center')

  // ── AI ──
  const [autoFormat, setAutoFormat] = useState(false)
  const [appAwareFormatting, setAppAwareFormatting] = useState(true)
  const [instructionEnabled, setInstructionEnabled] = useState(false)

  // ── Key bindings ──
  // `binding` is the source of truth for the picker. `dictationKey` mirrors the
  // single-key choice (also fed to the legacy onDictationKeyChange callback).
  const [binding, setBinding] = useState<DictationBinding>({ type: 'key', key: DEFAULT_DICTATION_KEY })
  const [dictationKey, setDictationKey] = useState<DictationKey>(DEFAULT_DICTATION_KEY)
  const [activationMode, setActivationMode] = useState<ActivationMode>('tap-toggle')

  // ── Provider settings ──
  const [sttSettings, setSttSettings] = useState<STTSettings>({
    provider: 'groq',
    model: 'whisper-large-v3-turbo',
    language: 'en'
  })
  const [llmSettings, setLlmSettings] = useState<LLMSettings>({
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: ''
  })
  const [sttModels, setSttModels] = useState<ProviderModel[]>([])
  const [openaiModels, setOpenaiModels] = useState<ProviderModel[]>([])
  const [openrouterModels, setOpenrouterModels] = useState<ProviderModel[]>([])

  // ── Advanced disclosure ──
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // ── Permissions (macOS) ──
  const [micStatus, setMicStatus] = useState<string>('unknown')
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean>(false)
  const micGranted = micStatus === 'granted'

  const refreshPermissions = useCallback(async () => {
    if (!IS_MAC) return
    try {
      const [m, a] = await Promise.all([
        window.electronAPI.getMicPermissionStatus(),
        window.electronAPI.getAccessibilityStatus()
      ])
      setMicStatus(m)
      setAccessibilityGranted(a)
    } catch {
      /* best-effort */
    }
  }, [])

  useEffect(() => {
    if (!IS_MAC) return
    refreshPermissions()
    const onFocus = () => refreshPermissions()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshPermissions])

  useEffect(() => {
    // Usage stats for the compact header row.
    window.electronAPI.getUsage().then(setUsage).catch(() => {})

    // Load the persisted microphone choice first, then enumerate devices so the
    // dropdown reflects the saved selection instead of resetting to the first
    // device. '' = system default (recorder passes undefined).
    window.electronAPI
      .getInputDevice()
      .then((saved) => loadAudioDevices(saved))
      .catch(() => loadAudioDevices())

    window.electronAPI.getWidgetPosition().then((v) => {
      if (v === 'center' || v === 'right') setWidgetPosition(v)
    })
    window.electronAPI.getSoundFeedback().then(setSoundFeedback).catch(() => {})
    window.electronAPI.getChunkedTranscription().then(setChunkedTranscription).catch(() => {})
    window.electronAPI.getAutoFormat().then(setAutoFormat).catch(() => {})
    window.electronAPI.getAppAwareFormatting().then(setAppAwareFormatting).catch(() => {})
    window.electronAPI.getInstructionEnabled().then(setInstructionEnabled).catch(() => {})
    window.electronAPI
      .getOutputMode()
      .then((v) => {
        if (v === 'paste' || v === 'clipboard') setOutputMode(v)
      })
      .catch(() => {})
    // Binding supersedes the legacy single-key accessor in Settings. Mirror the
    // single-key value into `dictationKey` so a combo->key switch has a sane default.
    window.electronAPI
      .getDictationBinding()
      .then((b) => {
        setBinding(b)
        if (b.type === 'key' && ['fn', 'right-option', 'right-ctrl', 'right-alt'].includes(b.key)) {
          setDictationKey(b.key)
        }
      })
      .catch(() => {})
    window.electronAPI.getActivationMode().then((v) => {
      if (v === 'tap-toggle' || v === 'push-to-talk' || v === 'double-tap-push') setActivationMode(v)
    })
    window.electronAPI.getSTTSettings().then(setSttSettings).catch(() => {})
    window.electronAPI.getLLMSettings().then(setLlmSettings).catch(() => {})

    // Static model catalogues for the dropdowns.
    window.electronAPI.listModels('groq').then(setSttModels).catch(() => {})
    window.electronAPI.listModels('openai').then(setOpenaiModels).catch(() => {})
    window.electronAPI.listModels('openrouter').then(setOpenrouterModels).catch(() => {})
  }, [])

  async function loadAudioDevices(savedDeviceId?: string) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 8)}` }))
      setAudioDevices(audioInputs)
      // Prefer the persisted selection when it's still attached; otherwise fall
      // back to the first available device. Never overwrite an existing choice.
      const persistedStillPresent = !!savedDeviceId && audioInputs.some((d) => d.deviceId === savedDeviceId)
      if (persistedStillPresent) {
        setSelectedDevice(savedDeviceId!)
      } else if (audioInputs.length > 0 && !selectedDevice) {
        setSelectedDevice(audioInputs[0].deviceId)
      }
    } catch (err) {
      console.error('[settings] Failed to enumerate audio devices:', err)
    }
  }

  function handleInputDeviceChange(deviceId: string) {
    setSelectedDevice(deviceId)
    window.electronAPI.setInputDevice(deviceId)
  }

  function handleOutputModeChange(mode: 'paste' | 'clipboard') {
    setOutputMode(mode)
    window.electronAPI.setOutputMode(mode)
  }

  // ── Permission grant handlers ──
  async function handleGrantMic() {
    const ok = await window.electronAPI.requestMicPermission()
    if (ok) {
      setMicStatus('granted')
      return
    }
    const next = await window.electronAPI.getMicPermissionStatus()
    setMicStatus(next)
    if (next !== 'granted') window.electronAPI.openMicSettings()
  }

  async function handleGrantAccessibility() {
    const ok = await window.electronAPI.requestAccessibility()
    setAccessibilityGranted(ok)
    if (!ok) window.electronAPI.openAccessibilitySettings()
  }

  // ── Behaviour / appearance handlers ──
  function handleWidgetPositionChange(value: string) {
    const pos = value as 'center' | 'right'
    setWidgetPosition(pos)
    window.electronAPI.setWidgetPosition(pos)
  }

  function handleSoundFeedbackChange(value: boolean) {
    setSoundFeedback(value)
    window.electronAPI.setSoundFeedback(value)
  }

  function handleChunkedChange(value: boolean) {
    setChunkedTranscription(value)
    window.electronAPI.setChunkedTranscription(value)
  }

  // ── AI handlers ──
  function handleAutoFormatChange(value: boolean) {
    setAutoFormat(value)
    window.electronAPI.setAutoFormat(value)
  }

  function handleAppAwareFormattingChange(value: boolean) {
    setAppAwareFormatting(value)
    window.electronAPI.setAppAwareFormatting(value)
  }

  function handleInstructionEnabledChange(value: boolean) {
    setInstructionEnabled(value)
    window.electronAPI.setInstructionEnabled(value)
  }

  // ── Key binding handlers ──
  // The segmented picker offers the single-key options + a "Custom combo" entry.
  // Selecting a single key persists a `{type:'key'}` binding immediately;
  // selecting combo only switches the UI into combo mode (persists once >=2 mods
  // are chosen — see toggleComboModifier).
  function handleBindingPickerChange(value: string) {
    if (value === COMBO_OPTION) {
      // Switch into combo mode without persisting yet (needs >=2 modifiers).
      // Seed from any previously-stored combo so re-opening keeps the selection.
      setBinding((prev) => (prev.type === 'combo' ? prev : { type: 'combo', mods: [] }))
      return
    }
    const key = value as DictationKey
    setBinding({ type: 'key', key })
    setDictationKey(key)
    window.electronAPI.setDictationBinding({ type: 'key', key })
    onDictationKeyChange?.(key)
  }

  // Toggle a modifier in the combo. Persist only when >=2 are selected (the
  // resolver also enforces this); otherwise hold the selection in local state and
  // show the inline hint.
  function toggleComboModifier(mod: ModifierKey) {
    setBinding((prev) => {
      const mods = prev.type === 'combo' ? prev.mods : []
      const next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod]
      const nextBinding: DictationBinding = { type: 'combo', mods: next }
      if (next.length >= 2) window.electronAPI.setDictationBinding(nextBinding)
      return nextBinding
    })
  }

  function handleActivationModeChange(value: string) {
    const mode = value as ActivationMode
    setActivationMode(mode)
    window.electronAPI.setActivationMode(mode)
  }

  // ── Provider settings handlers ──
  function updateStt(patch: Partial<STTSettings>) {
    setSttSettings((prev) => {
      const next = { ...prev, ...patch }
      window.electronAPI.setSTTSettings(next)
      return next
    })
  }

  function updateLlm(patch: Partial<LLMSettings>) {
    setLlmSettings((prev) => {
      const next = { ...prev, ...patch }
      window.electronAPI.setLLMSettings(next)
      return next
    })
  }

  function handleLlmProviderChange(provider: LLMProviderId) {
    // Switching provider resets the model to that provider's first advertised
    // model so the dropdown never points at a foreign model id.
    const models = provider === 'openai' ? openaiModels : provider === 'openrouter' ? openrouterModels : GROQ_LLM_MODELS
    const model = models[0]?.id || llmSettings.model
    updateLlm({ provider, model })
  }

  const llmModels =
    llmSettings.provider === 'openai' ? openaiModels : llmSettings.provider === 'openrouter' ? openrouterModels : GROQ_LLM_MODELS
  const activationBlurb = ACTIVATION_MODES.find((a) => a.value === activationMode)?.blurb

  // Dictation picker derived state.
  const isComboMode = binding.type === 'combo'
  const comboMods = binding.type === 'combo' ? binding.mods : []
  const bindingPickerValue = isComboMode ? COMBO_OPTION : binding.key
  const dictationKeyPickerOptions = [...DICTATION_KEY_OPTIONS, { value: COMBO_OPTION, label: 'Custom combo' }]
  const comboTooFew = comboMods.length < 2

  return (
    <div>
      <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight mb-5">Settings</h2>

      {/* ═══ Usage stats (compact, top) ═══ */}
      <div className="mv-stat-row mb-7">
        <StatPill label="Today" value={fmtUsd(usage?.today.cost)} />
        <StatPill label="This month" value={fmtUsd(usage?.month.cost)} />
        <StatPill label="All time" value={fmtUsd(usage?.allTime.cost)} />
      </div>

      {/* ═══ General ═══ */}
      <Section title="General" icon={<SlidersIcon />}>
        <SettingRow label="Microphone" description="Your input device">
          <select className="mv-select min-w-[200px]" value={selectedDevice} onChange={(e) => handleInputDeviceChange(e.target.value)}>
            {audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Widget position" description="Where the HUD pill appears on screen">
          <Segmented
            options={[
              { value: 'center', label: 'Top center' },
              { value: 'right', label: 'Top right' }
            ]}
            value={widgetPosition}
            onChange={handleWidgetPositionChange}
          />
        </SettingRow>
        <SettingRow label="Sound feedback" description="Play sounds on start / stop" last>
          <Toggle checked={soundFeedback} onChange={handleSoundFeedbackChange} />
        </SettingRow>
      </Section>

      {/* ═══ Dictation ═══ */}
      <Section title="Dictation" icon={<MicIcon />}>
        <SettingRow label="Dictation trigger" description="The key — or modifier combo — you press to start dictating">
          <Segmented options={dictationKeyPickerOptions} value={bindingPickerValue} onChange={handleBindingPickerChange} />
        </SettingRow>

        {isComboMode && (
          <div className="px-5 py-4 border-b border-mv-border">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-mv-text-secondary">Combo modifiers</p>
                <p className="text-[10.5px] text-mv-text-muted mt-0.5 max-w-[260px] leading-snug">
                  Hold these together to dictate. Pick at least two to avoid clashing with system shortcuts.
                </p>
              </div>
              {/* Active combo as keycap chips */}
              <div className="shrink-0 flex items-center gap-1.5">
                {comboMods.length > 0 ? (
                  comboMods.map((m) => (
                    <kbd key={m} className="kbd-3d !min-w-[28px] !px-2 !py-1 !text-[11px]">
                      {modifierCapLabel(m)}
                    </kbd>
                  ))
                ) : (
                  <span className="text-[11px] text-mv-text-muted">No combo set</span>
                )}
              </div>
            </div>

            {/* Modifier toggle-chips */}
            <div className="mv-combo-chips">
              {MODIFIER_CHIPS.map((chip) => {
                const active = comboMods.includes(chip.value)
                return (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => toggleComboModifier(chip.value)}
                    className={`mv-combo-chip ${active ? 'mv-combo-chip--active' : ''}`}
                    aria-pressed={active}
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>

            {comboTooFew && <p className="text-[11px] text-mv-text-muted mt-2.5">Pick at least two modifiers</p>}
          </div>
        )}

        <SettingRow label="Activation mode" description={activationBlurb || ''}>
          <Segmented options={ACTIVATION_MODES} value={activationMode} onChange={handleActivationModeChange} />
        </SettingRow>
        <div className="flex items-center justify-between px-5 py-4 gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <ProviderChip provider="groq" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-mv-text-primary">Language</p>
              <p className="text-[11px] text-mv-text-muted mt-0.5 leading-snug">Speech recognition hint · Groq Whisper</p>
            </div>
          </div>
          <select
            className="mv-select min-w-[160px] shrink-0"
            value={sttSettings.language}
            onChange={(e) => updateStt({ language: e.target.value })}
          >
            {STT_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            {/* Keep an unrecognized stored code selectable rather than silently
                resetting it to the first option. */}
            {!STT_LANGUAGES.some((l) => l.value === sttSettings.language) && (
              <option value={sttSettings.language}>{sttSettings.language}</option>
            )}
          </select>
        </div>
      </Section>

      {/* ═══ AI ═══ */}
      <Section title="AI" icon={<WandIcon />}>
        <SettingRow
          label="AI auto-format"
          description="Clean up grammar, punctuation, and paragraphing of your dictation — meaning untouched."
        >
          <Toggle checked={autoFormat} onChange={handleAutoFormatChange} />
        </SettingRow>

        {/* Adapt to active app — nested under Auto-Format; only effective when on. */}
        <div className={`pl-9 pr-5 py-4 border-b border-mv-border ${autoFormat ? '' : 'opacity-50'}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-mv-text-primary">Adapt to active app</p>
              <p className="text-[11px] text-mv-text-muted mt-0.5 leading-snug max-w-[360px]">
                Emails get paragraphs, IDE prompts get @file references, chats stay casual.
              </p>
            </div>
            <div className="shrink-0">
              <Toggle
                checked={appAwareFormatting}
                onChange={handleAppAwareFormattingChange}
                disabled={!autoFormat}
              />
            </div>
          </div>
        </div>

        {/* LLM provider + model — the engine that powers auto-format & edits. */}
        <SettingRow label="LLM provider" description="Powers auto-format and voice edits">
          <Segmented
            options={[
              { value: 'groq', label: 'Groq', icon: <ProviderGlyph provider="groq" /> },
              { value: 'openai', label: 'OpenAI', icon: <ProviderGlyph provider="openai" /> },
              { value: 'openrouter', label: 'OpenRouter', icon: <ProviderGlyph provider="openrouter" /> }
            ]}
            value={llmSettings.provider}
            onChange={(v) => handleLlmProviderChange(v as LLMProviderId)}
          />
        </SettingRow>
        <SettingRow label="Model" description="Chat model used for AI passes" last>
          <select className="mv-select min-w-[200px]" value={llmSettings.model} onChange={(e) => updateLlm({ model: e.target.value })}>
            {llmModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {/* allow a custom model id (escape hatch) to remain selected */}
            {!llmModels.some((m) => m.id === llmSettings.model) && (
              <option value={llmSettings.model}>{llmSettings.model} (custom)</option>
            )}
          </select>
        </SettingRow>
      </Section>

      {/* ═══ Providers & keys (unified) ═══ */}
      <Section title="Providers & keys" icon={<KeyIcon />}>
        <ProviderKeyRow
          provider="groq"
          label="Groq"
          sublabel="Speech-to-text · LLM"
          tag="Required"
          placeholder="gsk_..."
          consoleUrl="https://console.groq.com/keys"
        />
        <Divider />
        <ProviderKeyRow
          provider="openai"
          label="OpenAI"
          sublabel="AI auto-format & edits"
          placeholder="sk-..."
          consoleUrl="https://platform.openai.com/api-keys"
        />
        <Divider />
        <ProviderKeyRow
          provider="openrouter"
          label="OpenRouter"
          sublabel="AI auto-format & edits"
          placeholder="sk-or-..."
          consoleUrl="https://openrouter.ai/keys"
          last
        />
      </Section>

      {/* ═══ Advanced (collapsed) ═══ */}
      <div className="mv-section-label mb-2.5 mt-6">
        <span className="text-mv-text-muted">
          <CogIcon />
        </span>
        Advanced
      </div>
      <div className="mv-glass-card overflow-hidden mb-3">
        <button
          className="mv-disclosure__head"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <div className="min-w-0 text-left">
            <p className="text-[13px] font-semibold text-mv-text-primary">Advanced settings</p>
            <p className="text-[11px] text-mv-text-muted mt-0.5">
              Voice editing, custom model & endpoint, output, permissions
            </p>
          </div>
          <span className={`mv-disclosure__chevron ${advancedOpen ? 'mv-disclosure__chevron--open' : ''}`}>
            <ChevronIcon />
          </span>
        </button>

        {advancedOpen && (
          <div className="border-t border-mv-border">
            {/* Instruction mode opt-in */}
            <SettingRow
              label="Edit selected text with voice"
              description="Select text, tap a key, and speak an instruction to rewrite it."
            >
              <Toggle checked={instructionEnabled} onChange={handleInstructionEnabledChange} />
            </SettingRow>
            {instructionEnabled && (
              <SettingRow label="Instruction key" description="The key you press while text is selected">
                <span className="kbd-3d">Caps Lock</span>
              </SettingRow>
            )}

            {/* Custom LLM model id — escape hatch for any model the endpoint serves. */}
            <SettingRow label="Custom model" description="Override the dropdown with any model id">
              <input
                className="mv-input !w-[200px]"
                placeholder="e.g. gpt-4.1"
                value={llmSettings.model}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => updateLlm({ model: e.target.value })}
              />
            </SettingRow>

            {/* Custom OpenAI-compatible base URL (blank = provider default). */}
            <SettingRow label="Custom API base URL" description="Point at any OpenAI-compatible endpoint">
              <input
                className="mv-input !w-[200px]"
                placeholder="provider default"
                value={llmSettings.baseUrl}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => updateLlm({ baseUrl: e.target.value })}
              />
            </SettingRow>

            {/* Output mode */}
            <SettingRow label="Output mode" description="How the result is delivered">
              <Segmented
                options={[
                  { value: 'paste', label: 'Paste at cursor' },
                  { value: 'clipboard', label: 'Clipboard' }
                ]}
                value={outputMode}
                onChange={(v) => handleOutputModeChange(v as 'paste' | 'clipboard')}
              />
            </SettingRow>

            {/* Chunked transcription */}
            <SettingRow
              label="Chunked transcription"
              description="Stream long recordings in VAD-split chunks"
            >
              <Toggle checked={chunkedTranscription} onChange={handleChunkedChange} />
            </SettingRow>

            {/* STT model (advanced — most users keep the default) */}
            <SettingRow label="Transcription model" description="Groq Whisper variant for speech-to-text" last={!IS_MAC}>
              <select className="mv-select min-w-[200px]" value={sttSettings.model} onChange={(e) => updateStt({ model: e.target.value })}>
                {sttModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {!sttModels.some((m) => m.id === sttSettings.model) && (
                  <option value={sttSettings.model}>{sttSettings.model}</option>
                )}
              </select>
            </SettingRow>

            {/* Permissions (macOS) */}
            {IS_MAC && (
              <>
                <PermissionRow
                  title="Microphone"
                  description="Required so Maverick Voice can hear what you say."
                  granted={micGranted}
                  statusText={
                    micGranted ? 'Granted' : micStatus === 'denied' || micStatus === 'restricted' ? 'Denied' : 'Not granted'
                  }
                  primary={!micGranted ? { label: 'Grant', onClick: handleGrantMic } : null}
                  secondary={
                    micStatus === 'denied' || micStatus === 'restricted'
                      ? { label: 'Open Settings', onClick: () => window.electronAPI.openMicSettings() }
                      : null
                  }
                />
                <PermissionRow
                  title="Accessibility"
                  description="Required to detect shortcut keys and paste at the cursor."
                  granted={accessibilityGranted}
                  statusText={accessibilityGranted ? 'Granted' : 'Not granted'}
                  primary={!accessibilityGranted ? { label: 'Grant', onClick: handleGrantAccessibility } : null}
                  secondary={
                    !accessibilityGranted ? { label: "I've enabled it", onClick: refreshPermissions } : null
                  }
                />
                <div className="px-5 py-4 border-t border-mv-border">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <p className="text-[13px] font-semibold text-mv-text-primary">Free up the Fn key</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-mv-text-muted">Recommended</span>
                  </div>
                  <p className="text-[12px] text-mv-text-secondary leading-relaxed">
                    macOS uses <span className="font-mono text-mv-text-primary">Fn</span> for emoji / Apple Dictation. To use it
                    for Maverick Voice, set <span className="font-semibold text-mv-text-primary">"Press 🌐 key to" → "Do Nothing"</span>.
                  </p>
                  <button onClick={() => window.electronAPI.openKeyboardSettings()} className="btn-glass !px-3.5 !py-2 !text-[11px] mt-3">
                    Open Keyboard Settings
                  </button>
                </div>
              </>
            )}

            {/* Replay onboarding */}
            <SettingRow label="Replay onboarding" description="Walk through the welcome and setup steps again" last>
              <button
                onClick={() => {
                  localStorage.removeItem('maverickvoice_onboarding_complete')
                  location.reload()
                }}
                className="btn-glass !px-4 !py-2 !text-[12px]"
              >
                Replay
              </button>
            </SettingRow>
          </div>
        )}
      </div>

      {/* ═══ Privacy footer ═══ */}
      <div className="mt-8 px-1 pb-2">
        <div className="mv-section-label mb-2">
          <span className="text-mv-text-muted">
            <ShieldIcon />
          </span>
          Privacy
        </div>
        <p className="text-[12px] text-mv-text-secondary leading-relaxed max-w-[560px]">
          Maverick Voice is local-first and account-free. Your transcripts, history, and audio stay on your device. Your API
          keys are encrypted via Electron safeStorage (Keychain on macOS, DPAPI on Windows). Audio is sent only to the
          provider you configured — Groq for speech-to-text, OpenAI or OpenRouter for AI. There is no sign-up, no telemetry,
          and no tracking; usage costs are estimated locally from public provider pricing.
        </p>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Compact per-provider API key row — masked status, set / test / clear.
════════════════════════════════════════════════════════════════════════ */
function ProviderKeyRow({
  provider,
  label,
  sublabel,
  tag,
  placeholder,
  consoleUrl,
  last
}: {
  provider: ProviderId
  label: string
  sublabel?: string
  tag?: string
  placeholder: string
  consoleUrl: string
  last?: boolean
}) {
  const [masked, setMasked] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  useEffect(() => {
    window.electronAPI
      .getProviderKeyStatus(provider)
      .then((s) => setMasked(s.hasKey ? s.masked : null))
      .catch(() => {})
  }, [provider])

  async function handleSave() {
    const key = input.trim()
    if (!key || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const test = await window.electronAPI.testProviderKey(provider, key)
      if (!test.ok) {
        setMsg({ text: test.error || 'Invalid key', type: 'err' })
        return
      }
      const res = await window.electronAPI.setProviderKey(provider, key)
      if (res.success) {
        setMasked(res.masked ?? null)
        setInput('')
        setEditing(false)
        setMsg({ text: 'Key saved securely.', type: 'ok' })
      } else {
        setMsg({ text: res.error || 'Failed to save key', type: 'err' })
      }
    } catch {
      setMsg({ text: 'Something went wrong', type: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    const key = input.trim() || ''
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      // Test the typed key if present, otherwise the stored key (sent as '' →
      // main routes to the stored key for that provider).
      const res = await window.electronAPI.testProviderKey(provider, key)
      setMsg(res.ok ? { text: 'Key is valid.', type: 'ok' } : { text: res.error || 'Key failed', type: 'err' })
    } catch {
      setMsg({ text: 'Could not reach provider', type: 'err' })
    } finally {
      setBusy(false)
    }
  }

  function handleClear() {
    window.electronAPI.clearProviderKey(provider)
    setMasked(null)
    setInput('')
    setEditing(false)
    setMsg(null)
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Provider brand icon (lobehub, mono — forced grayscale to honor the
              strict B&W system). A tiny status dot badges the saved state. */}
          <span className="relative flex items-center justify-center w-8 h-8 rounded-mv-md bg-mv-white-04 border border-mv-border text-mv-text-primary shrink-0 [&_svg]:grayscale">
            <ProviderGlyph provider={provider} />
            <span className={`absolute -top-0.5 -right-0.5 mv-status-dot ${masked ? 'mv-status-dot--on' : 'mv-status-dot--off'}`} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-mv-text-primary">{label}</span>
              {tag && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-mv-text-muted bg-mv-white-04 border border-mv-border rounded-mv-sm px-1.5 py-0.5 shrink-0">
                  {tag}
                </span>
              )}
            </div>
            <p className="text-[11px] text-mv-text-muted font-mono truncate mt-0.5">{masked || sublabel || 'Not set'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!editing && (
            <button
              onClick={() => {
                setEditing(true)
                setMsg(null)
              }}
              className="btn-glass !px-3 !py-1.5 !text-[11px] whitespace-nowrap"
            >
              {masked ? 'Replace' : 'Set'}
            </button>
          )}
          {!editing && masked && (
            <>
              <button onClick={handleTest} disabled={busy} className="btn-glass !px-3 !py-1.5 !text-[11px] whitespace-nowrap">
                Test
              </button>
              <button
                onClick={handleClear}
                className="text-[11px] font-medium text-mv-text-secondary hover:text-mv-text-primary transition-colors px-2 py-1"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setMsg(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') {
                setEditing(false)
                setInput('')
                setMsg(null)
              }
            }}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            className="mv-input flex-1"
          />
          <button onClick={handleTest} disabled={busy} className="btn-glass !px-3.5 !py-2.5 !text-[12px] whitespace-nowrap">
            Test
          </button>
          <button onClick={handleSave} disabled={!input.trim() || busy} className="btn-glass btn-glass--primary !px-4 !py-2.5 !text-[12px] whitespace-nowrap">
            {busy ? 'Checking…' : 'Save'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mt-2.5 gap-3">
        <button
          onClick={() => window.electronAPI.openExternal(consoleUrl)}
          className="text-[11px] text-mv-text-muted hover:text-mv-text-primary transition-colors underline underline-offset-2"
        >
          Get an API key →
        </button>
        {msg && (
          <span className={`text-[11px] font-medium ${msg.type === 'ok' ? 'text-mv-text-primary' : 'text-mv-text-secondary'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── Layout primitives ─── */

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <div className="mv-section-label mb-2.5 mt-6">
        <span className="text-mv-text-muted">{icon}</span>
        {title}
      </div>
      <div className="mv-glass-card overflow-hidden mb-3">{children}</div>
    </>
  )
}

function Divider() {
  return <div className="h-px bg-mv-border" />
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="mv-stat-pill">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-mv-text-muted">{label}</span>
      <span className="font-display text-[20px] font-extrabold text-mv-text-primary tabular-nums tracking-tight mt-1">
        {value}
      </span>
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
  last
}: {
  label: string
  description: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 gap-4 ${last ? '' : 'border-b border-mv-border'}`}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-mv-text-primary">{label}</p>
        {description && <p className="text-[11px] text-mv-text-muted mt-0.5 leading-snug">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange
}: {
  options: { value: string; label: string; icon?: React.ReactNode }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="mv-segment">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`mv-segment__btn ${value === opt.value ? 'mv-segment__btn--active' : ''}`}
        >
          {opt.icon && <span className="mv-segment__icon [&_svg]:grayscale">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`mv-toggle ${checked ? 'mv-toggle--on' : ''} ${disabled ? 'mv-toggle--disabled' : ''}`}
      aria-pressed={checked}
    >
      <span className="mv-toggle__knob" />
    </button>
  )
}

function PermissionRow({
  title,
  description,
  granted,
  statusText,
  primary,
  secondary
}: {
  title: string
  description: string
  granted: boolean
  statusText: string
  primary: { label: string; onClick: () => void } | null
  secondary: { label: string; onClick: () => void } | null
}) {
  return (
    <div className="px-5 py-4 flex items-start gap-3 border-t border-mv-border">
      <div className={`w-8 h-8 rounded-mv-md flex items-center justify-center shrink-0 mt-0.5 border ${granted ? 'bg-mv-white-12 border-mv-border-focus text-mv-text-primary' : 'bg-mv-white-04 border-mv-border text-mv-text-muted'}`}>
        {granted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-mv-text-primary">{title}</p>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${granted ? 'text-mv-text-primary' : 'text-mv-text-muted'}`}>{statusText}</span>
        </div>
        <p className="text-[12px] text-mv-text-secondary leading-relaxed mt-1.5">{description}</p>
        {(primary || secondary) && (
          <div className="flex items-center gap-2 mt-3">
            {primary && (
              <button onClick={primary.onClick} className="btn-glass btn-glass--primary !px-3.5 !py-1.5 !text-[11px]">
                {primary.label}
              </button>
            )}
            {secondary && (
              <button onClick={secondary.onClick} className="btn-glass !px-3.5 !py-1.5 !text-[11px]">
                {secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Icons ─── */

function MicIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2a2.5 2.5 0 0 1 0 5M5.5 2a5 5 0 0 0 0 5M8 7v6M5 13h6" />
    </svg>
  )
}

function WandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5V1.5M10 11v-1M6 6h1.5M13 6h1M11.8 7.8L12.5 8.5M11.8 4.2L12.5 3.5M2 14l6-6M8.2 4.2L7.5 3.5" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14.5s5.5-2.5 5.5-7V3.5L8 1.5 2.5 3.5V7.5c0 4.5 5.5 7 5.5 7z" />
      <polyline points="5.5 8 7 9.5 10.5 6" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2.5" y1="5" x2="13.5" y2="5" />
      <line x1="2.5" y1="11" x2="13.5" y2="11" />
      <circle cx="6" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CogIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="11" r="3" />
      <path d="M7.1 8.9 13.5 2.5M11 5l1.5 1.5M9.5 6.5 11 8" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  )
}
