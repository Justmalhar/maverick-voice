import { useEffect, useState, type ReactNode } from 'react'
import type { ActivationMode, DictationBinding, ProviderId, UsageSummary } from '../../shared/types'
import { Kbd, Toggle } from '../ui'
import { useSettings } from './settingsContext'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)

const ACTIVATION_LABEL: Record<ActivationMode, string> = {
  'tap-toggle': 'Tap to toggle',
  'push-to-talk': 'Push to talk',
  'double-tap-push': 'Dual mode'
}

function modCap(mod: string): string {
  const mac: Record<string, string> = { cmd: '\u2318', ctrl: '\u2303', option: '\u2325', shift: '\u21E7', fn: 'fn' }
  const win: Record<string, string> = { cmd: 'Win', ctrl: 'Ctrl', option: 'Alt', shift: 'Shift', fn: 'fn' }
  return (IS_MAC ? mac : win)[mod] || mod
}

function dictationKeyLabel(binding: DictationBinding | null): string {
  if (!binding) return 'Fn'
  if (binding.type === 'combo') return binding.mods.map(modCap).join(' + ')
  switch (binding.key) {
    case 'fn': return 'Fn'
    case 'right-option': return 'Right Opt'
    case 'right-ctrl': return 'Right Ctrl'
    case 'right-alt': return 'Right Alt'
    default: return 'Fn'
  }
}

function fmtUsd(n: number | undefined): string {
  if (n === undefined) return '\u2014'
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

function fmtSeconds(s: number | undefined): string {
  if (s === undefined) return '\u2014'
  if (s < 60) return Math.round(s) + 's'
  return (s / 60).toFixed(1).replace(/\.0$/, '') + ' min'
}

export default function Home(): ReactNode {
  const { settings, update } = useSettings()
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [monthWords, setMonthWords] = useState<number | null>(null)
  const [keys, setKeys] = useState<Record<'groq' | 'openai' | 'openrouter', boolean>>({
    groq: false,
    openai: false,
    openrouter: false
  })

  useEffect(() => {
    const api = window.electronAPI
    api.getUsage().then(setUsage).catch(() => {})
    ;(['groq', 'openai', 'openrouter'] as const).forEach((p) =>
      api.getProviderKeyStatus(p).then((s) => setKeys((k) => ({ ...k, [p]: s.hasKey }))).catch(() => {})
    )
    api.getSessions().then((sessions) => {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      let words = 0
      for (const s of sessions) {
        if (s.createdAt < monthStart) continue
        const text = s.output || s.dictationTranscript || ''
        if (text) words += text.trim().split(/\s+/).filter(Boolean).length
      }
      setMonthWords(words)
    }).catch(() => {})
  }, [])

  function toggleAutoFormat(v: boolean) {
    if (!settings) return
    update({ autoFormat: v })
  }
  function toggleAppAware(v: boolean) {
    if (!settings) return
    update({ appAwareFormatting: v })
  }

  const minutes = usage ? Math.round(usage.month.sttSeconds / 60) : null
  const bindingLabel = dictationKeyLabel(settings?.dictationBinding ?? null)
  const activationLabel = settings ? ACTIVATION_LABEL[settings.activationMode] : ACTIVATION_LABEL['tap-toggle']

  return (
    <div>
      <header className="mb-4">
        <h2 className="text-[22px] font-bold tracking-tight text-ink-strong">Home</h2>
        <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">
          Speak anywhere and your words land at the cursor.
        </p>
      </header>

      <div className="flex flex-col gap-2.5">
        {/* Usage this month */}
        <div className="glass-card px-5 py-3.5">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">This month</p>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <span className="text-[28px] font-bold leading-none tabular-nums text-ink-strong">
                {monthWords === null ? '\u2014' : monthWords.toLocaleString()}
              </span>
              <span className="ml-2 text-[12px] text-ink-muted">words dictated</span>
            </div>
            <div className="flex items-end gap-5">
              <Stat value={minutes === null ? '\u2014' : String(minutes)} unit="min" />
              <Stat value={fmtUsd(usage?.month.costUsd)} unit="est. cost" />
            </div>
          </div>
        </div>

        {/* Quick toggles */}
        <div className="glass-card px-5 divide-y divide-stroke">
          <ToggleRow
            label="AI auto-format"
            checked={settings?.autoFormat ?? false}
            onChange={toggleAutoFormat}
          />
          <ToggleRow
            label="Adapt to active app"
            checked={settings?.appAwareFormatting ?? true}
            disabled={!settings?.autoFormat}
            onChange={toggleAppAware}
          />
        </div>

        {/* Providers */}
        <div className="glass-card px-5 pt-3 pb-1">
          <p className="mb-1 px-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
            Providers · your keys
          </p>
          <div className="divide-y divide-stroke">
            <ProviderRow name="Groq" sub="Speech · Whisper" connected={keys.groq} />
            <ProviderRow name="OpenAI" sub="AI formatting" connected={keys.openai} />
            <ProviderRow name="OpenRouter" sub="AI formatting · any model" connected={keys.openrouter} optional />
          </div>
        </div>

        {/* Hotkey */}
        <div className="glass-card flex items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <p className="text-[13px] font-semibold text-ink-strong">{activationLabel}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">Your dictation shortcut</p>
          </div>
          <Kbd>{bindingLabel}</Kbd>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, unit }: { value: string; unit: string }): ReactNode {
  return (
    <div className="text-right">
      <span className="text-[20px] font-bold leading-none tabular-nums text-ink-strong">{value}</span>
      <span className="ml-1.5 text-[11px] text-ink-muted">{unit}</span>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): ReactNode {
  return (
    <div className={`flex items-center justify-between gap-4 py-3.5 ${disabled ? 'opacity-45' : ''}`}>
      <p className="min-w-0 text-[13px] font-semibold text-ink-strong">{label}</p>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  )
}

function ProviderRow({
  name,
  sub,
  connected,
  optional
}: {
  name: string
  sub: string
  connected: boolean
  optional?: boolean
}): ReactNode {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-strong">
        <ProviderIcon name={name} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink-strong">{name}</p>
        <p className="mt-0.5 text-[10.5px] text-ink-muted">{sub}</p>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-ink-strong' : 'bg-surface-veil'}`} />
        <span className={connected ? 'text-ink' : 'text-ink-muted'}>
          {connected ? 'Connected' : optional ? 'Optional' : 'Not set'}
        </span>
      </span>
    </div>
  )
}

function ProviderIcon({ name }: { name: string }): ReactNode {
  if (name === 'Groq') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
      </svg>
    )
  }
  if (name === 'OpenAI') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    )
  }
  if (name === 'OpenRouter') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    )
  }
  return null
}
