import type { STTSettings } from '../../../shared/types'
import ProviderKeyRow from './ProviderKeyRow'
import { Section, Divider, KeyIcon } from './settingsUi'

export interface SettingsProvidersSectionProps {
  sttSettings: STTSettings
}

export default function SettingsProvidersSection({ sttSettings }: SettingsProvidersSectionProps) {
  return (
    <Section title="Providers & keys" icon={<KeyIcon />}>
      <ProviderKeyRow
        provider="groq"
        label="Groq"
        sublabel="Speech-to-text (Whisper) · LLM"
        tag={sttSettings.provider === 'groq' ? 'STT active' : undefined}
        placeholder="gsk_..."
        consoleUrl="https://console.groq.com/keys"
      />
      <Divider />
      <ProviderKeyRow
        provider="deepgram"
        label="Deepgram"
        sublabel="Speech-to-text (Nova / Whisper)"
        tag={sttSettings.provider === 'deepgram' ? 'STT active' : undefined}
        placeholder="Token…"
        consoleUrl="https://console.deepgram.com/"
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
  )
}
