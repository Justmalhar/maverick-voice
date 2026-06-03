import { useState, useEffect } from 'react'
import type { DictationKey } from '../../shared/types'
import History from './History'
import Dictionary from './Dictionary'
import Snippets from './Snippets'
import Settings from './Settings'
import Onboarding from './Onboarding'

// Final nav set (June 2026 delta): Home, History, Dictionary, Snippets,
// Settings. Usage + Privacy were folded into Settings; the Voice/"Features"
// explainer is now a concise block inside Home.
type Tab = 'home' | 'history' | 'dictionary' | 'snippets' | 'settings'

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
      <main className="flex-1 h-full overflow-y-auto pt-11 px-10">
        <div className="max-w-2xl mx-auto pb-12">
          {/* key forces the entrance animation to replay on tab change */}
          <div key={activeTab} className="animate-view-enter">
            {activeTab === 'home' && (
              <Home dictationKey={dictationKey} onNavigate={setActiveTab} />
            )}
            {activeTab === 'history' && <History dictationKey={dictationKey} />}
            {activeTab === 'dictionary' && <Dictionary />}
            {activeTab === 'snippets' && <Snippets />}
            {activeTab === 'settings' && <Settings onDictationKeyChange={setDictationKey} />}
          </div>
        </div>
      </main>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Home — concise landing + the folded Voice/features explainer.
════════════════════════════════════════════════════════════════════════ */

function Home({
  dictationKey,
  onNavigate
}: {
  dictationKey: DictationKey
  onNavigate: (tab: Tab) => void
}) {
  const dictLabel = dictationKeyLabel(dictationKey)

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">
          Maverick Voice
        </h2>
        <p className="text-[12px] text-mv-text-secondary mt-1.5 leading-relaxed max-w-md">
          Speak anywhere on your desktop and your words land at the cursor — no window-switching, no
          cleanup.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <FeatureCard
          icon={<MicGlyph />}
          title="Dictate"
          description="Tap your dictation key, speak, tap again. Raw text lands exactly where the cursor is."
        >
          <div className="flex items-center gap-2 flex-wrap">
            <kbd className="kbd-3d">{dictLabel}</kbd>
            <span className="text-[11px] text-mv-text-muted">speak, tap again to stop</span>
          </div>
        </FeatureCard>

        <FeatureCard
          icon={<SparkGlyph />}
          title="AI auto-format"
          description="Optionally let the AI fix grammar, punctuation, and paragraphing — without changing what you said."
        >
          <button
            onClick={() => onNavigate('settings')}
            className="btn-glass !px-3.5 !py-1.5 !text-[11px]"
          >
            Enable in Settings
          </button>
        </FeatureCard>

        <FeatureCard
          icon={<DictionaryIcon size={18} />}
          title="Dictionary & Snippets"
          description="Teach Maverick the words it mishears, and expand short spoken triggers into longer text."
        >
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onNavigate('dictionary')}
              className="btn-glass !px-3.5 !py-1.5 !text-[11px]"
            >
              Dictionary
            </button>
            <button
              onClick={() => onNavigate('snippets')}
              className="btn-glass !px-3.5 !py-1.5 !text-[11px]"
            >
              Snippets
            </button>
          </div>
        </FeatureCard>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
  children
}: {
  icon: React.ReactNode
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="mv-glass-card px-5 py-5">
      <div className="flex items-start gap-4">
        <span className="w-10 h-10 rounded-mv-md bg-mv-white-04 border border-mv-border flex items-center justify-center text-mv-text-secondary shrink-0">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold text-mv-text-primary tracking-tight">
            {title}
          </h3>
          <p className="text-[12px] text-mv-text-secondary leading-relaxed mt-1.5">{description}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
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

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.41 1.41M11.37 11.37l1.41 1.41M3.22 12.78l1.41-1.41M11.37 4.63l1.41-1.41" />
    </svg>
  )
}

/* ─── Home glyphs ─── */

function MicGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function SparkGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 4.6L18.4 9.4 13.8 11.2 12 15.8 10.2 11.2 5.6 9.4 10.2 7.6 12 3z" />
      <path d="M19 15l.7 1.8L21.5 17.5 19.7 18.2 19 20l-.7-1.8L16.5 17.5 18.3 16.8 19 15z" />
    </svg>
  )
}
