import { useEffect, useState, type ReactNode } from 'react'
import { SectionCard, SettingRow } from './shared'

export default function HelpSection({ onReplayOnboarding }: { onReplayOnboarding: () => void }): ReactNode {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getAppConfig().then((c) => setVersion(c.version)).catch(() => {})
  }, [])

  return (
    <SectionCard title="Help" id="help">
      <SettingRow label="Replay onboarding" description="Walk through the welcome and setup steps again.">
        <button type="button" onClick={onReplayOnboarding} className="btn-raised px-3.5 py-1.5 text-[12px]">
          Replay
        </button>
      </SettingRow>

      <SettingRow label="Source" description="Maverick Voice is open source on GitHub.">
        <button
          type="button"
          onClick={() => window.electronAPI.openExternal('https://github.com/justmalhar/maverick-voice')}
          className="btn-raised px-3.5 py-1.5 text-[12px]"
        >
          Open GitHub →
        </button>
      </SettingRow>

      <SettingRow label="Version" last>
        <span className="font-mono text-[12px] text-ink-muted">{version ?? '—'}</span>
      </SettingRow>
    </SectionCard>
  )
}
