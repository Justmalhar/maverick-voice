import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { PermissionsReport } from '../../../shared/types'
import { CheckGlyph, IS_MAC, LoadingDots } from '../../ui'
import { SectionCard } from './shared'

/**
 * permissionsPreflight() on mount + window focus (user just flipped a toggle
 * in System Settings and switched back). Rows are hidden entirely on
 * platforms where the underlying permission is auto-granted/no-op, rather
 * than shown as a perpetually-green row (INTERFACES: accessibility/
 * inputMonitoring/automation are darwin-only concepts).
 */
export default function PermissionsSection(): ReactNode {
  const [report, setReport] = useState<PermissionsReport | null>(null)
  const [requestingMic, setRequestingMic] = useState(false)

  const refresh = useCallback(() => {
    window.electronAPI.permissionsPreflight().then(setReport).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  async function handleGrantMic(): Promise<void> {
    setRequestingMic(true)
    try {
      const granted = await window.electronAPI.requestMicPermission()
      if (!granted) window.electronAPI.openPermissionPane('mic')
    } finally {
      setRequestingMic(false)
      refresh()
    }
  }

  if (!report) {
    return (
      <SectionCard title="Permissions" id="permissions">
        <div className="flex justify-center px-5 py-8">
          <LoadingDots label="Checking permissions" />
        </div>
      </SectionCard>
    )
  }

  const micGranted = report.mic === 'granted'
  const micDenied = report.mic === 'denied'

  return (
    <SectionCard title="Permissions" id="permissions">
      <PermRow
        title="Microphone"
        description="Required so Maverick Voice can hear what you say."
        granted={micGranted}
        statusText={micGranted ? 'Granted' : micDenied ? 'Denied' : 'Not granted'}
        primary={!micGranted ? { label: requestingMic ? 'Requesting…' : 'Grant', onClick: handleGrantMic } : undefined}
        secondary={micDenied ? { label: 'Open Settings', onClick: () => window.electronAPI.openPermissionPane('mic') } : undefined}
      />

      {IS_MAC && (
        <>
          <PermRow
            title="Accessibility"
            description="Required to detect your shortcut key and paste at the cursor."
            granted={report.accessibility}
            statusText={report.accessibility ? 'Granted' : 'Not granted'}
            secondary={
              !report.accessibility
                ? { label: 'Open Settings', onClick: () => window.electronAPI.openPermissionPane('accessibility') }
                : undefined
            }
          />
          <PermRow
            title="Input Monitoring"
            description="Required so the dictation key is detected system-wide."
            granted={report.inputMonitoring}
            statusText={report.inputMonitoring ? 'Granted' : 'Not granted'}
            secondary={
              !report.inputMonitoring
                ? { label: 'Open Settings', onClick: () => window.electronAPI.openPermissionPane('input-monitoring') }
                : undefined
            }
          />
          <PermRow
            title="Automation"
            description="Lets Maverick Voice paste into other apps via System Events."
            granted={report.automation === 'granted'}
            statusText={
              report.automation === 'granted'
                ? 'Granted'
                : report.automation === 'denied'
                  ? 'Denied'
                  : 'Unknown — macOS prompts on first paste'
            }
            secondary={
              report.automation !== 'granted'
                ? { label: 'Open Settings', onClick: () => window.electronAPI.openPermissionPane('automation') }
                : undefined
            }
            last={!report.linux}
          />
        </>
      )}

      {report.linux && (
        <div className="border-t border-stroke px-5 py-4">
          <p className="text-[13px] font-medium text-ink-strong">Linux session</p>
          <p className="mt-1 text-[11px] leading-snug text-ink-muted">
            Session type: <span className="font-mono text-ink">{report.linux.sessionType}</span>
          </p>
          {!report.linux.xdotool && (
            <p className="mt-2 text-[11px] leading-snug text-ink-muted">
              <span className="font-semibold text-ink">xdotool</span> not found — paste falls back to clipboard-only.
              Install it for direct paste: <span className="font-mono text-ink">sudo apt install xdotool</span>
            </p>
          )}
          {!report.linux.secretService && (
            <p className="mt-2 text-[11px] leading-snug text-ink-muted">
              No secret-service keyring detected — API keys are stored without OS-level encryption.
            </p>
          )}
        </div>
      )}

      {!report.listenerAlive && (
        <div className="border-t border-stroke-strong px-5 py-3">
          <p className="text-[11px] font-medium text-ink-strong">
            The dictation key listener isn&apos;t responding — grant the permissions above, then reopen the app.
          </p>
        </div>
      )}
    </SectionCard>
  )
}

function PermRow({
  title,
  description,
  granted,
  statusText,
  primary,
  secondary,
  last
}: {
  title: string
  description: string
  granted: boolean
  statusText: string
  primary?: { label: string; onClick: () => void }
  secondary?: { label: string; onClick: () => void }
  last?: boolean
}): ReactNode {
  return (
    <div className={`flex items-start gap-3 px-5 py-4 ${last ? '' : 'border-b border-stroke'}`}>
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          granted ? 'border-stroke-strong bg-surface-veil text-ink-strong' : 'border-stroke bg-surface-veil text-ink-muted'
        }`}
      >
        {granted ? <CheckGlyph size={14} strokeWidth={3} /> : <DotGlyph />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-ink-strong">{title}</p>
          <span className={`text-[11px] font-bold uppercase tracking-wider ${granted ? 'text-ink-strong' : 'text-ink-muted'}`}>
            {statusText}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{description}</p>
        {(primary || secondary) && (
          <div className="mt-2.5 flex items-center gap-2">
            {primary && (
              <button type="button" onClick={primary.onClick} className="btn-raised px-3 py-1.5 text-[11px] font-semibold text-ink-strong">
                {primary.label}
              </button>
            )}
            {secondary && (
              <button type="button" onClick={secondary.onClick} className="btn-raised px-3 py-1.5 text-[11px]">
                {secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DotGlyph(): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="4" fill="currentColor" />
    </svg>
  )
}
