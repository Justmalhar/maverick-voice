import { useEffect, useState, type ReactNode } from 'react'
import type { LLMProviderId, ProviderModel } from '../../../shared/types'
import { KeyCard } from '../../ui'
import { useSettings } from '../settingsContext'
import { LabeledField, LabeledSelect, SectionCard, useProviderKey } from './shared'

interface LlmProviderMeta {
  id: LLMProviderId
  label: string
  placeholder: string
  consoleUrl?: string
  /** Mirrors the provider's defaultModel — applied when switching. */
  defaultModel: string
  custom?: boolean
}

const LLM_PROVIDERS: LlmProviderMeta[] = [
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-...', consoleUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-4o-mini' },
  { id: 'groq', label: 'Groq', placeholder: 'gsk_...', consoleUrl: 'https://console.groq.com/keys', defaultModel: 'llama-3.3-70b-versatile' },
  { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...', consoleUrl: 'https://openrouter.ai/keys', defaultModel: 'openai/gpt-4o-mini' },
  { id: 'custom', label: 'Custom', placeholder: 'API key', defaultModel: '', custom: true }
]

/**
 * AI model (LLM): pick ONE active provider; only its key card and model
 * config are shown. Custom takes a base URL + free-text model name — the
 * base URL applies to the ACTIVE provider only, so it resets on switch.
 */
export default function LlmProviderSection(): ReactNode {
  const { settings, update } = useSettings()
  const active = settings?.llmSettings.provider ?? 'openai'
  const meta = LLM_PROVIDERS.find((p) => p.id === active) ?? LLM_PROVIDERS[0]
  const keyVault = useProviderKey(active)
  const [models, setModels] = useState<ProviderModel[]>([])

  // Clear immediately on provider switch (never show another provider's
  // catalog); keep the current list while a key save triggers a refetch.
  useEffect(() => setModels([]), [active])

  // Refetch on provider switch AND when a key is saved/cleared — the live
  // /models catalog needs the key. hasKey is the cheap change signal.
  const hasKey = keyVault.status?.hasKey ?? false
  useEffect(() => {
    let stale = false
    window.electronAPI
      .listModels(active, 'llm')
      .then((m) => {
        if (!stale) setModels(m)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [active, hasKey])

  if (!settings) return null
  const llm = settings.llmSettings

  function switchProvider(provider: LLMProviderId): void {
    const next = LLM_PROVIDERS.find((p) => p.id === provider)!
    // baseUrl is an override for the ACTIVE provider — carrying a custom
    // endpoint over to OpenAI/Groq/OpenRouter would silently hijack them.
    update({ llmSettings: { provider, model: next.defaultModel, baseUrl: '' } })
  }

  return (
    <SectionCard title="AI model" id="llm-provider">
      <div className="flex flex-col gap-3 p-3">
        <div className="glass-card flex items-center justify-between gap-4 px-4 py-3">
          <p className="text-[12px] font-semibold text-ink-strong">Provider</p>
          <div className="w-48 shrink-0">
            <select
              aria-label="LLM provider"
              value={active}
              onChange={(e) => switchProvider(e.target.value as LLMProviderId)}
              className="ui-input"
            >
              {LLM_PROVIDERS.map((p) => (
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
            meta.consoleUrl && (
              <button
                type="button"
                onClick={() => window.electronAPI.openExternal(meta.consoleUrl!)}
                className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Get an API key →
              </button>
            )
          }
        />

        <div className="glass-card flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          {models.length > 0 ? (
            <LabeledSelect
              label="Model"
              value={llm.model}
              onChange={(model) => update({ llmSettings: { ...llm, model } })}
              options={models.map((m) => ({ value: m.id, label: m.label }))}
            />
          ) : (
            <LabeledField label="Model">
              <input
                value={llm.model}
                onChange={(e) => update({ llmSettings: { ...llm, model: e.target.value } })}
                placeholder="model id"
                spellCheck={false}
                autoComplete="off"
                className="ui-input min-w-[200px]"
              />
            </LabeledField>
          )}
          {meta.custom && (
            <LabeledField label="Base URL">
              <input
                value={llm.baseUrl}
                onChange={(e) => update({ llmSettings: { ...llm, baseUrl: e.target.value } })}
                placeholder="https://my-server.example/v1"
                spellCheck={false}
                autoComplete="off"
                className="ui-input min-w-[240px]"
              />
            </LabeledField>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
