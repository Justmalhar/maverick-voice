import { useState, useEffect, useCallback } from 'react'
import type {
  DictationKey,
  InstructionKey,
  ActivationMode,
  STTSettings,
  LLMSettings,
  STTProviderId,
  LLMProviderId,
  ProviderId,
  ProviderModel
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

// Static language options for the Groq STT card.
const STT_LANGUAGES: { value: STTSettings['language']; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'ar', label: 'Arabic' }
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

// Instruction key choices — Right Shift on both platforms; Caps Lock extra on
// macOS (LED-toggle semantics handled in keyListener).
const INSTRUCTION_KEY_OPTIONS: { value: InstructionKey; label: string }[] = IS_MAC
  ? [
      { value: 'right-shift', label: 'Right Shift' },
      { value: 'caps-lock', label: 'Caps Lock' }
    ]
  : [{ value: 'right-shift', label: 'Right Shift' }]

const ACTIVATION_MODES: { value: ActivationMode; label: string; blurb: string }[] = [
  { value: 'tap-toggle', label: 'Tap toggle', blurb: 'Tap once to start, tap again to stop.' },
  { value: 'push-to-talk', label: 'Push to talk', blurb: 'Hold the key to record, release to submit.' },
  { value: 'double-tap-push', label: 'Dual mode', blurb: 'Double-tap for hands-free, or hold for push-to-talk.' }
]

export default function Settings({ onDictationKeyChange }: SettingsProps = {}) {
  // ── Audio ──
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')

  // ── Behaviour / appearance ──
  const [outputMode, setOutputMode] = useState<'paste' | 'clipboard'>('paste')
  const [soundFeedback, setSoundFeedback] = useState(true)
  const [chunkedTranscription, setChunkedTranscription] = useState(true)
  const [widgetPosition, setWidgetPosition] = useState<'center' | 'right'>('center')

  // ── Key bindings ──
  const [dictationKey, setDictationKey] = useState<DictationKey>(IS_MAC ? 'fn' : 'right-ctrl')
  const [instructionKey, setInstructionKey] = useState<InstructionKey>('right-shift')
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
    window.electronAPI
      .getOutputMode()
      .then((v) => {
        if (v === 'paste' || v === 'clipboard') setOutputMode(v)
      })
      .catch(() => {})
    window.electronAPI.getDictationKey().then((v) => {
      if (['fn', 'right-option', 'right-ctrl', 'right-alt'].includes(v)) setDictationKey(v)
    })
    window.electronAPI.getInstructionKey().then((v) => {
      if (v === 'right-shift' || v === 'caps-lock') setInstructionKey(v)
    })
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

  // ── Key binding handlers ──
  function handleDictationKeyChange(value: string) {
    const key = value as DictationKey
    setDictationKey(key)
    window.electronAPI.setDictationKey(key)
    onDictationKeyChange?.(key)
  }

  function handleInstructionKeyChange(value: string) {
    const key = value as InstructionKey
    setInstructionKey(key)
    window.electronAPI.setInstructionKey(key)
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
    const models = provider === 'openai' ? openaiModels : openrouterModels
    const model = models[0]?.id || llmSettings.model
    updateLlm({ provider, model })
  }

  return (
    <div>
      <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight mb-7">Settings</h2>

      {/* ═══ Permissions (macOS only) ═══ */}
      {IS_MAC && (
        <Section title="Permissions" icon={<ShieldIcon />}>
          <PermissionRow
            title="Microphone"
            description="So Maverick Voice can hear what you say. Required."
            granted={micGranted}
            statusText={micGranted ? 'Granted' : micStatus === 'denied' || micStatus === 'restricted' ? 'Denied' : 'Not granted'}
            primary={!micGranted ? { label: 'Grant', onClick: handleGrantMic } : null}
            secondary={micStatus === 'denied' || micStatus === 'restricted' ? { label: 'Open Settings', onClick: () => window.electronAPI.openMicSettings() } : null}
          />
          <Divider />
          <PermissionRow
            title="Accessibility"
            description="Lets Maverick Voice detect your shortcut keys and paste at the cursor. Required."
            granted={accessibilityGranted}
            statusText={accessibilityGranted ? 'Granted' : 'Not granted'}
            primary={!accessibilityGranted ? { label: 'Grant', onClick: handleGrantAccessibility } : null}
            secondary={!accessibilityGranted ? { label: "I've enabled it", onClick: refreshPermissions } : null}
          />
          <Divider />
          <div className="px-5 py-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-[13px] font-semibold text-mv-text-primary">Free up the Fn key</p>
              <span className="text-[10px] font-bold uppercase tracking-wider text-mv-text-muted">Recommended</span>
            </div>
            <p className="text-[12px] text-mv-text-secondary leading-relaxed">
              macOS uses <span className="font-mono text-mv-text-primary">Fn</span> for emoji / Apple Dictation. To use it for
              Maverick Voice, open Keyboard Settings and set{' '}
              <span className="font-semibold text-mv-text-primary">"Press 🌐 key to" → "Do Nothing"</span>.
            </p>
            <button onClick={() => window.electronAPI.openKeyboardSettings()} className="btn-glass !px-3.5 !py-2 !text-[11px] mt-3">
              Open Keyboard Settings
            </button>
          </div>
        </Section>
      )}

      {/* ═══ Speech-to-text (Groq) ═══ */}
      <Section title="Speech-to-text" icon={<MicIcon />}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[13px] font-semibold text-mv-text-primary">Transcription provider</p>
              <p className="text-[11px] text-mv-text-muted mt-0.5">Converts your speech to text.</p>
            </div>
            <Segmented
              options={[{ value: 'groq', label: 'Groq' }]}
              value={sttSettings.provider}
              onChange={(v) => updateStt({ provider: v as STTProviderId })}
            />
          </div>
          <FieldRow label="Model">
            <select className="mv-select min-w-[200px]" value={sttSettings.model} onChange={(e) => updateStt({ model: e.target.value })}>
              {sttModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {/* keep current model selectable even if listModels hasn't resolved */}
              {!sttModels.some((m) => m.id === sttSettings.model) && (
                <option value={sttSettings.model}>{sttSettings.model}</option>
              )}
            </select>
          </FieldRow>
          <FieldRow label="Language" last>
            <select
              className="mv-select min-w-[160px]"
              value={sttSettings.language}
              onChange={(e) => updateStt({ language: e.target.value as STTSettings['language'] })}
            >
              {STT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>
        <Divider />
        <ProviderKeyCard provider="groq" label="Groq" placeholder="gsk_..." consoleUrl="https://console.groq.com/keys" />
      </Section>

      {/* ═══ AI transforms (OpenAI + OpenRouter) ═══ */}
      <Section title="AI transforms" icon={<WandIcon />}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[13px] font-semibold text-mv-text-primary">LLM provider</p>
              <p className="text-[11px] text-mv-text-muted mt-0.5">Rewrites selected text from your voice instruction.</p>
            </div>
            <Segmented
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'openrouter', label: 'OpenRouter' }
              ]}
              value={llmSettings.provider}
              onChange={(v) => handleLlmProviderChange(v as LLMProviderId)}
            />
          </div>
          <FieldRow label="Model">
            <select className="mv-select min-w-[220px]" value={llmSettings.model} onChange={(e) => updateLlm({ model: e.target.value })}>
              {(llmSettings.provider === 'openai' ? openaiModels : openrouterModels).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {/* allow a custom model id (escape hatch) to remain selected */}
              {!(llmSettings.provider === 'openai' ? openaiModels : openrouterModels).some((m) => m.id === llmSettings.model) && (
                <option value={llmSettings.model}>{llmSettings.model} (custom)</option>
              )}
            </select>
          </FieldRow>
          <FieldRow label="Custom model" hint="Type any model id this endpoint serves.">
            <input
              className="mv-input !w-[220px]"
              placeholder="e.g. gpt-4.1"
              value={llmSettings.model}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => updateLlm({ model: e.target.value })}
            />
          </FieldRow>
          <FieldRow label="Base URL" hint="Empty = provider default. Point at any OpenAI-compatible endpoint." last>
            <input
              className="mv-input !w-[260px]"
              placeholder={llmSettings.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1'}
              value={llmSettings.baseUrl}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => updateLlm({ baseUrl: e.target.value })}
            />
          </FieldRow>
        </div>
        <Divider />
        <ProviderKeyCard provider="openai" label="OpenAI" placeholder="sk-..." consoleUrl="https://platform.openai.com/api-keys" />
        <Divider />
        <ProviderKeyCard provider="openrouter" label="OpenRouter" placeholder="sk-or-..." consoleUrl="https://openrouter.ai/keys" />
      </Section>

      {/* ═══ Keyboard shortcuts (dark hero) ═══ */}
      <div className="mv-glass-card overflow-hidden mb-3 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_12%,rgba(255,255,255,0.05)_0%,transparent_55%)] pointer-events-none" />
        <div className="px-6 pt-5">
          <div className="text-[9px] font-bold tracking-[0.12em] uppercase text-mv-text-muted mb-1">Keyboard Shortcuts</div>
          <div className="font-display text-[18px] font-extrabold tracking-tight text-mv-text-primary">Your triggers</div>
        </div>
        <div className="p-5 pt-4 flex flex-col gap-2.5">
          {/* Dictation */}
          <div className="px-4 py-3.5 bg-mv-white-04 border border-mv-border rounded-mv-md">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[13px] font-semibold text-mv-text-primary mb-0.5">Dictation trigger</h4>
                <p className="text-[11px] text-mv-text-muted">{ACTIVATION_MODES.find((a) => a.value === activationMode)?.blurb}</p>
              </div>
              <kbd className="kbd-3d">{DICTATION_KEY_OPTIONS.find((o) => o.value === dictationKey)?.label || dictationKey}</kbd>
            </div>
            <div className="mt-3.5 flex items-center justify-between">
              <span className="text-[11px] text-mv-text-secondary">Dictation key</span>
              <Segmented options={DICTATION_KEY_OPTIONS} value={dictationKey} onChange={handleDictationKeyChange} />
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[11px] text-mv-text-secondary">Activation mode</span>
              <Segmented options={ACTIVATION_MODES} value={activationMode} onChange={handleActivationModeChange} />
            </div>
          </div>

          {/* Instruction */}
          <div className="px-4 py-3.5 bg-mv-white-04 border border-mv-border rounded-mv-md">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[13px] font-semibold text-mv-text-primary mb-0.5">Instruction trigger</h4>
                <p className="text-[11px] text-mv-text-muted">Select text, tap the key, speak an instruction.</p>
              </div>
              <kbd className="kbd-3d">{INSTRUCTION_KEY_OPTIONS.find((o) => o.value === instructionKey)?.label || instructionKey}</kbd>
            </div>
            <div className="mt-3.5 flex items-center justify-between">
              <span className="text-[11px] text-mv-text-secondary">Instruction key</span>
              <Segmented options={INSTRUCTION_KEY_OPTIONS} value={instructionKey} onChange={handleInstructionKeyChange} />
            </div>
            {IS_MAC && instructionKey === 'right-shift' && (
              <p className="text-[10.5px] text-mv-text-muted leading-relaxed mt-3 px-3 py-2 rounded-mv-sm bg-mv-white-04 border border-mv-border">
                Native Right Shift on macOS needs the optional Swift recompile. Until then it falls back to Caps Lock.
              </p>
            )}
          </div>

          {/* Activation-mode explainer cards */}
          <div className="grid grid-cols-3 gap-2 mt-1">
            {ACTIVATION_MODES.map((m) => (
              <div
                key={m.value}
                className={`px-3 py-2.5 rounded-mv-md border transition-colors ${
                  activationMode === m.value
                    ? 'bg-mv-white-08 border-mv-border-focus'
                    : 'bg-mv-white-04 border-mv-border'
                }`}
              >
                <p className="text-[11px] font-semibold text-mv-text-primary mb-0.5">{m.label}</p>
                <p className="text-[10px] text-mv-text-muted leading-snug">{m.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Audio ═══ */}
      <Section title="Audio" icon={<MicIcon />}>
        <SettingRow label="Microphone" description="Select your input device" last>
          <select className="mv-select min-w-[200px]" value={selectedDevice} onChange={(e) => handleInputDeviceChange(e.target.value)}>
            {audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </Section>

      {/* ═══ Behavior ═══ */}
      <Section title="Behavior" icon={<BehaviorIcon />}>
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
        <SettingRow label="Sound feedback" description="Play sounds on start / stop">
          <Toggle checked={soundFeedback} onChange={handleSoundFeedbackChange} />
        </SettingRow>
        <SettingRow
          label="Chunked transcription"
          description="Stream long recordings to the model in VAD-split chunks"
          last
        >
          <Toggle checked={chunkedTranscription} onChange={handleChunkedChange} />
        </SettingRow>
      </Section>

      {/* ═══ Appearance ═══ */}
      <Section title="Appearance" icon={<AppearanceIcon />}>
        <SettingRow label="Widget position" description="Where the HUD pill appears on screen" last>
          <Segmented
            options={[
              { value: 'center', label: 'Top center' },
              { value: 'right', label: 'Top right' }
            ]}
            value={widgetPosition}
            onChange={handleWidgetPositionChange}
          />
        </SettingRow>
      </Section>

      {/* ═══ Help ═══ */}
      <Section title="Help" icon={<HelpIcon />}>
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
      </Section>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Per-provider API key card — masked status, set / test / clear.
════════════════════════════════════════════════════════════════════════ */
function ProviderKeyCard({
  provider,
  label,
  placeholder,
  consoleUrl
}: {
  provider: ProviderId
  label: string
  placeholder: string
  consoleUrl: string
}) {
  const [masked, setMasked] = useState<string | null>(null)
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
    setMsg(null)
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`mv-status-dot ${masked ? 'mv-status-dot--on' : 'mv-status-dot--off'}`} />
          <span className="text-[13px] font-semibold text-mv-text-primary">{label} API key</span>
          {masked && <span className="text-[12px] text-mv-text-muted font-mono">{masked}</span>}
        </div>
        {masked && (
          <button onClick={handleClear} className="text-[12px] font-medium text-mv-text-secondary hover:text-mv-text-primary transition-colors px-2 py-1">
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="password"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setMsg(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
          }}
          placeholder={masked ? 'Paste a new key to replace' : placeholder}
          spellCheck={false}
          autoComplete="off"
          className="mv-input flex-1"
        />
        <button onClick={handleTest} disabled={busy} className="btn-glass !px-3.5 !py-2.5 !text-[12px] whitespace-nowrap">
          Test
        </button>
        <button onClick={handleSave} disabled={!input.trim() || busy} className="btn-glass btn-glass--primary !px-4 !py-2.5 !text-[12px] whitespace-nowrap">
          {busy ? 'Checking…' : 'Save'}
        </button>
      </div>

      <div className="flex items-center justify-between mt-2.5">
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
        <p className="text-[11px] text-mv-text-muted mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Inline field row inside a card body (no card-edge divider). */
function FieldRow({
  label,
  hint,
  children,
  last
}: {
  label: string
  hint?: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-4 py-2.5 ${last ? '' : 'border-b border-mv-white-04'}`}>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-mv-text-secondary">{label}</p>
        {hint && <p className="text-[10.5px] text-mv-text-muted mt-0.5 max-w-[220px] leading-snug">{hint}</p>}
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
  options: { value: string; label: string }[]
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
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className={`mv-toggle ${checked ? 'mv-toggle--on' : ''}`} aria-pressed={checked}>
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
    <div className="px-5 py-4 flex items-start gap-3">
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

function BehaviorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" />
      <path d="M8 5v4l2 2" />
    </svg>
  )
}

function AppearanceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3V1M8 15v-2M3 8H1M15 8h-2" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6 6a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.3" />
      <line x1="8" y1="11.5" x2="8.01" y2="11.5" />
    </svg>
  )
}
