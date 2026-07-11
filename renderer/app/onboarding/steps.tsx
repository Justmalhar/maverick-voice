import { useEffect, useState, type ReactNode } from 'react'
import type { KeyCapability, PermissionsReport, ProviderId, ProviderKeyStatus } from '../../../shared/types'
import { CheckGlyph, dictationBindingLabel, IS_MAC, Kbd, KeyCard } from '../../ui'
import { ICONS } from './icons'

const BODY_MAX = { sm: 'max-w-[420px]', md: 'max-w-[460px]', lg: 'max-w-[640px]' } as const

/** The ONE layout every step uses — icon/title/subtitle land at identical Y
 * positions across steps (DESIGN.md §6: fixed-height content region). */
export function StepShell({
  icon,
  title,
  subtitle,
  children,
  bodyWidth = 'sm'
}: {
  icon: ReactNode
  title: string
  subtitle?: ReactNode
  children?: ReactNode
  bodyWidth?: keyof typeof BODY_MAX
}): ReactNode {
  return (
    <div className="flex w-full max-w-[660px] flex-col items-center text-center">
      <div className="mb-4 flex h-[68px] shrink-0 items-center justify-center">{icon}</div>
      <h2 className="mb-2 text-[22px] font-extrabold leading-tight tracking-tight text-ink-strong">{title}</h2>
      {subtitle && <p className={`text-[13px] leading-relaxed text-ink ${children ? 'mb-6' : ''} mx-auto max-w-sm`}>{subtitle}</p>}
      {children && <div className={`mx-auto w-full ${BODY_MAX[bodyWidth]}`}>{children}</div>}
    </div>
  )
}

export function IconBadge({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="glass-card flex h-20 w-20 items-center justify-center text-ink-strong" aria-hidden="true">
      {children}
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }): ReactNode {
  return (
    <div className="glass-card flex h-full flex-col items-start gap-2.5 p-4 text-left">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-strong" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="text-[13px] font-semibold text-ink-strong">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{description}</p>
      </div>
    </div>
  )
}

function GrantedPill({ text }: { text: string }): ReactNode {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-stroke-strong bg-surface-veil px-4 py-2.5">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-strong text-surface-page">
        <CheckGlyph size={11} strokeWidth={3.5} />
      </span>
      <span className="text-[13px] font-semibold text-ink-strong">{text}</span>
    </div>
  )
}

// ── Step 1: Welcome ──────────────────────────────────────────────────────
export function WelcomeStep(): ReactNode {
  return (
    <StepShell
      icon={<IconBadge>{ICONS.waveform}</IconBadge>}
      title="Maverick Voice"
      subtitle="Voice-first dictation for your whole desktop. Speak anywhere — your words land right at the cursor, no window-switching, no cleanup."
      bodyWidth="lg"
    >
      <div className="grid grid-cols-2 gap-3">
        <FeatureCard icon={ICONS.mic} title="Dictate" description="Tap your key, speak, tap again. Raw text lands right at the cursor." />
        <FeatureCard icon={ICONS.wand} title="AI auto-format" description="Optionally let AI fix grammar and punctuation — never your meaning." />
      </div>
    </StepShell>
  )
}

// ── Step 2: How it works ────────────────────────────────────────────────
export function HowItWorksStep(): ReactNode {
  return (
    <StepShell icon={<IconBadge>{ICONS.chain}</IconBadge>} title="Three ways to speak" bodyWidth="lg">
      <div className="flex flex-col gap-3 text-left">
        <FeatureCard icon={ICONS.mic} title="Pure Dictation" description="Hold or tap your key and speak — clean text, no AI, no quotes." />
        <FeatureCard icon={ICONS.wand} title="AI Instruction (opt-in)" description="Select text, tap the instruction key, speak a command — the AI rewrites it." />
        <FeatureCard icon={ICONS.chain} title="Dictate-to-Instruct" description="Chain the two: dictate raw content, then immediately follow with an instruction." />
      </div>
    </StepShell>
  )
}

// ── Step 3: Privacy ──────────────────────────────────────────────────────
export function PrivacyStep(): ReactNode {
  const keychain = IS_MAC ? 'the macOS Keychain' : 'your OS credential store'
  return (
    <StepShell icon={<IconBadge>{ICONS.shield}</IconBadge>} title="Your words stay yours" subtitle="Maverick Voice is local-first. There's no account, no server, and nothing to sign up for.">
      <div className="flex flex-col gap-2.5 text-left">
        <PrivacyBullet text="Dictation history lives only on this computer." />
        <PrivacyBullet text="Audio is sent only to the provider you configure — Groq for speech-to-text, OpenAI or OpenRouter for transforms." />
        <PrivacyBullet text={`API keys are encrypted with ${keychain} via Electron safeStorage. No accounts, no tracking.`} />
      </div>
    </StepShell>
  )
}

function PrivacyBullet({ text }: { text: string }): ReactNode {
  return (
    <div className="glass-card flex items-start gap-2.5 px-4 py-3.5">
      <CheckGlyph size={14} strokeWidth={2.5} className="mt-0.5 shrink-0 text-ink-strong" />
      <span className="text-[12px] leading-relaxed text-ink-muted">{text}</span>
    </div>
  )
}

// ── Step 4: Provider keys ────────────────────────────────────────────────
export function ProviderKeysStep(): ReactNode {
  const [statuses, setStatuses] = useState<Partial<Record<ProviderId, ProviderKeyStatus>>>({})

  useEffect(() => {
    ;(['groq', 'openai', 'openrouter'] as ProviderId[]).forEach((p) => {
      window.electronAPI.getProviderKeyStatus(p).then((s) => setStatuses((prev) => ({ ...prev, [p]: s }))).catch(() => {})
    })
  }, [])

  async function refresh(provider: ProviderId): Promise<void> {
    const s = await window.electronAPI.getProviderKeyStatus(provider)
    setStatuses((prev) => ({ ...prev, [provider]: s }))
  }

  return (
    <StepShell
      icon={<IconBadge>{ICONS.key}</IconBadge>}
      title="Add your API keys"
      subtitle="Groq is required for dictation. OpenAI or OpenRouter power AI edits — optional, skippable, add them later in Settings."
      bodyWidth="md"
    >
      <div className="flex flex-col gap-3">
        <KeyCard
          provider="groq"
          title="Groq · Required"
          description="Speech-to-text"
          placeholder="gsk_..."
          status={statuses.groq ?? null}
          onSave={async (key) => {
            const res = await window.electronAPI.setProviderKey('groq', key)
            if (!res.ok) throw new Error(res.error || "Couldn't save the key.")
            await refresh('groq')
          }}
          onTest={async (key) => {
            const res = await window.electronAPI.testProviderKey('groq', key)
            if (!res.ok) throw new Error(res.error || 'Key test failed.')
          }}
          onClear={() => {
            window.electronAPI.clearProviderKey('groq')
            setStatuses((prev) => ({ ...prev, groq: { provider: 'groq', hasKey: false, maskedKey: null } }))
          }}
          extra={
            <button type="button" onClick={() => window.electronAPI.openExternal('https://console.groq.com/keys')} className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink">
              Get key →
            </button>
          }
        />
        {(['openai', 'openrouter'] as const).map((p) => (
          <KeyCard
            key={p}
            provider={p}
            title={p === 'openai' ? 'OpenAI · Optional' : 'OpenRouter · Optional'}
            description="AI transforms"
            placeholder={p === 'openai' ? 'sk-...' : 'sk-or-...'}
            status={statuses[p] ?? null}
            onSave={async (key) => {
              const res = await window.electronAPI.setProviderKey(p, key)
              if (!res.ok) throw new Error(res.error || "Couldn't save the key.")
              await refresh(p)
            }}
            onTest={async (key) => {
              const res = await window.electronAPI.testProviderKey(p, key)
              if (!res.ok) throw new Error(res.error || 'Key test failed.')
            }}
            onClear={() => {
              window.electronAPI.clearProviderKey(p)
              setStatuses((prev) => ({ ...prev, [p]: { provider: p, hasKey: false, maskedKey: null } }))
            }}
            extra={
              <button
                type="button"
                onClick={() => window.electronAPI.openExternal(p === 'openai' ? 'https://platform.openai.com/api-keys' : 'https://openrouter.ai/keys')}
                className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Get key →
              </button>
            }
          />
        ))}
      </div>
    </StepShell>
  )
}

// ── Step 5: Microphone permission ────────────────────────────────────────
export function MicStep({ report, onChange }: { report: PermissionsReport; onChange: () => void }): ReactNode {
  const [requesting, setRequesting] = useState(false)
  const granted = report.mic === 'granted'
  const denied = report.mic === 'denied'

  async function grant(): Promise<void> {
    setRequesting(true)
    try {
      const ok = await window.electronAPI.requestMicPermission()
      if (!ok) window.electronAPI.openPermissionPane('mic')
    } finally {
      setRequesting(false)
      onChange()
    }
  }

  return (
    <StepShell icon={<IconBadge>{ICONS.mic}</IconBadge>} title="Microphone access" subtitle="Maverick Voice needs your microphone to hear what you say. Audio is processed for transcription only — never recorded or stored by us.">
      {granted ? (
        <GrantedPill text="Microphone access granted" />
      ) : denied ? (
        <div className="flex flex-col items-center gap-3">
          <p className="mb-1 max-w-sm text-[12px] text-ink-muted">
            Microphone access is turned off. Open System Settings, find Maverick Voice under Microphone and toggle it on.
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={() => window.electronAPI.openPermissionPane('mic')} className="btn-raised rounded-full px-6 py-3 text-[13px]">
              Open System Settings
            </button>
            <button type="button" onClick={onChange} className="btn-raised rounded-full px-8 py-3 text-[13px] font-semibold text-ink-strong">
              I&apos;ve enabled it
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={grant} className="btn-raised rounded-full px-10 py-3.5 text-[14px] font-semibold text-ink-strong">
          {requesting ? 'Requesting…' : 'Grant microphone access'}
        </button>
      )}
    </StepShell>
  )
}

// ── Step 6: System permissions (darwin accessibility/input monitoring, or linux Wayland notice) ──
export function SystemPermissionsStep({ report, onChange }: { report: PermissionsReport; onChange: () => void }): ReactNode {
  if (!IS_MAC) {
    return (
      <StepShell icon={<IconBadge>{ICONS.gear}</IconBadge>} title="Wayland detected" subtitle="Global paste on Wayland is limited — Maverick Voice will copy your result to the clipboard and show a 'press Ctrl+V' hint instead of pasting automatically.">
        <div className="glass-card px-4 py-3.5 text-left text-[12px] leading-relaxed text-ink-muted">
          Install <span className="font-mono text-ink">xdotool</span> and use an X11 session for direct paste support.
        </div>
      </StepShell>
    )
  }

  return (
    <StepShell icon={<IconBadge>{ICONS.gear}</IconBadge>} title="System permissions" subtitle="Maverick Voice needs Accessibility and Input Monitoring to detect your shortcut key and paste at the cursor.">
      <div className="flex flex-col gap-3">
        <PermRow
          label="Accessibility"
          granted={report.accessibility}
          onOpen={() => window.electronAPI.openPermissionPane('accessibility')}
          onChange={onChange}
        />
        <PermRow
          label="Input Monitoring"
          granted={report.inputMonitoring}
          onOpen={() => window.electronAPI.openPermissionPane('input-monitoring')}
          onChange={onChange}
        />
      </div>
    </StepShell>
  )
}

function PermRow({ label, granted, onOpen, onChange }: { label: string; granted: boolean; onOpen: () => void; onChange: () => void }): ReactNode {
  return (
    <div className="glass-card flex items-center justify-between gap-3 px-4 py-3.5 text-left">
      <span className="text-[13px] font-semibold text-ink-strong">{label}</span>
      {granted ? (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-strong">
          <CheckGlyph size={13} strokeWidth={3} />
          Granted
        </span>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpen} className="btn-raised px-3 py-1.5 text-[11px]">
            Open Settings
          </button>
          <button type="button" onClick={onChange} className="btn-raised px-3 py-1.5 text-[11px] font-semibold text-ink-strong">
            I&apos;ve enabled it
          </button>
        </div>
      )}
    </div>
  )
}

// ── Step 7: Shortcuts ────────────────────────────────────────────────────
export function ShortcutsStep({ capability }: { capability: KeyCapability }): ReactNode {
  const label = dictationBindingLabel(capability.defaultBinding)
  return (
    <StepShell icon={<IconBadge>{ICONS.keyboard}</IconBadge>} title="Your shortcut" subtitle="One key to dictate anywhere. Tap to start, tap again to send." bodyWidth="lg">
      <div className="flex flex-col gap-3">
        <div className="glass-card flex items-center gap-4 p-4 text-left">
          <Kbd className="min-h-[44px] min-w-[56px] text-[13px] font-bold">{label}</Kbd>
          <div>
            <p className="text-[14px] font-semibold text-ink-strong">Dictation</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">Tap {label} to start, tap again to stop.</p>
          </div>
        </div>
        {capability.globeConflict && (
          <div className="glass-card px-4 py-3.5 text-left text-[12px] leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink-strong">Heads up:</span> macOS also uses this key for emoji / dictation.
            Set <span className="font-semibold text-ink">Keyboard → &quot;Press 🌐 key to&quot; → Do Nothing</span> to free it up, or
            switch to a custom combo later in Settings.
          </div>
        )}
        <div className="glass-card px-4 py-3.5 text-left text-[12px] leading-relaxed text-ink-muted">
          Turn on AI auto-format in Settings to clean up grammar as you dictate. Voice editing of selected text lives there too.
        </div>
      </div>
    </StepShell>
  )
}

// ── Step 8: Ready ────────────────────────────────────────────────────────
export function ReadyStep({ capability }: { capability: KeyCapability }): ReactNode {
  const label = dictationBindingLabel(capability.defaultBinding)
  return (
    <StepShell
      icon={<IconBadge>{ICONS.check}</IconBadge>}
      title="You're all set"
      subtitle={
        <>
          Press <Kbd>{label}</Kbd> anywhere to start dictating. Your voice, your words, everywhere.
        </>
      }
    />
  )
}
