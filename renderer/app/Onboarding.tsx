import { useState, useEffect, useCallback } from 'react'
import type { ProviderId, DictationKey } from '../../shared/types'

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

    if (!IS_MAC) return
    refreshMicStatus()
    refreshAccessibilityStatus()
    const onFocus = () => {
      refreshMicStatus()
      refreshAccessibilityStatus()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
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
    // ── Step 0: Welcome ──
    <div key="welcome" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <BrandHero />
      <h1 className="font-display text-3xl font-extrabold text-mv-text-primary mb-3 tracking-tight">Maverick Voice</h1>
      <p className="text-mv-text-secondary text-[15px] max-w-md leading-relaxed">
        Voice-first dictation and voice-driven editing for your whole desktop. Speak anywhere, and your words land at the
        cursor — no window-switching, no cleanup.
      </p>
    </div>,

    // ── Step 1: How it works ──
    <div key="how" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <h2 className="font-display text-2xl font-extrabold text-mv-text-primary mb-2 tracking-tight">How it works</h2>
      <p className="text-mv-text-secondary text-[14px] mb-8 max-w-sm leading-relaxed">
        Speak anywhere on your machine — your words land at the cursor.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-[400px]">
        <FeatureCard icon={<MicGlyph />} title="Dictate" description="Tap your dictation key, speak, tap again. Raw text lands exactly where the cursor is." />
        <FeatureCard icon={<WandGlyph />} title="AI auto-format" description="Optionally let the AI fix grammar, punctuation, and paragraphing as you dictate — without changing what you said. Turn it on anytime in Settings." />
      </div>
    </div>,

    // ── Step 2: Privacy ──
    <div key="privacy" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-primary">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-mv-text-primary mb-2 tracking-tight">Your words stay yours</h2>
      <p className="text-mv-text-secondary text-[14px] mb-8 max-w-sm leading-relaxed">
        Maverick Voice is local-first. There's no account, no Maverick server, and nothing to sign up for.
      </p>
      <div className="flex flex-col gap-2.5 w-full max-w-[420px] text-left">
        <PrivacyBullet text="Dictation history lives only on this computer, in a local database." />
        <PrivacyBullet text={`Audio is sent only to the provider you configure — Groq for speech-to-text, OpenAI or OpenRouter for transforms.`} />
        <PrivacyBullet text={`API keys are encrypted with ${IS_MAC ? 'the macOS Keychain' : 'Windows DPAPI'} via Electron safeStorage. No accounts, no tracking.`} />
      </div>
    </div>,

    // ── Step 3: Provider keys ──
    <div key="keys" className="flex flex-col items-center justify-center text-center animate-fade-up-in w-full">
      <div className="mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center mb-6">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-primary">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-mv-text-primary mb-2 tracking-tight">Add your API keys</h2>
      <p className="text-mv-text-secondary text-[14px] mb-6 max-w-md leading-relaxed">
        Maverick Voice runs on your own keys — they stay encrypted on this machine. Add Groq for speech, and OpenAI or
        OpenRouter for AI transforms.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-[460px]">
        <OnboardingKeyCard provider="groq" label="Groq" sublabel="Speech-to-text" placeholder="gsk_..." consoleUrl="https://console.groq.com/keys" />
        <OnboardingKeyCard provider="openai" label="OpenAI" sublabel="AI transforms" placeholder="sk-..." consoleUrl="https://platform.openai.com/api-keys" />
        <OnboardingKeyCard provider="openrouter" label="OpenRouter" sublabel="AI transforms (alt)" placeholder="sk-or-..." consoleUrl="https://openrouter.ai/keys" />
      </div>
      <p className="text-[11px] text-mv-text-muted mt-5 max-w-md">
        Add at least a Groq key for dictation, plus one LLM key for instructions. You can add the rest later in Settings.
      </p>
    </div>,

    // ── Step 4: Microphone permission ──
    <div key="mic" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-primary">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-mv-text-primary mb-2 tracking-tight">Microphone access</h2>
      <p className="text-mv-text-secondary text-[14px] mb-2 max-w-sm leading-relaxed">
        Maverick Voice needs your microphone to hear what you say. Audio is processed for transcription only — never
        recorded or stored.
      </p>

      {micGranted ? (
        <div className="flex flex-col items-center gap-4 mt-4">
          <GrantedPill text="Microphone access granted" />
        </div>
      ) : micStatus === 'denied' || micStatus === 'restricted' ? (
        <div className="flex flex-col items-center gap-3 mt-4">
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
        <button onClick={requestMicPermission} className="btn-glass btn-glass--primary !px-10 !py-3.5 !text-[14px] !rounded-mv-pill mt-4">
          Grant microphone access
        </button>
      )}
    </div>,

    // ── Step 5: Accessibility permission (macOS only — auto-granted on win32) ──
    <div key="accessibility" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-primary">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-mv-text-primary mb-2 tracking-tight">Accessibility permission</h2>
      <p className="text-mv-text-secondary text-[14px] mb-2 max-w-sm leading-relaxed">
        Maverick Voice needs Accessibility access to detect your shortcut keys and paste at the cursor. Without it, nothing
        happens when you press your key.
      </p>

      {accessibilityGranted ? (
        <div className="flex flex-col items-center gap-4 mt-4">
          <GrantedPill text="Accessibility access granted" />
        </div>
      ) : (
        <>
          <p className="text-mv-text-muted text-[12px] mb-6 max-w-sm">
            Click below, find <span className="font-semibold text-mv-text-primary">Maverick Voice</span> in the list and toggle it on. This screen updates automatically once you do.
          </p>
          <div className="flex gap-3">
            <button onClick={requestAccessibility} className="btn-glass !px-6 !py-3 !text-[13px] !rounded-mv-pill">
              Open System Settings
            </button>
            <button onClick={refreshAccessibilityStatus} className="btn-glass btn-glass--primary !px-8 !py-3 !text-[13px] !rounded-mv-pill">
              I've enabled it
            </button>
          </div>
        </>
      )}
    </div>,

    // ── Step 6: Shortcuts (platform-aware) ──
    <div key="shortcuts" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <h2 className="font-display text-2xl font-extrabold text-mv-text-primary mb-6 tracking-tight">Your shortcut</h2>
      <div className="flex flex-col gap-3 mb-8 w-full max-w-[400px]">
        <ShortcutCard keyLabel={dictationKeyLabel(dictationKey)} title="Dictation" description={`Tap ${dictationKeyLabel(dictationKey)} to start, tap again to stop.`} />
      </div>
      <div className="mv-glass-card px-5 py-3.5 mb-3 max-w-[400px] text-left">
        <p className="text-[12px] text-mv-text-secondary leading-relaxed">
          <span className="font-bold text-mv-text-primary">Pro tip:</span> turn on AI auto-format in Settings to clean up
          grammar and punctuation as you dictate. Voice editing of selected text is also there when you want it.
        </p>
      </div>
      {IS_MAC && (
        <div className="mv-glass-card px-5 py-3.5 max-w-[400px] text-left">
          <p className="text-[12px] text-mv-text-secondary leading-relaxed">
            <span className="font-bold text-mv-text-primary">One macOS tweak:</span> Fn shows emoji or triggers Apple
            Dictation by default. Set <span className="font-semibold text-mv-text-primary">Keyboard → "Press 🌐 key to" → Do Nothing</span> to free it.
          </p>
          <button onClick={() => window.electronAPI.openKeyboardSettings()} className="btn-glass !px-3.5 !py-1.5 !text-[11px] mt-2.5">
            Open Keyboard Settings
          </button>
        </div>
      )}
    </div>,

    // ── Step 7: Ready ──
    <div key="ready" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="animate-success-pop">
        <BrandHero />
      </div>
      <h2 className="font-display text-3xl font-extrabold text-mv-text-primary mb-3 tracking-tight">You're all set!</h2>
      <p className="text-mv-text-secondary text-[15px] max-w-sm leading-relaxed">
        Press <kbd className="kbd-3d">{dictationKeyLabel(dictationKey)}</kbd> anywhere to start dictating. Your voice, your
        words, everywhere.
      </p>
    </div>
  ]

  const isFirstStep = step === 0
  const isLastStep = step === steps.length - 1
  const primaryLabel = isLastStep ? 'Get started' : 'Continue'

  return (
    <div className="h-screen flex flex-col">
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

      {/* Content — fixed-height region; long steps scroll inside it so the
          footer never moves between steps. */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-10 overflow-y-auto py-6">{steps[step]}</div>

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

/* ════════════════════════════════════════════════════════════════════════
   Onboarding per-provider key card — compact set/verify with masked status.
════════════════════════════════════════════════════════════════════════ */
function OnboardingKeyCard({
  provider,
  label,
  sublabel,
  placeholder,
  consoleUrl
}: {
  provider: ProviderId
  label: string
  sublabel: string
  placeholder: string
  consoleUrl: string
}) {
  const [saved, setSaved] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI
      .getProviderKeyStatus(provider)
      .then((s) => {
        if (s.hasKey) setSaved(true)
      })
      .catch(() => {})
  }, [provider])

  async function saveKey() {
    const key = input.trim()
    if (!key || busy) return
    setBusy(true)
    setError(null)
    try {
      const test = await window.electronAPI.testProviderKey(provider, key)
      if (!test.ok) {
        setError(test.error || "That key didn't work. Double-check and try again.")
        return
      }
      const res = await window.electronAPI.setProviderKey(provider, key)
      if (res.success) {
        setSaved(true)
        setInput('')
      } else {
        setError(res.error || "Couldn't save the key.")
      }
    } catch {
      setError('Something went wrong saving the key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mv-glass-card px-4 py-3.5 text-left">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <span className={`mv-status-dot ${saved ? 'mv-status-dot--on' : 'mv-status-dot--off'}`} />
          <div className="leading-none">
            <p className="text-[13px] font-semibold text-mv-text-primary">{label}</p>
            <p className="text-[10px] text-mv-text-muted mt-1">{sublabel}</p>
          </div>
        </div>
        {saved ? (
          <span className="text-[11px] font-semibold text-mv-text-primary flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Verified
          </span>
        ) : (
          <button onClick={() => window.electronAPI.openExternal(consoleUrl)} className="text-[11px] text-mv-text-muted hover:text-mv-text-primary transition-colors underline underline-offset-2">
            Get key →
          </button>
        )}
      </div>

      {!saved && (
        <>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveKey()
              }}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              className="mv-input flex-1"
            />
            <button onClick={saveKey} disabled={!input.trim() || busy} className="btn-glass btn-glass--primary !px-4 !py-2.5 !text-[12px] whitespace-nowrap">
              {busy ? 'Verifying…' : 'Save'}
            </button>
          </div>
          {error && <p className="text-[11px] text-mv-text-secondary mt-2">{error}</p>}
        </>
      )}
    </div>
  )
}

/* ─── Shared sub-components ─── */

function BrandHero() {
  return (
    <div className="relative mb-8 inline-flex items-center justify-center w-24 h-24 rounded-mv-xl bg-gradient-to-b from-mv-white-12 to-mv-white-04 border border-mv-border shadow-[0_12px_40px_rgba(0,0,0,0.6),0_1px_0_rgba(255,255,255,0.2)_inset]">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-primary">
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    </div>
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

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-4 mv-glass-card p-4 text-left">
      <div className="w-11 h-11 rounded-mv-md bg-mv-white-04 border border-mv-border flex items-center justify-center shrink-0 text-mv-text-primary">
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-semibold text-mv-text-primary">{title}</p>
        <p className="text-[12px] text-mv-text-secondary mt-0.5 leading-relaxed">{description}</p>
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
