import type { ReactNode } from 'react'
import type { ThemeSetting, WidgetPosition } from '../../../shared/types'
import { Segmented } from '../../ui'
import { useTheme } from '../../theme/ThemeProvider'
import { useSettings } from '../settingsContext'
import { SectionCard, SettingRow } from './shared'

export default function AppearanceSection(): ReactNode {
  const { theme, setTheme } = useTheme()
  const { settings, update } = useSettings()
  if (!settings) return null

  return (
    <SectionCard title="Appearance" id="appearance">
      <SettingRow label="Theme" description="Light, dark, or follow your system appearance.">
        <Segmented
          aria-label="Theme"
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          value={theme}
          onChange={(v: ThemeSetting) => setTheme(v)}
        />
      </SettingRow>

      <SettingRow label="Widget position" description="Where the dictation pill appears on screen." last>
        <Segmented
          aria-label="Widget position"
          options={[
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' }
          ]}
          value={settings.widgetPosition}
          onChange={(v: WidgetPosition) => update({ widgetPosition: v })}
        />
      </SettingRow>
    </SectionCard>
  )
}
