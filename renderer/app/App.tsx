import { useState, useEffect } from 'react'
import type { DictationKey, UsageSummary, ActivationMode, DictationBinding, ProxyAuthStatus } from '../../shared/types'
import History from './History'
import Dictionary from './Dictionary'
import Snippets from './Snippets'
import Settings from './Settings'
import Onboarding from './Onboarding'
import SettingsAccountSection from './settings/SettingsAccountSection'

// Final nav set (June 2026 delta): Home, History, Dictionary, Snippets,
// Settings. Usage + Privacy were folded into Settings; the Voice/"Features"
// explainer is now a concise block inside Home.
type Tab = 'home' | 'history' | 'dictionary' | 'snippets' | 'account' | 'settings'

type AppView = 'loading' | 'onboarding' | 'main'

const ONBOARDING_KEY = 'maverickvoice_onboarding_complete'

/** Pretty label for the active dictation key (used by the sidebar pro-tip + Home). */
function dictationKeyLabel(key: DictationKey): string {
  switch (key) {
    case 'fn':
      return 'Fn'
    case 'right-option':
      return 'Right Opt'
    case 'right-ctrl':
      return 'Right Ctrl'
    case 'right-alt':
      return 'Right Alt'
    default:
      return 'Fn'
  }
}

const DICTATION_KEYS: DictationKey[] = ['fn', 'right-option', 'right-ctrl', 'right-alt']

export default function App() {
  const [view, setView] = useState<AppView>('loading')
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [dictationKey, setDictationKey] = useState<DictationKey>('fn')

  useEffect(() => {
    // Load the active dictation key for the pro-tip hint (platform default
    // resolved in main.ts; we just reflect it).
    window.electronAPI
      ?.getDictationKey()
      .then((key) => {
        if (DICTATION_KEYS.includes(key)) setDictationKey(key)
      })
      .catch(() => {})

    // Onboarding gate — no sign-in in local BYO-key mode.
    const onboardingDone = localStorage.getItem(ONBOARDING_KEY)
    setView(onboardingDone ? 'main' : 'onboarding')
  }, [])

  function handleOnboardingComplete() {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setView('main')
  }

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="titlebar-drag absolute top-0 left-0 right-0 h-9" />
        <div className="flex items-center gap-2">
          <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" />
          <div
            className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce"
            style={{ animationDelay: '0.15s' }}
          />
          <div
            className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce"
            style={{ animationDelay: '0.3s' }}
          />
        </div>
      </div>
    )
  }

  if (view === 'onboarding') {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Draggable titlebar strip (frameless window chrome). */}
      <div className="titlebar-drag absolute top-0 left-0 right-0 h-9 z-30" />

      {/* ─── Glass sidebar ─── */}
      <nav className="titlebar-drag w-[232px] min-w-[232px] h-full pt-12 px-3 pb-4 flex flex-col border-r border-mv-border bg-mv-bg-deep">
        {/* Brand wordmark */}
        <div className="titlebar-no-drag px-2 mb-5 pb-5 border-b border-mv-border">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="leading-none">
              <p className="font-display text-[15px] font-bold tracking-tight text-mv-text-primary">
                Maverick Voice
              </p>
              <p className="text-[10px] text-mv-text-muted font-medium mt-1">
                Speak. It appears.
              </p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-1">
          <SidebarButton
            icon={<HomeIcon />}
            label="Home"
            active={activeTab === 'home'}
            onClick={() => setActiveTab('home')}
          />
          <SidebarButton
            icon={<HistoryIcon />}
            label="History"
            active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
          />
          <SidebarButton
            icon={<DictionaryIcon />}
            label="Dictionary"
            active={activeTab === 'dictionary'}
            onClick={() => setActiveTab('dictionary')}
          />
          <SidebarButton
            icon={<SnippetsIcon />}
            label="Snippets"
            active={activeTab === 'snippets'}
            onClick={() => setActiveTab('snippets')}
          />
          <SidebarButton
            icon={<AccountIcon />}
            label="Account"
            active={activeTab === 'account'}
            onClick={() => setActiveTab('account')}
          />
          <SidebarButton
            icon={<SettingsIcon />}
            label="Settings"
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          />
        </div>

        {/* Pro tip pinned to the bottom */}
        <div className="titlebar-no-drag mt-auto px-1">
          <div className="mv-glass-card p-3.5 !rounded-mv-lg">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-mv-text-muted mb-2">
              Pro tip
            </p>
            <p className="text-[11px] text-mv-text-secondary leading-relaxed">
              Press <kbd className="kbd-3d !min-w-0 !px-2 !py-0.5">{dictationKeyLabel(dictationKey)}</kbd>{' '}
              anywhere to dictate. Turn on AI auto-format in Settings to clean it up.
            </p>
          </div>
        </div>
      </nav>

      {/* ─── Content ─── */}
      {/* Home fits above the fold by design → clip it (no scroll); the other
          tabs (History/Dictionary/Snippets/Settings) still scroll. */}
      <main className={`flex-1 h-full pt-11 px-10 ${activeTab === 'home' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <div className="max-w-2xl mx-auto pb-12">
          {/* key forces the entrance animation to replay on tab change */}
          <div key={activeTab} className="animate-view-enter">
            {activeTab === 'home' && (
              <Home dictationKey={dictationKey} onNavigate={setActiveTab} />
            )}
            {activeTab === 'history' && <History dictationKey={dictationKey} />}
            {activeTab === 'dictionary' && <Dictionary />}
            {activeTab === 'snippets' && <Snippets />}
            {activeTab === 'account' && (
              <div>
                <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight mb-5">Account</h2>
                <SettingsAccountSection />
              </div>
            )}
            {activeTab === 'settings' && <Settings onDictationKeyChange={setDictationKey} />}
          </div>
        </div>
      </main>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Home — at-a-glance dashboard: this month's usage, quick toggles, provider
   key status, and the active hotkey. The real version of the marketing
   ProductShot. All data is read live from the main process.
════════════════════════════════════════════════════════════════════════ */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)

const ACTIVATION_LABEL: Record<ActivationMode, string> = {
  'tap-toggle': 'Tap to toggle',
  'push-to-talk': 'Push to talk',
  'double-tap-push': 'Dual mode'
}

/** Short keycap label for a combo modifier (⌘ on mac, Win/Ctrl/… on win32). */
function modCap(mod: string): string {
  const mac: Record<string, string> = { cmd: '⌘', ctrl: '⌃', option: '⌥', shift: '⇧', fn: 'fn' }
  const win: Record<string, string> = { cmd: 'Win', ctrl: 'Ctrl', option: 'Alt', shift: 'Shift', fn: 'fn' }
  return (IS_MAC ? mac : win)[mod] || mod
}

/** Estimated USD; sub-cent totals show as "<$0.01". */
function fmtUsd(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

function Home({
  dictationKey,
  onNavigate
}: {
  dictationKey: DictationKey
  onNavigate: (tab: Tab) => void
}) {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [monthWords, setMonthWords] = useState<number | null>(null)
  const [autoFormat, setAutoFormat] = useState(false)
  const [appAware, setAppAware] = useState(true)
  const [activationMode, setActivationMode] = useState<ActivationMode>('tap-toggle')
  const [binding, setBinding] = useState<DictationBinding | null>(null)
  const [authStatus, setAuthStatus] = useState<ProxyAuthStatus | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    api.getUsage().then(setUsage).catch(() => {})
    api.getAutoFormat().then(setAutoFormat).catch(() => {})
    api.getAppAwareFormatting().then(setAppAware).catch(() => {})
    api.getActivationMode().then((m) => setActivationMode(m as ActivationMode)).catch(() => {})
    api.getDictationBinding().then(setBinding).catch(() => {})
    api.getAuthStatus().then(setAuthStatus).catch(() => {})
    api.onAuthStatusChange(setAuthStatus)
    // Approximate words dictated this month from saved transcripts.
    api
      .getSessions()
      .then((sessions) => {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
        let words = 0
        for (const s of sessions) {
          if (s.createdAt < monthStart) continue
          const text = s.output || s.dictationTranscript || ''
          if (text) words += text.trim().split(/\s+/).filter(Boolean).length
        }
        setMonthWords(words)
      })
      .catch(() => {})
    return () => api.removeAllListeners('auth:status-change')
  }, [])

  function toggleAutoFormat(v: boolean) {
    setAutoFormat(v)
    window.electronAPI.setAutoFormat(v)
  }
  function toggleAppAware(v: boolean) {
    setAppAware(v)
    window.electronAPI.setAppAwareFormatting(v)
  }

  const minutes = usage ? Math.round(usage.month.sttSeconds / 60) : null
  const caps =
    binding?.type === 'combo'
      ? binding.mods.map(modCap)
      : [dictationKeyLabel(binding?.type === 'key' ? binding.key : dictationKey)]

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-[22px] font-bold text-mv-text-primary tracking-tight">Home</h2>
        <p className="text-[12px] text-mv-text-secondary mt-1 leading-relaxed max-w-md">
          Speak anywhere and your words land at the cursor.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {/* Usage this month */}
        <div className="mv-glass-card px-5 py-3.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-mv-text-muted mb-2">This month</p>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <span className="font-display text-[28px] leading-none font-bold text-mv-text-primary tabular-nums">
                {monthWords === null ? '—' : monthWords.toLocaleString()}
              </span>
              <span className="text-[12px] text-mv-text-muted ml-2">words dictated</span>
            </div>
            <div className="flex items-end gap-5">
              <Stat value={minutes === null ? '—' : String(minutes)} unit="min" />
              <Stat value={fmtUsd(usage?.month.cost)} unit="est. cost" />
            </div>
          </div>
        </div>

        {/* Quick toggles */}
        <div className="mv-glass-card px-5 divide-y divide-mv-border">
          <ToggleRow label="AI auto-format" checked={autoFormat} onChange={toggleAutoFormat} />
          <ToggleRow label="Adapt to active app" checked={appAware} disabled={!autoFormat} onChange={toggleAppAware} />
        </div>

        {/* Proxy account status */}
        <button
          onClick={() => onNavigate('account')}
          className="mv-glass-card px-5 py-3.5 flex items-center justify-between gap-3 w-full text-left hover:bg-mv-white-04 transition-colors duration-150"
        >
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-mv-text-muted mb-1">Account</p>
            {authStatus?.loggedIn ? (
              <>
                <p className="text-[13px] font-semibold text-mv-text-primary truncate">
                  {authStatus.displayName ?? authStatus.email ?? 'Signed in'}
                </p>
                {authStatus.email && authStatus.displayName && (
                  <p className="text-[11px] text-mv-text-muted mt-0.5 truncate">{authStatus.email}</p>
                )}
              </>
            ) : (
              <p className="text-[13px] font-semibold text-mv-text-muted">Not signed in</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${authStatus?.loggedIn ? 'bg-mv-white' : 'bg-mv-white-24'}`} />
            <span className={`text-[11px] font-medium ${authStatus?.loggedIn ? 'text-mv-text-secondary' : 'text-mv-text-muted'}`}>
              {authStatus?.loggedIn ? authStatus.tier ?? 'free' : 'Sign in →'}
            </span>
          </div>
        </button>

        {/* Hotkey */}
        <div className="mv-glass-card px-5 py-3.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-mv-text-primary">{ACTIVATION_LABEL[activationMode]}</p>
            <p className="text-[11px] text-mv-text-muted mt-0.5">Your dictation shortcut</p>
          </div>
          <div className="flex items-center gap-1.5">
            {caps.map((c, i) => (
              <kbd key={i} className="kbd-3d">{c}</kbd>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="text-right">
      <span className="font-display text-[20px] leading-none font-bold text-mv-text-primary tabular-nums">{value}</span>
      <span className="text-[11px] text-mv-text-muted ml-1.5">{unit}</span>
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
}) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3.5 ${disabled ? 'opacity-45' : ''}`}>
      <p className="text-[13px] font-semibold text-mv-text-primary min-w-0">{label}</p>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative shrink-0 w-[42px] h-[24px] rounded-full border transition-colors duration-200 ${
        checked ? 'bg-mv-white-24 border-mv-border-focus' : 'bg-mv-white-04 border-mv-border'
      } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-mv-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-all duration-200 ${
          checked ? 'left-[21px]' : 'left-[3px]'
        }`}
      />
    </button>
  )
}

/* ─── Sidebar pieces ─── */

function SidebarButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`titlebar-no-drag group relative flex items-center gap-3 text-left px-3 py-2.5 rounded-mv-md text-[13px] font-medium select-none transition-all duration-150 ${
        active
          ? 'text-mv-text-primary bg-mv-surface-raised border border-mv-border shadow-[0_2px_8px_rgba(0,0,0,0.15)]'
          : 'text-mv-text-secondary border border-transparent hover:text-mv-text-primary hover:bg-mv-white-04'
      }`}
    >
      <span
        className={`transition-colors duration-150 ${active ? 'text-mv-text-primary' : 'text-mv-text-muted group-hover:text-mv-text-secondary'}`}
      >
        {icon}
      </span>
      {label}
    </button>
  )
}

function BrandMark() {
  // The Maverick waveform mark (from waveform.svg), white on the glass badge.
  return (
    <span className="relative inline-flex items-center justify-center w-9 h-9 rounded-mv-md bg-gradient-to-b from-mv-white-12 to-mv-white-04 border border-mv-border shadow-[0_3px_10px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.15)_inset]">
      <svg width="19" height="16" viewBox="0 0 40 32" fill="currentColor" className="text-mv-white">
        <rect x="1" y="11" width="5" height="10" rx="2.5" />
        <rect x="9" y="6" width="5" height="20" rx="2.5" />
        <rect x="17" y="0" width="5" height="32" rx="2.5" />
        <rect x="25" y="6" width="5" height="20" rx="2.5" />
        <rect x="33" y="11" width="5" height="10" rx="2.5" />
      </svg>
    </span>
  )
}

/* ─── Icons ─── */

function HomeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7.5L8 2.5l5.5 5" />
      <path d="M3.75 6.75V13h8.5V6.75" />
      <path d="M6.5 13V9.5h3V13" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,5 8,8 10,10" />
    </svg>
  )
}

function DictionaryIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13a1.5 1.5 0 0 1 1.5-1.5H13" />
      <path d="M4.5 1.5H13v13H4.5A1.5 1.5 0 0 1 3 13V3a1.5 1.5 0 0 1 1.5-1.5z" />
      <line x1="6" y1="4.75" x2="10.5" y2="4.75" />
    </svg>
  )
}

function SnippetsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="8.5 1.5 3 9 7.5 9 7 14.5 13 6.5 8 6.5 8.5 1.5" />
    </svg>
  )
}

function AccountIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M2.5 13.5c0-3.038 2.462-5 5.5-5s5.5 1.962 5.5 5" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.41 1.41M11.37 11.37l1.41 1.41M3.22 12.78l1.41-1.41M11.37 4.63l1.41-1.41" />
    </svg>
  )
}

