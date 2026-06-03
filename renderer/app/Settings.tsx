import { useState, useEffect, useCallback } from 'react'
import type {
  DictationKey,
  ActivationMode,
  STTSettings,
  LLMSettings,
  STTProviderId,
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
  const [instructionEnabled, setInstructionEnabled] = useState(false)

  // ── Key bindings ──
  const [dictationKey, setDictationKey] = useState<DictationKey>(IS_MAC ? 'fn' : 'right-ctrl')
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
    window.electronAPI.getInstructionEnabled().then(setInstructionEnabled).catch(() => {})
    window.electronAPI
      .getOutputMode()
      .then((v) => {
        if (v === 'paste' || v === 'clipboard') setOutputMode(v)
      })
      .catch(() => {})
    window.electronAPI.getDictationKey().then((v) => {
      if (['fn', 'right-option', 'right-ctrl', 'right-alt'].includes(v)) setDictationKey(v)
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

  // ── AI handlers ──
  function handleAutoFormatChange(value: boolean) {
    setAutoFormat(value)
    window.electronAPI.setAutoFormat(value)
  }

  function handleInstructionEnabledChange(value: boolean) {
    setInstructionEnabled(value)
    window.electronAPI.setInstructionEnabled(value)
  }

  // ── Key binding handlers ──
  function handleDictationKeyChange(value: string) {
    const key = value as DictationKey
    setDictationKey(key)
    window.electronAPI.setDictationKey(key)
    onDictationKeyChange?.(key)
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

  const llmModels = llmSettings.provider === 'openai' ? openaiModels : openrouterModels
  const activationBlurb = ACTIVATION_MODES.find((a) => a.value === activationMode)?.blurb

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
        <SettingRow label="Dictation key" description="The key you press to start dictating">
          <Segmented options={DICTATION_KEY_OPTIONS} value={dictationKey} onChange={handleDictationKeyChange} />
        </SettingRow>
        <SettingRow label="Activation mode" description={activationBlurb || ''}>
          <Segmented options={ACTIVATION_MODES} value={activationMode} onChange={handleActivationModeChange} />
        </SettingRow>
        <SettingRow label="Language" description="Speech recognition language hint" last>
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
        </SettingRow>
      </Section>

      {/* ═══ AI ═══ */}
      <Section title="AI" icon={<WandIcon />}>
        <SettingRow
          label="AI auto-format"
          description="Clean up grammar, punctuation, and paragraphing of your dictation — meaning untouched."
        >
          <Toggle checked={autoFormat} onChange={handleAutoFormatChange} />
        </SettingRow>

        {/* LLM provider + model (always visible) */}
        <div className="px-5 py-4 border-b border-mv-border">
          <FieldRow label="LLM provider" hint="Used for auto-format and instruction edits.">
            <Segmented
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'openrouter', label: 'OpenRouter' }
              ]}
              value={llmSettings.provider}
              onChange={(v) => handleLlmProviderChange(v as LLMProviderId)}
            />
          </FieldRow>
          <FieldRow label="Model">
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
          </FieldRow>
          <FieldRow label="Custom model" hint="Type any model id this endpoint serves." last>
            <input
              className="mv-input !w-[200px]"
              placeholder="e.g. gpt-4.1"
              value={llmSettings.model}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => updateLlm({ model: e.target.value })}
            />
          </FieldRow>
        </div>

        {/* API keys — Groq required for dictation; OpenAI/OpenRouter for AI. */}
        <ProviderKeyRow
          provider="groq"
          label="Groq"
          tag="Required for dictation"
          placeholder="gsk_..."
          consoleUrl="https://console.groq.com/keys"
        />
        <Divider />
        <ProviderKeyRow provider="openai" label="OpenAI" placeholder="sk-..." consoleUrl="https://platform.openai.com/api-keys" />
        <Divider />
        <ProviderKeyRow
          provider="openrouter"
          label="OpenRouter"
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
              Edit-with-voice, output mode, transcription, permissions
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
              description="Stream long recordings to the model in VAD-split chunks"
              last={!IS_MAC}
            >
              <Toggle checked={chunkedTranscription} onChange={handleChunkedChange} />
            </SettingRow>

            {/* STT model (advanced — most users keep the default) */}
            <SettingRow label="Transcription model" description="Groq Whisper variant used for speech-to-text" last={!IS_MAC}>
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
  tag,
  placeholder,
  consoleUrl,
  last
}: {
  provider: ProviderId
  label: string
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
    <div className={`px-5 py-4 ${last ? '' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`mv-status-dot ${masked ? 'mv-status-dot--on' : 'mv-status-dot--off'}`} />
          <span className="text-[13px] font-semibold text-mv-text-primary shrink-0">{label}</span>
          {tag && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-mv-text-muted bg-mv-white-04 border border-mv-border rounded-mv-sm px-1.5 py-0.5 shrink-0">
              {tag}
            </span>
          )}
          <span className="text-[12px] text-mv-text-muted font-mono truncate">{masked || 'Not set'}</span>
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
        {hint && <p className="text-[10.5px] text-mv-text-muted mt-0.5 max-w-[240px] leading-snug">{hint}</p>}
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

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  )
}
