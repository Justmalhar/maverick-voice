import { useEffect, useState, type ReactNode } from 'react'
import type { PermissionsReport } from '../../shared/types'
import { LoadingDots } from '../ui'
import Dictionary from './Dictionary'
import History from './History'
import Home from './Home'
import Onboarding from './onboarding/Onboarding'
import Replacements from './Replacements'
import Rules from './Rules'
import { isOnboardingComplete, resetOnboarding, setOnboardingComplete } from './onboardingState'
import { SettingsProvider } from './settingsContext'
import Settings from './settings/Settings'
import Snippets from './Snippets'

type Tab = 'home' | 'history' | 'dictionary' | 'replacements' | 'snippets' | 'rules' | 'settings'
type View = 'loading' | 'onboarding' | 'main'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'history', label: 'History', icon: <HistoryIcon /> },
  { id: 'dictionary', label: 'Dictionary', icon: <DictionaryIcon /> },
  { id: 'replacements', label: 'Replacements', icon: <ReplacementsIcon /> },
  { id: 'snippets', label: 'Snippets', icon: <SnippetsIcon /> },
  { id: 'rules', label: 'Rules', icon: <RulesIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> }
]

function hasPermissionBlocker(report: PermissionsReport): boolean {
  return report.mic !== 'granted' || !report.accessibility || !report.inputMonitoring || !report.listenerAlive
}

export default function App(): ReactNode {
  const [view, setView] = useState<View>('loading')

  useEffect(() => {
    setView(isOnboardingComplete() ? 'main' : 'onboarding')
  }, [])

  function handleOnboardingComplete(): void {
    setOnboardingComplete()
    setView('main')
  }

  function handleReplayOnboarding(): void {
    resetOnboarding()
    setView('onboarding')
  }

  if (view === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page">
        <LoadingDots label="Loading Maverick Voice" />
      </div>
    )
  }

  return (
    <SettingsProvider>
      {view === 'onboarding' ? (
        <Onboarding onComplete={handleOnboardingComplete} />
      ) : (
        <MainShell onReplayOnboarding={handleReplayOnboarding} />
      )}
    </SettingsProvider>
  )
}

function MainShell({ onReplayOnboarding }: { onReplayOnboarding: () => void }): ReactNode {
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [permissions, setPermissions] = useState<PermissionsReport | null>(null)

  useEffect(() => {
    function refresh(): void {
      window.electronAPI.permissionsPreflight().then(setPermissions).catch(() => {})
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const blocked = permissions ? hasPermissionBlocker(permissions) : false

  return (
    <div className="flex h-screen bg-surface-page text-ink">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-stroke bg-surface-raised px-3 pt-8 pb-3">
        <div className="mb-4 flex items-center gap-2.5 px-2 py-1">
          <BrandMark />
          <div className="leading-none">
            <p className="text-[14px] font-bold tracking-tight text-ink-strong">Maverick Voice</p>
            <p className="mt-1 text-[10px] font-medium text-ink-muted">Speak. It appears.</p>
          </div>
        </div>

        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-surface-veil text-ink-strong shadow-raise'
                : 'text-ink-muted hover:bg-surface-veil hover:text-ink'
            }`}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}

        {blocked && (
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="mt-3 flex items-center gap-2 rounded-lg border border-stroke-strong bg-surface-veil px-3 py-2 text-left text-[11px] font-semibold text-ink-strong"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-strong" />
            Permission needed
          </button>
        )}
      </nav>

      <main className="flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto max-w-2xl pb-12">
          {/* Every tab stays mounted (hidden, not unmounted) — no remount-per-click (v1 C5). */}
          <section hidden={activeTab !== 'home'}>
            <Home />
          </section>
          <section hidden={activeTab !== 'history'}>
            <History />
          </section>
          <section hidden={activeTab !== 'dictionary'}>
            <Dictionary />
          </section>
          <section hidden={activeTab !== 'replacements'}>
            <Replacements />
          </section>
          <section hidden={activeTab !== 'snippets'}>
            <Snippets />
          </section>
          <section hidden={activeTab !== 'rules'}>
            <Rules />
          </section>
          <section hidden={activeTab !== 'settings'}>
            <Settings onReplayOnboarding={onReplayOnboarding} />
          </section>
        </div>
      </main>
    </div>
  )
}

function BrandMark(): ReactNode {
  return (
    <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-surface-veil shadow-raise">
      <svg width="19" height="16" viewBox="0 0 40 32" fill="currentColor" className="text-ink-strong" aria-hidden="true">
        <rect x="1" y="11" width="5" height="10" rx="2.5" />
        <rect x="9" y="6" width="5" height="20" rx="2.5" />
        <rect x="17" y="0" width="5" height="32" rx="2.5" />
        <rect x="25" y="6" width="5" height="20" rx="2.5" />
        <rect x="33" y="11" width="5" height="10" rx="2.5" />
      </svg>
    </span>
  )
}

function HomeIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.5L8 2.5l5.5 5" />
      <path d="M3.75 6.75V13h8.5V6.75" />
      <path d="M6.5 13V9.5h3V13" />
    </svg>
  )
}

function HistoryIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,5 8,8 10,10" />
    </svg>
  )
}

function DictionaryIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13a1.5 1.5 0 0 1 1.5-1.5H13" />
      <path d="M4.5 1.5H13v13H4.5A1.5 1.5 0 0 1 3 13V3a1.5 1.5 0 0 1 1.5-1.5z" />
      <line x1="6" y1="4.75" x2="10.5" y2="4.75" />
    </svg>
  )
}

function ReplacementsIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5.5h10.5l-2.5-2.5" />
      <path d="M14 10.5H3.5l2.5 2.5" />
    </svg>
  )
}

function SnippetsIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="8.5 1.5 3 9 7.5 9 7 14.5 13 6.5 8 6.5 8.5 1.5" />
    </svg>
  )
}

function RulesIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4.25l1.5 1.5 2.25-2.5" />
      <path d="M2 10.75l1.5 1.5 2.25-2.5" />
      <line x1="8.5" y1="4" x2="14" y2="4" />
      <line x1="8.5" y1="11" x2="14" y2="11" />
    </svg>
  )
}

function SettingsIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.41 1.41M11.37 11.37l1.41 1.41M3.22 12.78l1.41-1.41M11.37 4.63l1.41-1.41" />
    </svg>
  )
}
