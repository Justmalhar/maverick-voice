import { Section, SettingRow, Toggle, WandIcon } from './settingsUi'

export interface SettingsAISectionProps {
  autoFormat: boolean
  appAwareFormatting: boolean
  onAutoFormatChange: (value: boolean) => void
  onAppAwareFormattingChange: (value: boolean) => void
}

export default function SettingsAISection({
  autoFormat,
  appAwareFormatting,
  onAutoFormatChange,
  onAppAwareFormattingChange,
}: SettingsAISectionProps) {
  return (
    <Section title="AI" icon={<WandIcon />}>
      <SettingRow
        label="AI auto-format"
        description="Clean up grammar, punctuation, and paragraphing of your dictation — meaning untouched."
      >
        <Toggle checked={autoFormat} onChange={onAutoFormatChange} />
      </SettingRow>

      <SettingRow
        label="Adapt to active app"
        description="Emails get paragraphs, IDE prompts get @file references, chats stay casual."
        last
      >
        <Toggle checked={appAwareFormatting} onChange={onAppAwareFormattingChange} disabled={!autoFormat} />
      </SettingRow>
    </Section>
  )
}
