import { useState, useEffect } from 'react'
import type { UsageSummary } from '../../shared/types'

type UsageWindowKey = 'today' | 'month' | 'allTime'

const WINDOW_OPTIONS: { value: UsageWindowKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'allTime', label: 'All time' }
]

/** Estimated USD; sub-cent totals show as "<$0.01". Undefined → "—". */
function fmtUsd(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

/** Compact count: 1234 → "1.2K", 1_200_000 → "1.2M". Undefined → "—". */
function fmtCount(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

/** Audio seconds → "Xs" / "X.X min" / "Xh Ym". Undefined → "—". */
function fmtDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '—'
  if (seconds < 60) return Math.round(seconds) + 's'
  if (seconds < 3600) return (seconds / 60).toFixed(1).replace(/\.0$/, '') + ' min'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

export default function Usage() {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [usageWindow, setUsageWindow] = useState<UsageWindowKey>('today')
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    window.electronAPI.getUsage().then(setUsage).catch(() => {})
  }, [])

  async function handleReset() {
    if (resetting) return
    setResetting(true)
    try {
      const fresh = await window.electronAPI.resetUsage()
      setUsage(fresh)
    } catch {
      /* best-effort — usage tracking never blocks the UI */
    } finally {
      setResetting(false)
    }
  }

  const win = usage?.[usageWindow]
  const totalTokens = win ? win.inputTokens + win.outputTokens : undefined

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">Usage</h2>
        <p className="text-[11px] text-mv-text-muted mt-1.5">
          Estimated from provider pricing tables — actual charges may differ.
        </p>
      </div>

      {/* Window selector */}
      <div className="flex justify-center mb-6">
        <div className="mv-segment">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setUsageWindow(opt.value)}
              className={`mv-segment__btn ${usageWindow === opt.value ? 'mv-segment__btn--active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hero cost card */}
      <div className="mv-glass-card px-6 py-8 mb-3 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.06)_0%,transparent_60%)] pointer-events-none" />
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-mv-text-muted mb-3">
          Estimated spend
        </p>
        <p className="font-display text-[52px] leading-none font-extrabold text-mv-text-primary tabular-nums tracking-tight">
          {fmtUsd(win?.cost)}
        </p>
      </div>

      {/* Stat breakdown */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatCard label="Total tokens" value={fmtCount(totalTokens)} icon={<TokenIcon />} />
        <StatCard label="STT duration" value={fmtDuration(win?.sttSeconds)} icon={<ClockIcon />} />
        <StatCard label="Input tokens" value={fmtCount(win?.inputTokens)} icon={<ArrowInIcon />} />
        <StatCard label="Output tokens" value={fmtCount(win?.outputTokens)} icon={<ArrowOutIcon />} />
      </div>

      {/* Footer / reset */}
      <div className="mv-glass-card px-5 py-4 flex items-center justify-between gap-4">
        <p className="text-[11px] text-mv-text-muted leading-relaxed">
          STT priced per audio hour (Groq); LLM priced per million tokens
          (OpenAI / OpenRouter). Models without a pricing entry contribute $0.
        </p>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="btn-glass !px-4 !py-2 !text-[12px] whitespace-nowrap"
        >
          {resetting ? 'Resetting…' : 'Reset'}
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="mv-glass-card px-5 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-8 h-8 rounded-mv-md bg-mv-white-04 border border-mv-border flex items-center justify-center text-mv-text-muted shrink-0">
          {icon}
        </span>
        <span className="text-[12px] font-medium text-mv-text-secondary truncate">{label}</span>
      </div>
      <span className="font-display text-[18px] font-bold text-mv-text-primary tabular-nums tracking-tight">
        {value}
      </span>
    </div>
  )
}

/* ─── Icons ─── */

function TokenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v7M5.5 6.5h3.5a1.5 1.5 0 0 1 0 3H5.5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <polyline points="8,4.5 8,8 10.5,9.5" />
    </svg>
  )
}

function ArrowInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2.5" y1="8" x2="11" y2="8" />
      <polyline points="7.5,4.5 11,8 7.5,11.5" />
      <line x1="13.5" y1="3" x2="13.5" y2="13" />
    </svg>
  )
}

function ArrowOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="8" x2="13.5" y2="8" />
      <polyline points="10,4.5 13.5,8 10,11.5" />
      <line x1="2.5" y1="3" x2="2.5" y2="13" />
    </svg>
  )
}
