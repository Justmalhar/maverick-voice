// Static privacy explainer. Monochrome black glass. No accounts, no tracking.
// Copy reflects the local BYO-key architecture: dictations stay local, API keys
// are encrypted via Electron safeStorage (Keychain on macOS / DPAPI on Windows),
// and audio is sent only to the provider the user configured.

export default function Privacy() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">
          Privacy
        </h2>
        <p className="text-[11px] text-mv-text-muted mt-1.5">
          Your voice, your keys, your data. Maverick Voice is local-first and
          account-free.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <PrivacyCard
          icon={<DeviceIcon />}
          title="Dictations stay on your device"
          description="Session history, transcripts, and audio are stored locally on your machine in an encrypted-at-rest SQLite database. Nothing is uploaded to us — there is no Maverick Voice server."
        />

        <PrivacyCard
          icon={<KeyIcon />}
          title="API keys are encrypted"
          description="Your provider API keys are encrypted with Electron safeStorage — backed by the macOS Keychain or Windows DPAPI. They never leave your device except as the bearer token on requests you initiate to your chosen provider."
        />

        <PrivacyCard
          icon={<CloudIcon />}
          title="Audio goes only to your provider"
          description="When you dictate, audio is sent directly to the provider you configured — Groq for speech-to-text, and OpenAI or OpenRouter for AI transforms. We never see, proxy, or store it."
        />

        <PrivacyCard
          icon={<NoTrackIcon />}
          title="No accounts, no tracking"
          description="There is no sign-up, no telemetry, and no analytics. Maverick Voice does not phone home. Usage costs shown in the app are estimated locally from public provider pricing tables."
        />
      </div>
    </div>
  )
}

function PrivacyCard({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
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
          <p className="text-[12px] text-mv-text-secondary leading-relaxed mt-1.5">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Icons ─── */

function DeviceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <line x1="5.5" y1="13.5" x2="10.5" y2="13.5" />
      <line x1="8" y1="11" x2="8" y2="13.5" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="11" r="3" />
      <path d="M7.1 8.9L13.5 2.5M11 5l1.5 1.5M9.5 6.5L11 8" />
    </svg>
  )
}

function CloudIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12a3 3 0 0 1-.4-5.97A4 4 0 0 1 12 6.5a2.75 2.75 0 0 1-.25 5.5H4.5z" />
    </svg>
  )
}

function NoTrackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <line x1="3.4" y1="3.4" x2="12.6" y2="12.6" />
    </svg>
  )
}
