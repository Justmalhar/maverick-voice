import Groq from '@lobehub/icons/es/Groq/components/Mono'
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono'
import OpenRouter from '@lobehub/icons/es/OpenRouter/components/Mono'
import type { ProviderId } from '../../../shared/types'

export function ProviderGlyph({ provider }: { provider: ProviderId }) {
  switch (provider) {
    case 'groq':
      return <Groq size={18} />
    case 'deepgram':
      return <DeepgramGlyph />
    case 'openai':
      return <OpenAI size={18} />
    case 'openrouter':
      return <OpenRouter size={18} />
    default: {
      const _exhaustive: never = provider
      return _exhaustive
    }
  }
}

function DeepgramGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="12" cy="7" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <circle cx="19" cy="12" r="2.5" />
    </svg>
  )
}

export function ProviderChip({ provider }: { provider: ProviderId }) {
  return (
    <span className="flex items-center justify-center w-8 h-8 rounded-mv-md bg-mv-white-04 border border-mv-border text-mv-text-primary shrink-0 [&_svg]:grayscale">
      <ProviderGlyph provider={provider} />
    </span>
  )
}

export function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <div className="mv-section-label mb-2.5 mt-6">
        <span className="text-mv-text-muted">{icon}</span>
        {title}
      </div>
      <div className="mv-glass-card overflow-hidden mb-3">{children}</div>
    </>
  )
}

export function Divider() {
  return <div className="h-px bg-mv-border" />
}

export function SettingRow({
  label,
  description,
  children,
  last,
}: {
  label: string
  description: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 gap-4 ${last ? '' : 'border-b border-mv-border'}`}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-mv-text-primary">{label}</p>
        {description && <p className="text-[11px] text-mv-text-muted mt-0.5 leading-snug">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; icon?: React.ReactNode }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="mv-segment">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`mv-segment__btn ${value === opt.value ? 'mv-segment__btn--active' : ''}`}
        >
          {opt.icon && <span className="mv-segment__icon [&_svg]:grayscale">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`mv-toggle ${checked ? 'mv-toggle--on' : ''} ${disabled ? 'mv-toggle--disabled' : ''}`}
      aria-pressed={checked}
    >
      <span className="mv-toggle__knob" />
    </button>
  )
}

export function PermissionRow({
  title,
  description,
  granted,
  statusText,
  primary,
  secondary,
}: {
  title: string
  description: string
  granted: boolean
  statusText: string
  primary: { label: string; onClick: () => void } | null
  secondary: { label: string; onClick: () => void } | null
}) {
  return (
    <div className="px-5 py-4 flex items-start gap-3 border-t border-mv-border">
      <div
        className={`w-8 h-8 rounded-mv-md flex items-center justify-center shrink-0 mt-0.5 border ${granted ? 'bg-mv-white-12 border-mv-border-focus text-mv-text-primary' : 'bg-mv-white-04 border-mv-border text-mv-text-muted'}`}
      >
        {granted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-mv-text-primary">{title}</p>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${granted ? 'text-mv-text-primary' : 'text-mv-text-muted'}`}>
            {statusText}
          </span>
        </div>
        <p className="text-[12px] text-mv-text-secondary leading-relaxed mt-1.5">{description}</p>
        {(primary || secondary) && (
          <div className="flex items-center gap-2 mt-3">
            {primary && (
              <button onClick={primary.onClick} className="btn-glass btn-glass--primary !px-3.5 !py-1.5 !text-[11px]">
                {primary.label}
              </button>
            )}
            {secondary && (
              <button onClick={secondary.onClick} className="btn-glass !px-3.5 !py-1.5 !text-[11px]">
                {secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function MicIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2a2.5 2.5 0 0 1 0 5M5.5 2a5 5 0 0 0 0 5M8 7v6M5 13h6" />
    </svg>
  )
}

export function WandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5V1.5M10 11v-1M6 6h1.5M13 6h1M11.8 7.8L12.5 8.5M11.8 4.2L12.5 3.5M2 14l6-6M8.2 4.2L7.5 3.5" />
    </svg>
  )
}

export function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14.5s5.5-2.5 5.5-7V3.5L8 1.5 2.5 3.5V7.5c0 4.5 5.5 7 5.5 7z" />
      <polyline points="5.5 8 7 9.5 10.5 6" />
    </svg>
  )
}

export function SlidersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2.5" y1="5" x2="13.5" y2="5" />
      <line x1="2.5" y1="11" x2="13.5" y2="11" />
      <circle cx="6" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function CogIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" />
    </svg>
  )
}

export function KeyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="11" r="3" />
      <path d="M7.1 8.9 13.5 2.5M11 5l1.5 1.5M9.5 6.5 11 8" />
    </svg>
  )
}

export function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  )
}
