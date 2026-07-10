// Mono base components ONLY — never the `.Color` variants (DESIGN.md §8).
// Deep imports, NOT the package barrel — the barrel pulls antd into the
// renderer bundle (~12k modules / +180 kB, measured).
import Groq from '@lobehub/icons/es/Groq/components/Mono'
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono'
import OpenRouter from '@lobehub/icons/es/OpenRouter/components/Mono'
import type { ProviderId } from '../../shared/types'

export interface ProviderGlyphProps {
  provider: ProviderId
  size?: number
}

/** Monochrome provider brand glyph — renders via currentColor. */
export function ProviderGlyph({ provider, size = 18 }: ProviderGlyphProps) {
  switch (provider) {
    case 'groq':
      return <Groq size={size} />
    case 'openai':
      return <OpenAI size={size} />
    case 'openrouter':
      return <OpenRouter size={size} />
    case 'deepgram':
      // No @lobehub mono glyph — simplified Deepgram mark (stacked bars).
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 3h6a9 9 0 0 1 0 18H6l6.4-4.5A5.4 5.4 0 0 0 12 6.6L6 3z" />
        </svg>
      )
    case 'local':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )
    case 'custom':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" />
          <circle cx="9" cy="7" r="2.2" fill="var(--surface-raised, transparent)" />
          <line x1="4" y1="17" x2="20" y2="17" />
          <circle cx="15" cy="17" r="2.2" fill="var(--surface-raised, transparent)" />
        </svg>
      )
    default:
      return null
  }
}
