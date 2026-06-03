import { useState, useEffect } from 'react'
import type { DictationKey } from '../../shared/types'
import History from './History'
import Voice from './Voice'
import Usage from './Usage'
import Settings from './Settings'
import Privacy from './Privacy'
import Onboarding from './Onboarding'

// Tab keys. INTERFACES.md fixes the reference-derived set (history / voice→
// "Features" / settings / privacy); Maverick Voice adds the dedicated `usage`
// cost surface (Usage.tsx) as a flagship tab.
type Tab = 'history' | 'voice' | 'usage' | 'settings' | 'privacy'

type AppView = 'loading' | 'onboarding' | 'main'

const ONBOARDING_KEY = 'maverickvoice_onboarding_complete'

/** Pretty label for the active dictation key (used by the sidebar pro-tip). */
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
  const [activeTab, setActiveTab] = useState<Tab>('history')
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
      <nav className="titlebar-drag w-[232px] min-w-[232px] h-full pt-12 px-3 pb-4 flex flex-col border-r border-mv-border bg-mv-glass-panel backdrop-blur-2xl">
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
            icon={<HistoryIcon />}
            label="History"
            active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
          />
          <SidebarButton
            icon={<VoiceIcon />}
            label="Features"
            active={activeTab === 'voice'}
            onClick={() => setActiveTab('voice')}
          />
          <SidebarButton
            icon={<UsageIcon />}
            label="Usage"
            active={activeTab === 'usage'}
            onClick={() => setActiveTab('usage')}
          />
          <SidebarButton
            icon={<SettingsIcon />}
            label="Settings"
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          />
          <SidebarButton
            icon={<PrivacyIcon />}
            label="Privacy"
            active={activeTab === 'privacy'}
            onClick={() => setActiveTab('privacy')}
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
              to dictate, <kbd className="kbd-3d !min-w-0 !px-2 !py-0.5">Right Shift</kbd> to instruct AI.
            </p>
          </div>
        </div>
      </nav>

      {/* ─── Content ─── */}
      <main className="flex-1 h-full overflow-y-auto pt-11 px-10">
        <div className="max-w-2xl mx-auto pb-12">
          {/* key forces the entrance animation to replay on tab change */}
          <div key={activeTab} className="animate-view-enter">
            {activeTab === 'history' && <History dictationKey={dictationKey} />}
            {activeTab === 'voice' && <Voice dictationKey={dictationKey} />}
            {activeTab === 'usage' && <Usage />}
            {activeTab === 'settings' && <Settings onDictationKeyChange={setDictationKey} />}
            {activeTab === 'privacy' && <Privacy />}
          </div>
        </div>
      </main>
    </div>
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
          ? 'text-mv-text-primary bg-mv-surface-raised border border-mv-border shadow-[0_2px_8px_rgba(0,0,0,0.4),0_1px_0_rgba(255,255,255,0.08)_inset]'
          : 'text-mv-text-secondary border border-transparent hover:text-mv-text-primary hover:bg-mv-white-04'
      }`}
    >
      {/* active rail */}
      <span
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full bg-mv-white transition-all duration-200 ${
          active ? 'h-5 opacity-90' : 'h-0 opacity-0'
        }`}
      />
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
  return (
    <span className="relative inline-flex items-center justify-center w-9 h-9 rounded-mv-md bg-gradient-to-b from-mv-white-12 to-mv-white-04 border border-mv-border shadow-[0_3px_10px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.15)_inset]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-primary">
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    </span>
  )
}

/* ─── Icons ─── */

function HistoryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,5 8,8 10,10" />
    </svg>
  )
}

function VoiceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <line x1="8" y1="12" x2="8" y2="14.5" />
    </svg>
  )
}

function UsageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1v14M11 4H6.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H5" />
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

function PrivacyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14.5s5.5-2.5 5.5-7V3.5L8 1.5 2.5 3.5V7.5c0 4.5 5.5 7 5.5 7z" />
      <polyline points="5.5 8 7 9.5 10.5 6" />
    </svg>
  )
}
