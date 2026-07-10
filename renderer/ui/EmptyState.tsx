import type { ReactNode } from 'react'

export interface EmptyStateProps {
  /** Glyph rendered inside the raised card (16–30px SVG, currentColor). */
  icon?: ReactNode
  heading: string
  body?: ReactNode
  /** Optional keyboard hint line — compose with <Kbd> inline. */
  hint?: ReactNode
}

/** Shared empty state. Static by design — no infinite "breathe" (DESIGN.md §5.2). */
export function EmptyState({ icon, heading, body, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      {icon && (
        <div className="glass-card mb-6 flex h-20 w-20 items-center justify-center text-ink-muted">
          {icon}
        </div>
      )}
      <p className="mb-1.5 text-lg font-bold text-ink-strong">{heading}</p>
      {body && <p className="max-w-[280px] text-sm leading-relaxed text-ink-muted">{body}</p>}
      {hint && <p className="mt-4 text-[12px] text-ink-muted">{hint}</p>}
    </div>
  )
}
