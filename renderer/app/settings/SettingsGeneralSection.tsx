import type { Theme } from '../../../shared/types'
import { Section, SettingRow, Segmented, Toggle, SlidersIcon } from './settingsUi'

interface AudioDevice {
  deviceId: string
  label: string
}

export interface SettingsGeneralSectionProps {
  theme: Theme
  audioDevices: AudioDevice[]
  selectedDevice: string
  soundFeedback: boolean
  onThemeChange: (value: string) => void
  onInputDeviceChange: (deviceId: string) => void
  onSoundFeedbackChange: (value: boolean) => void
}

export default function SettingsGeneralSection({
  theme,
  audioDevices,
  selectedDevice,
  soundFeedback,
  onThemeChange,
  onInputDeviceChange,
  onSoundFeedbackChange,
}: SettingsGeneralSectionProps) {
  return (
    <Section title="General" icon={<SlidersIcon />}>
      <SettingRow label="Theme" description="Light, dark, or follow your system appearance">
        <Segmented
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
          value={theme}
          onChange={onThemeChange}
        />
      </SettingRow>
      <SettingRow label="Microphone" description="">
        <select className="mv-select min-w-[200px]" value={selectedDevice} onChange={(e) => onInputDeviceChange(e.target.value)}>
          {audioDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Sound feedback" description="" last>
        <Toggle checked={soundFeedback} onChange={onSoundFeedbackChange} />
      </SettingRow>
    </Section>
  )
}
