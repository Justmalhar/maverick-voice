import { useEffect, useState, type ReactNode } from 'react'
import { Toggle } from '../../ui'
import { useSettings } from '../settingsContext'
import { SectionCard, SettingRow } from './shared'

interface AudioDevice {
  deviceId: string
  label: string
}

export default function AudioSection(): ReactNode {
  const { settings, update } = useSettings()
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [noLabels, setNoLabels] = useState(false)

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        const inputs = all.filter((d) => d.kind === 'audioinput')
        setDevices(inputs.map((d) => ({ deviceId: d.deviceId, label: d.label })))
        setNoLabels(inputs.length > 0 && inputs.every((d) => !d.label))
      })
      .catch(() => console.error('[audio] failed to enumerate devices'))
  }, [])

  if (!settings) return null

  return (
    <SectionCard title="Audio" id="audio">
      <SettingRow label="Microphone" description={noLabels ? 'Grant microphone permission in Permissions above to see device names.' : undefined} htmlFor="audio-device">
        <select
          id="audio-device"
          value={settings.inputDeviceId}
          onChange={(e) => update({ inputDeviceId: e.target.value })}
          className="ui-input min-w-[200px]"
        >
          <option value="">System default</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label="Sound feedback" description="Play a click when dictation starts and stops.">
        <Toggle
          checked={settings.soundFeedback}
          onChange={(v) => update({ soundFeedback: v })}
          aria-label="Sound feedback"
        />
      </SettingRow>

      <SettingRow label="Chunked transcription" description="Stream long recordings in voice-activity-split chunks.">
        <Toggle
          checked={settings.chunkedTranscription}
          onChange={(v) => update({ chunkedTranscription: v })}
          aria-label="Chunked transcription"
        />
      </SettingRow>

      <SettingRow
        label="Pause media while dictating"
        description="Pauses Music/Spotify (and other players) when you start dictating, resumes when done."
        last
      >
        <Toggle
          checked={settings.pauseMediaDuringDictation}
          onChange={(v) => update({ pauseMediaDuringDictation: v })}
          aria-label="Pause media while dictating"
        />
      </SettingRow>
    </SectionCard>
  )
}
