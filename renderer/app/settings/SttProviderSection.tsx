import type { ReactNode } from 'react'
import type { STTProviderId } from '../../../shared/types'
import { KeyCard, LANGUAGES } from '../../ui'
import { useSettings } from '../settingsContext'
import { LabeledSelect, SectionCard, useProviderKey } from './shared'

interface SttProviderMeta {
  id: STTProviderId
  label: string
  placeholder: string
  consoleUrl: string
  /** Fixed model list — mirrors the backend provider's `models`. The first
   *  entry is the default applied when switching providers. */
  models: { value: string; label: string }[]
}

// ponytail: the 'local' STT provider exists in the backend registry but is
// hidden here — local models get their own UI/logic later.
const STT_PROVIDERS: SttProviderMeta[] = [
  {
    id: 'deepgram',
    label: 'Deepgram',
    placeholder: 'Deepgram API key',
    consoleUrl: 'https://console.deepgram.com',
    models: [
      { value: 'nova-3', label: 'Nova 3' },
      { value: 'nova-2', label: 'Nova 2' }
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
    models: [
      { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe' },
      { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
      { value: 'whisper-1', label: 'Whisper' }
    ]
  },
  {
    id: 'groq',
    label: 'Groq',
    placeholder: 'gsk_...',
    consoleUrl: 'https://console.groq.com/keys',
    models: [
      { value: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo' },
      { value: 'whisper-large-v3', label: 'Whisper Large v3' }
    ]
  }
]

/**
 * Speech-to-text engine: pick ONE active provider; only its key card and
 * model config are shown (the old section stacked every provider at once).
 * Keys persist per provider — switching never loses a saved key.
 */
export default function SttProviderSection(): ReactNode {
  const { settings, update } = useSettings()
  const active = settings?.sttSettings.provider ?? 'groq'
  // Hidden providers (local) fall back to Groq for display + key wiring.
  const meta = STT_PROVIDERS.find((p) => p.id === active) ?? STT_PROVIDERS[2]
  const keyVault = useProviderKey(meta.id)

  if (!settings) return null
  const stt = settings.sttSettings
  // A stale/foreign stored model snaps to the provider's default.
  const model = meta.models.some((m) => m.value === stt.model) ? stt.model : meta.models[0].value

  function switchProvider(provider: STTProviderId): void {
    const next = STT_PROVIDERS.find((p) => p.id === provider)!
    update({ sttSettings: { ...stt, provider, model: next.models[0].value } })
  }

  return (
    <SectionCard title="Speech to text" id="stt-provider">
      <div className="flex flex-col gap-3 p-3">
        <div className="glass-card flex items-center justify-between gap-4 px-4 py-3">
          <p className="text-[12px] font-semibold text-ink-strong">Provider</p>
          <div className="w-48 shrink-0">
            <select
              aria-label="Speech-to-text provider"
              value={meta.id}
              onChange={(e) => switchProvider(e.target.value as STTProviderId)}
              className="ui-input"
            >
              {STT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <KeyCard
          provider={active}
          title="API key"
          description="Encrypted and stored on this device"
          placeholder={meta.placeholder}
          status={keyVault.status}
          onSave={keyVault.save}
          onTest={keyVault.test}
          onClear={keyVault.clear}
          extra={
            <button
              type="button"
              onClick={() => window.electronAPI.openExternal(meta.consoleUrl)}
              className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Get an API key →
            </button>
          }
        />

        <div className="glass-card flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <LabeledSelect
            label="Model"
            value={model}
            onChange={(m) => update({ sttSettings: { ...stt, model: m } })}
            options={meta.models}
          />
          <LabeledSelect
            label="Language"
            value={stt.language}
            onChange={(language) => update({ sttSettings: { ...stt, language } })}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          />
        </div>
      </div>
    </SectionCard>
  )
}
