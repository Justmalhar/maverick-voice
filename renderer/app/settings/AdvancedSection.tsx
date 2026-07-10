import type { ReactNode } from 'react'
import { Kbd, Toggle } from '../../ui'
import { useSettings } from '../settingsContext'
import { SectionCard, SettingRow } from './shared'

export default function AdvancedSection(): ReactNode {
  const { settings, update } = useSettings()
  if (!settings) return null

  return (
    <SectionCard title="Advanced" id="advanced">
      <SettingRow
        label="Edit selected text with voice"
        description="Select text, tap the instruction key, and speak an instruction to rewrite it. Off by default."
        last={!settings.instructionEnabled}
      >
        <Toggle
          checked={settings.instructionEnabled}
          onChange={(v) => update({ instructionEnabled: v })}
          aria-label="Edit selected text with voice"
        />
      </SettingRow>

      {settings.instructionEnabled && (
        <SettingRow label="Instruction key" description="The key you press while text is selected." last>
          <Kbd>Caps Lock</Kbd>
        </SettingRow>
      )}
    </SectionCard>
  )
}
