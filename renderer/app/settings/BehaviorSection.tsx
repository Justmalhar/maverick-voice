import type { OutputMode } from '../../../shared/types'
import type { ReactNode } from 'react'
import { Segmented, Toggle } from '../../ui'
import { useSettings } from '../settingsContext'
import { SectionCard, SettingRow } from './shared'

export default function BehaviorSection(): ReactNode {
  const { settings, update } = useSettings()
  if (!settings) return null

  return (
    <SectionCard title="Behavior" id="behavior">
      <SettingRow label="Output mode" description="How the result is delivered.">
        <Segmented
          aria-label="Output mode"
          options={[
            { value: 'paste', label: 'Paste at cursor' },
            { value: 'clipboard', label: 'Copy to clipboard' }
          ]}
          value={settings.outputMode}
          onChange={(mode: OutputMode) => update({ outputMode: mode })}
        />
      </SettingRow>

      <SettingRow label="AI auto-format" description="Clean up grammar, punctuation, and paragraphing of your dictation — meaning untouched.">
        <Toggle
          checked={settings.autoFormat}
          onChange={(v) => update({ autoFormat: v })}
          aria-label="AI auto-format"
        />
      </SettingRow>

      <SettingRow
        label="Adapt to active app"
        description="Emails get paragraphs, IDE prompts get @file references, chats stay casual."
        last
      >
        <Toggle
          checked={settings.appAwareFormatting}
          onChange={(v) => update({ appAwareFormatting: v })}
          disabled={!settings.autoFormat}
          aria-label="Adapt to active app"
        />
      </SettingRow>
    </SectionCard>
  )
}
