import { useEffect, useState, type ReactNode } from 'react'
import type {
  ActivationMode,
  DictationBinding,
  ProviderId,
  Session,
  UsageSummary
} from '../../shared/types'
import { Kbd, PageHeader, ProviderGlyph, Toggle } from '../ui'
import { useSettings } from './settingsContext'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)
const RECENTS_LIMIT = 3

const ACTIVATION_LABEL: Record<ActivationMode, string> = {
  'tap-toggle': 'Tap to toggle',
  'push-to-talk': 'Push to talk',
  'double-tap-push': 'Dual mode'
}

function modCap(mod: string): string {
  const mac: Record<string, string> = { cmd: '⌘', ctrl: '⌃', option: '⌥', shift: '⇧', fn: 'fn' }
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
  if (n === undefined) return '—'
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

function formatSessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function Home(): ReactNode {
  const { settings, update } = useSettings()
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [monthWords, setMonthWords] = useState<number | null>(null)
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
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
      // getSessions() contract sorts newest-first; take the head for the Recent strip.
      setRecentSessions(sessions.slice(0, RECENTS_LIMIT))
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
  function togglePauseMedia(v: boolean) {
    if (!settings) return
    update({ pauseMediaDuringDictation: v })
  }

  const minutes = usage ? Math.round(usage.month.sttSeconds / 60) : null
  const bindingLabel = dictationKeyLabel(settings?.dictationBinding ?? null)
  const activationLabel = settings ? ACTIVATION_LABEL[settings.activationMode] : ACTIVATION_LABEL['tap-toggle']

  const wordsText = monthWords === null ? '—' : monthWords.toLocaleString()
  const minutesText = minutes === null ? '—' : String(minutes)
  const costText = fmtUsd(usage?.month.costUsd)
  const statAriaLabel = `This month: ${wordsText} words dictated, ${minutesText} minutes, ${costText} estimated cost`

  return (
    <div>
      <PageHeader title="Home" subtitle="Speak anywhere and your words land at the cursor." />

      <div className="flex flex-col gap-2.5">
        {/* Hero: the shortcut that actually starts a dictation */}
        <div className="glass-card flex flex-wrap items-center gap-4 px-5 py-6">
          <Kbd className="text-[28px]! font-bold! px-4! py-2.5!">{bindingLabel}</Kbd>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-ink-strong">Press this anywhere to dictate.</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">{activationLabel}</p>
          </div>
        </div>

        {/* Recent sessions */}
        <div className="glass-card px-5 py-3.5">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Recent</p>
          {recentSessions.length === 0 ? (
            <p className="py-2 text-[12px] text-ink-muted">Your recent dictations will show up here.</p>
          ) : (
            <div className="divide-y divide-stroke">
              {recentSessions.map((session) => (
                <RecentRow key={session.id} session={session} />
              ))}
            </div>
          )}
        </div>

        {/* Usage this month */}
        <div className="glass-card px-5 py-3.5" role="group" aria-label={statAriaLabel}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">This month</p>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <span className="text-[28px] font-bold leading-none tabular-nums text-ink-strong">{wordsText}</span>
              <span className="ml-2 text-[12px] text-ink-muted">words dictated</span>
            </div>
            <div className="flex items-end gap-5">
              <Stat value={minutesText} unit="min" />
              <Stat value={costText} unit="est. cost" />
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
          <ToggleRow
            label="Pause media while dictating"
            checked={settings?.pauseMediaDuringDictation ?? true}
            onChange={togglePauseMedia}
          />
        </div>

        {/* Providers */}
        <div className="glass-card px-5 pt-3 pb-1">
          <p className="mb-1 px-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
            Providers · your keys
          </p>
          <div className="divide-y divide-stroke">
            <ProviderRow provider="groq" label="Groq" sub="Speech · Whisper" connected={keys.groq} />
            <ProviderRow provider="openai" label="OpenAI" sub="AI formatting" connected={keys.openai} />
            <ProviderRow provider="openrouter" label="OpenRouter" sub="AI formatting · any model" connected={keys.openrouter} optional />
          </div>
        </div>
      </div>
    </div>
  )
}

function RecentRow({ session }: { session: Session }): ReactNode {
  const preview = session.output || session.dictationTranscript || session.errorMessage || 'No output'
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-ink-muted">
        {formatSessionTime(session.createdAt)}
      </span>
      <p className="min-w-0 flex-1 truncate text-[12px] text-ink">{preview}</p>
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
  provider,
  label,
  sub,
  connected,
  optional
}: {
  provider: ProviderId
  label: string
  sub: string
  connected: boolean
  optional?: boolean
}): ReactNode {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-strong">
        <ProviderGlyph provider={provider} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink-strong">{label}</p>
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
