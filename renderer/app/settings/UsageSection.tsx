import { useEffect, useState, type ReactNode } from 'react'
import type { UsageSummary, UsageWindow } from '../../../shared/types'
import { Segmented } from '../../ui'
import { SectionCard } from './shared'

type WindowKey = 'today' | 'month' | 'allTime'

const WINDOWS: { value: WindowKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'allTime', label: 'All time' }
]

function fmtUsd(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

function fmtCount(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

function fmtSeconds(s: number | undefined): string {
  if (s === undefined) return '—'
  if (s < 60) return Math.round(s) + 's'
  return (s / 60).toFixed(1).replace(/\.0$/, '') + ' min'
}

export default function UsageSection(): ReactNode {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [win, setWin] = useState<WindowKey>('today')
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    window.electronAPI.getUsage().then(setUsage).catch(() => {})
  }, [])

  async function handleReset(): Promise<void> {
    setConfirmReset(false)
    setResetting(true)
    try {
      setUsage(await window.electronAPI.resetUsage())
    } catch {
      /* best-effort — usage tracking never blocks the UI */
    } finally {
      setResetting(false)
    }
  }

  const data: UsageWindow | undefined = usage?.[win]
  const byModel = data ? Object.entries(data.byModel) : []

  return (
    <SectionCard title="Usage" id="usage">
      <div className="flex items-center justify-between gap-4 border-b border-stroke px-5 py-4">
        <Segmented aria-label="Usage window" options={WINDOWS} value={win} onChange={(v: WindowKey) => setWin(v)} />
        <div className="text-right">
          <span className="text-[24px] font-bold tabular-nums text-ink-strong">{fmtUsd(data?.costUsd)}</span>
          <span className="ml-2 text-[11px] text-ink-muted">estimated</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px border-b border-stroke bg-stroke">
        <Stat label="STT audio" value={fmtSeconds(data?.sttSeconds)} />
        <Stat label="Input tokens" value={fmtCount(data?.inputTokens)} />
        <Stat label="Output tokens" value={fmtCount(data?.outputTokens)} />
      </div>

      {byModel.length > 0 && (
        <div className="border-b border-stroke px-5 py-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-muted">Per model</p>
          <div className="flex flex-col gap-1.5">
            {byModel.map(([model, m]) => (
              <div key={model} className="flex items-center justify-between text-[11px]">
                <span className="truncate font-mono text-ink">{model}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{fmtUsd(m.costUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Estimated locally from provider pricing tables — models without a pricing entry contribute $0.
        </p>
        {confirmReset ? (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={handleReset} className="btn-raised px-3 py-1.5 text-[11px] font-semibold text-ink-strong">
              Confirm
            </button>
            <button type="button" onClick={() => setConfirmReset(false)} className="px-2 py-1.5 text-[11px] text-ink-muted">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={resetting}
            className="btn-raised shrink-0 whitespace-nowrap px-3 py-1.5 text-[11px]"
          >
            {resetting ? 'Resetting…' : 'Reset'}
          </button>
        )}
      </div>
    </SectionCard>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="bg-surface-raised px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-[16px] font-bold tabular-nums text-ink-strong">{value}</p>
    </div>
  )
}
