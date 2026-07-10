import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

/** Shared dashboard page header (v1 re-declared one per file — A9). */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[22px] font-bold tracking-tight text-ink-strong">{title}</h2>
        {subtitle && (
          <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
