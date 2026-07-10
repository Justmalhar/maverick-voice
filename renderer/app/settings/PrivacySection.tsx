import { type ReactNode } from 'react'
import { IS_MAC, IS_WIN } from '../../ui'
import { SectionCard } from './shared'

/** Static copy — no accounts, no telemetry, local-first architecture. */
export default function PrivacySection(): ReactNode {
  const keychainName = IS_MAC ? 'the macOS Keychain' : IS_WIN ? 'Windows DPAPI' : 'your desktop secret service (libsecret)'

  return (
    <SectionCard title="Privacy" id="privacy">
      <div className="px-5 py-4">
        <p className="max-w-[560px] text-[12px] leading-relaxed text-ink-muted">
          Maverick Voice is local-first and account-free. Session history and transcripts stay on this device. Your
          provider API keys are encrypted at rest via Electron <span className="text-ink">safeStorage</span>, backed by{' '}
          {keychainName}. Audio is sent only to the provider you configured — Groq for speech-to-text, and OpenAI or
          OpenRouter for AI transforms — never to a Maverick Voice server, because there isn&apos;t one. There is no
          sign-up, no telemetry, and no tracking; usage costs shown in the app are estimated locally from public
          provider pricing.
        </p>
      </div>
    </SectionCard>
  )
}
