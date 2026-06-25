import { useState, useEffect, useCallback } from 'react'
import type { DictationKey, ProxyAuthStatus } from '../../shared/types'

interface OnboardingProps {
  onComplete: () => void
}

type MicStatus = 'unknown' | 'not-determined' | 'granted' | 'denied' | 'restricted'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)
const ONBOARDING_KEY = 'maverickvoice_onboarding_complete'

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
      return IS_MAC ? 'Fn' : 'Right Ctrl'
  }
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [dictationKey, setDictationKey] = useState<DictationKey>(IS_MAC ? 'fn' : 'right-ctrl')
  const [authStatus, setAuthStatus] = useState<ProxyAuthStatus | null>(null)
  const [checkingA11y, setCheckingA11y] = useState(false)
  const [a11yNotDetected, setA11yNotDetected] = useState(false)

  // ─── Microphone permission ───
  const [micStatus, setMicStatus] = useState<MicStatus>(IS_MAC ? 'unknown' : 'granted')
  const micGranted = micStatus === 'granted'

  const refreshMicStatus = useCallback(async () => {
    try {
      const status = (await window.electronAPI.getMicPermissionStatus()) as MicStatus
      setMicStatus(status)
      return status
    } catch {
      return 'unknown' as MicStatus
    }
  }, [])

  // ─── Accessibility permission ───
  const [accessibilityGranted, setAccessibilityGranted] = useState(!IS_MAC)

  const refreshAccessibilityStatus = useCallback(async () => {
    try {
      const granted = await window.electronAPI.getAccessibilityStatus()
      setAccessibilityGranted(granted)
      return granted
    } catch {
      return false
    }
  }, [])

  async function requestAccessibility() {
    const granted = await window.electronAPI.requestAccessibility()
    setAccessibilityGranted(granted)
    if (!granted) window.electronAPI.openAccessibilitySettings()
  }

  // macOS doesn't always reflect the accessibility grant immediately.
  // Retry up to 3 times with increasing delays before giving up.
  async function checkA11yEnabled() {
    setCheckingA11y(true)
    setA11yNotDetected(false)
    const delays = [300, 800, 1500]
    for (const delay of delays) {
      await new Promise((r) => setTimeout(r, delay))
      const granted = await refreshAccessibilityStatus()
      if (granted) {
        setCheckingA11y(false)
        return
      }
    }
    setCheckingA11y(false)
    setA11yNotDetected(true)
  }

  async function requestMicPermission() {
    const granted = await window.electronAPI.requestMicPermission()
    if (granted) {
      setMicStatus('granted')
      return
    }
    const status = await refreshMicStatus()
    if (status === 'denied' || status === 'restricted') {
      window.electronAPI.openMicSettings()
    }
  }

  // Check permissions on mount + window focus (user just toggled in System
  // Settings). win32 resolves granted/no-op so this is a fast no-op there.
  useEffect(() => {
    window.electronAPI
      .getDictationKey()
      .then((k) => {
        if (['fn', 'right-option', 'right-ctrl', 'right-alt'].includes(k)) setDictationKey(k)
      })
      .catch(() => {})

    window.electronAPI.getAuthStatus().then(setAuthStatus).catch(() => {})
    window.electronAPI.onAuthStatusChange(setAuthStatus)

    if (!IS_MAC) return
    refreshMicStatus()
    refreshAccessibilityStatus()
    const onFocus = () => {
      refreshMicStatus()
      refreshAccessibilityStatus()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.electronAPI.removeAllListeners('auth:status-change')
    }
  }, [refreshMicStatus, refreshAccessibilityStatus])

  function next() {
    if (step < steps.length - 1) setStep(step + 1)
    else handleComplete()
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  function handleComplete() {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    onComplete()
  }

  const steps: React.ReactNode[] = [
    // ── Step 0: Welcome + how it works (combined) ──
    <StepShell
      key="welcome"
      icon={<IconBadge>{ICONS.waveform}</IconBadge>}
      title="Maverick Voice"
      subtitle="Voice-first dictation for your whole desktop. Speak anywhere — your words land right at the cursor, no window-switching, no cleanup."
      subtitleWide
      bodyWidth="lg"
    >
      <div className="grid grid-cols-2 gap-3">
        <FeatureCard icon={<MicGlyph />} title="Dictate" description="Tap your key, speak, tap again. Raw text lands right at the cursor." />
        <FeatureCard icon={<WandGlyph />} title="AI auto-format" description="Optionally let AI fix grammar and punctuation — never your meaning." />
      </div>
    </StepShell>,

    // ── Step 1: Sign in ──
    <StepShell
      key="signin"
      icon={<IconBadge>{ICONS.key}</IconBadge>}
      title="Sign in to get started"
      subtitle="Your Google account unlocks dictation and AI formatting — no API keys or configuration required."
      subtitleWide
    >
      {authStatus?.loggedIn ? (
        <div className="flex flex-col items-center gap-3">
          <GrantedPill text={`Signed in as ${authStatus.displayName ?? authStatus.email ?? 'you'}`} />
          {authStatus.email && authStatus.displayName && (
            <p className="text-[12px] text-mv-text-muted">{authStatus.email}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => window.electronAPI.authLogin()}
            className="btn-glass btn-glass--primary !px-10 !py-3.5 !text-[14px] !rounded-mv-pill flex items-center gap-2.5"
          >
            <GoogleIcon />
            Sign in with Google
          </button>
          <p className="text-[11px] text-mv-text-muted max-w-xs text-center leading-relaxed">
            A browser window will open — sign in and return here. You can also sign in later from the Account tab.
          </p>
        </div>
      )}
    </StepShell>,

    // ── Step 2: Privacy ──
    <StepShell
      key="privacy"
      icon={<IconBadge>{ICONS.shield}</IconBadge>}
      title="Your words stay yours"
      subtitle="Audio is routed through a managed proxy — never stored on Maverick servers."
    >
      <div className="flex flex-col gap-2.5 text-left">
        <PrivacyBullet text="Dictation history stays on this computer in a local database — never uploaded." />
        <PrivacyBullet text="Audio is sent only to the proxy for transcription and formatting, then immediately discarded." />
        <PrivacyBullet text={`Your session token is encrypted with ${IS_MAC ? 'the macOS Keychain' : 'Windows DPAPI'} via Electron safeStorage.`} />
      </div>
    </StepShell>,

    // ── Step 4: Microphone permission ──
    <StepShell
      key="mic"
      icon={<IconBadge>{ICONS.mic}</IconBadge>}
      title="Microphone access"
      subtitle="Maverick Voice needs your microphone to hear what you say. Audio is processed for transcription only — never recorded or stored."
    >
      {micGranted ? (
        <div className="flex flex-col items-center gap-4">
          <GrantedPill text="Microphone access granted" />
        </div>
      ) : micStatus === 'denied' || micStatus === 'restricted' ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-mv-text-muted text-[12px] mb-1 max-w-sm">
            Microphone access is turned off. Open System Settings, find <span className="font-semibold text-mv-text-primary">Maverick Voice</span> under Microphone and toggle it on.
          </p>
          <div className="flex gap-3">
            <button onClick={() => window.electronAPI.openMicSettings()} className="btn-glass !px-6 !py-3 !text-[13px] !rounded-mv-pill">
              Open System Settings
            </button>
            <button onClick={refreshMicStatus} className="btn-glass btn-glass--primary !px-8 !py-3 !text-[13px] !rounded-mv-pill">
              I've enabled it
            </button>
          </div>
        </div>
      ) : (
        <button onClick={requestMicPermission} className="btn-glass btn-glass--primary !px-10 !py-3.5 !text-[14px] !rounded-mv-pill">
          Grant microphone access
        </button>
      )}
    </StepShell>,

    // ── Step 5: Accessibility permission (macOS only — auto-granted on win32) ──
    <StepShell
      key="accessibility"
      icon={<IconBadge>{ICONS.gear}</IconBadge>}
      title="Accessibility permission"
      subtitle="Maverick Voice needs Accessibility access to detect your shortcut keys and paste at the cursor. Without it, nothing happens when you press your key."
    >
      {accessibilityGranted ? (
        <div className="flex flex-col items-center gap-4">
          <GrantedPill text="Accessibility access granted" />
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <p className="text-mv-text-muted text-[12px] mb-6 max-w-sm">
            Click below, find <span className="font-semibold text-mv-text-primary">Maverick Voice</span> in the list and toggle it on. This screen updates automatically once you do.
          </p>
          <div className="flex gap-3">
            <button onClick={requestAccessibility} className="btn-glass !px-6 !py-3 !text-[13px] !rounded-mv-pill">
              Open System Settings
            </button>
            <button
              onClick={checkA11yEnabled}
              disabled={checkingA11y}
              className="btn-glass btn-glass--primary !px-8 !py-3 !text-[13px] !rounded-mv-pill disabled:opacity-50"
            >
              {checkingA11y ? 'Checking…' : 'I\'ve enabled it'}
            </button>
          </div>
          {a11yNotDetected && (
            <p className="text-mv-text-muted text-[11px] mt-3 text-center max-w-xs">
              Not detected yet — you can continue and enable it later in System Settings.
            </p>
          )}
        </div>
      )}
    </StepShell>,

    // ── Step 6: Shortcuts (platform-aware) ──
    <StepShell
      key="shortcuts"
      icon={<IconBadge>{ICONS.keyboard}</IconBadge>}
      title="Your shortcut"
      subtitle="One key to dictate anywhere. Tap to start, tap again to send."
      bodyWidth="lg"
    >
      <div className="flex flex-col gap-3">
        <ShortcutCard keyLabel={dictationKeyLabel(dictationKey)} title="Dictation" description={`Tap ${dictationKeyLabel(dictationKey)} to start, tap again to stop.`} />
        <div className={`grid gap-3 ${IS_MAC ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className="mv-glass-card px-5 py-3.5 text-left">
            <p className="text-[12px] text-mv-text-secondary leading-relaxed">
              <span className="font-bold text-mv-text-primary">Pro tip:</span> turn on AI auto-format in Settings to clean up
              grammar as you dictate. Voice editing of selected text lives there too.
            </p>
          </div>
          {IS_MAC && (
            <div className="mv-glass-card px-5 py-3.5 text-left">
              <p className="text-[12px] text-mv-text-secondary leading-relaxed">
                <span className="font-bold text-mv-text-primary">One macOS tweak:</span> set <span className="font-semibold text-mv-text-primary">Keyboard → "Press 🌐 key to" → Do Nothing</span> to free the Fn key.
              </p>
              <button onClick={() => window.electronAPI.openKeyboardSettings()} className="btn-glass !px-3.5 !py-1.5 !text-[11px] mt-2.5">
                Open Keyboard Settings
              </button>
            </div>
          )}
        </div>
      </div>
    </StepShell>,

    // ── Step 7: Ready ──
    <StepShell
      key="ready"
      icon={<IconBadge className="animate-success-pop">{ICONS.check}</IconBadge>}
      title="You're all set"
      subtitle={
        <>
          Press <kbd className="kbd-3d">{dictationKeyLabel(dictationKey)}</kbd> anywhere to start dictating. Your voice, your
          words, everywhere.
        </>
      }
      subtitleWide
    />
  ]

  const isFirstStep = step === 0
  const isLastStep = step === steps.length - 1
  const primaryLabel = isLastStep ? 'Get started' : 'Continue'

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="titlebar-drag absolute top-0 left-0 right-0 h-9" />

      {/* Progress bar */}
      <div className="flex gap-1.5 px-10 pt-12">
        {steps.map((_, i) => (
          <div key={i} className="h-[3px] flex-1 rounded-full overflow-hidden bg-mv-white-08">
            <div className={`h-full rounded-full bg-mv-white transition-all duration-500 ease-out ${i <= step ? 'w-full opacity-90' : 'w-0'}`} />
          </div>
        ))}
      </div>

      {/* Step counter */}
      <div className="px-10 mt-4">
        <span className="text-[11px] text-mv-text-muted font-medium">
          {step + 1} of {steps.length}
        </span>
      </div>

      {/* Content — fixed-height region, TOP-ANCHORED so the icon slot + title
          land at the same Y on every step (no vertical-centering jump between
          icon and icon-less screens). Long steps scroll inside it; the footer
          never moves. */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-10 py-6">
        <div className="flex justify-center">{steps[step]}</div>
      </div>

      {/* Persistent footer — identical layout/sizing on every step. Back (ghost)
          left with reserved space (hidden, not removed, on the first step),
          centered progress dots, primary action right. */}
      <div className="onboarding-footer flex items-center justify-between gap-4 px-10 py-5 border-t border-mv-border">
        {/* Back (ghost) — space always reserved so the dots stay centered. */}
        <div className="flex-1 flex justify-start">
          <button
            onClick={back}
            className={`btn-glass !px-6 !py-3 !text-[13px] !rounded-mv-pill ${isFirstStep ? 'invisible pointer-events-none' : ''}`}
            aria-hidden={isFirstStep}
            tabIndex={isFirstStep ? -1 : 0}
          >
            Back
          </button>
        </div>

        {/* Centered progress dots. */}
        <div className="flex items-center gap-2 shrink-0" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`onboarding-dot ${i === step ? 'onboarding-dot--active' : ''}`} />
          ))}
        </div>

        {/* Primary action — Continue / Get started. */}
        <div className="flex-1 flex justify-end">
          <button onClick={next} className="btn-glass btn-glass--primary !px-8 !py-3 !text-[13px] !rounded-mv-pill">
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   StepShell — the ONE layout every onboarding step uses, so the icon, title,
   and subtitle sit at identical Y positions on every screen (no jump between
   icon and icon-less steps). Body content flows below at a consistent width;
   the parent content region is top-anchored + scrollable.
════════════════════════════════════════════════════════════════════════ */
const BODY_MAX = { sm: 'max-w-[420px]', md: 'max-w-[460px]', lg: 'max-w-[640px]' } as const

function StepShell({
  icon,
  title,
  subtitle,
  children,
  subtitleWide,
  bodyWidth = 'sm'
}: {
  icon: React.ReactNode
  title: string
  subtitle?: React.ReactNode
  children?: React.ReactNode
  /** Wider subtitle measure (md vs sm) for longer intro copy. */
  subtitleWide?: boolean
  /** Body column width: sm (default), md for the key cards, lg for horizontal card rows. */
  bodyWidth?: keyof typeof BODY_MAX
}) {
  return (
    <div className="flex flex-col items-center text-center animate-fade-up-in w-full max-w-[660px]">
      {/* Constant-height icon slot — reserved identically on every step so the
          title lands at the same Y whether or not a step has a hero icon. */}
      <div className="h-[68px] mb-4 flex items-center justify-center shrink-0">{icon}</div>
      <h2 className="font-display text-[24px] leading-tight font-extrabold text-mv-text-primary mb-2 tracking-tight text-balance">
        {title}
      </h2>
      {subtitle && (
        <p className={`text-mv-text-secondary text-[13.5px] leading-relaxed text-pretty ${subtitleWide ? 'max-w-md' : 'max-w-sm'} ${children ? 'mb-6' : ''}`}>
          {subtitle}
        </p>
      )}
      {children && <div className={`w-full ${BODY_MAX[bodyWidth]} mx-auto`}>{children}</div>}
    </div>
  )
}

/* Uniform 80×80 glass icon badge — the constant visual anchor at the top of
   every step. Holds a 30px monochrome glyph from ICONS. */
function IconBadge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center text-mv-text-primary shadow-[0_12px_40px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.18)_inset] ${className}`}
    >
      {children}
    </div>
  )
}

/* Per-step glyphs (30px) — every step gets one so the icon slot is never empty. */
const ICONS = {
  mic: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  waveform: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="10" x2="4" y2="14" />
      <line x1="8.5" y1="7" x2="8.5" y2="17" />
      <line x1="13" y1="3" x2="13" y2="21" />
      <line x1="17.5" y1="7" x2="17.5" y2="17" />
      <line x1="22" y1="10" x2="22" y2="14" />
    </svg>
  ),
  shield: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  key: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
    </svg>
  ),
  gear: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  keyboard: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="6" y1="10" x2="6" y2="10" />
      <line x1="10" y1="10" x2="10" y2="10" />
      <line x1="14" y1="10" x2="14" y2="10" />
      <line x1="18" y1="10" x2="18" y2="10" />
      <line x1="8" y1="14" x2="16" y2="14" />
    </svg>
  ),
  check: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="8.5 12 11 14.5 15.5 9.5" />
    </svg>
  )
}

function GrantedPill({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-mv-md bg-mv-white-08 border border-mv-border-focus">
      <div className="w-5 h-5 rounded-full bg-mv-white flex items-center justify-center">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <span className="text-mv-text-primary font-semibold text-[13px]">{text}</span>
    </div>
  )
}

/* Compact vertical feature card — icon on top so two sit side-by-side in a
   row without overflowing the short onboarding window. */
function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-start gap-2.5 mv-glass-card p-4 text-left h-full">
      <div className="w-10 h-10 rounded-mv-md bg-mv-white-04 border border-mv-border flex items-center justify-center shrink-0 text-mv-text-primary">
        {icon}
      </div>
      <div>
        <p className="text-[13.5px] font-semibold text-mv-text-primary">{title}</p>
        <p className="text-[12px] text-mv-text-secondary mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function PrivacyBullet({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 mv-glass-card px-4 py-3">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-primary shrink-0 mt-0.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span className="text-[12px] text-mv-text-secondary leading-relaxed">{text}</span>
    </div>
  )
}

function ShortcutCard({ keyLabel, title, description }: { keyLabel: string; title: string; description: string }) {
  return (
    <div className="flex items-center gap-4 mv-glass-card p-4 text-left">
      <kbd className="kbd-3d !min-h-[44px] !min-w-[56px] !text-[13px] !font-bold">{keyLabel}</kbd>
      <div>
        <p className="text-[14px] font-semibold text-mv-text-primary">{title}</p>
        <p className="text-[12px] text-mv-text-muted mt-0.5">{description}</p>
      </div>
    </div>
  )
}

function MicGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function WandGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />
    </svg>
  )
}
