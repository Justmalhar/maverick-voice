import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ProviderId, ProviderKeyStatus } from '../../../shared/types'

/** One glass-card section with a small uppercase label above it. */
export function SectionCard({
  title,
  id,
  children
}: {
  title: string
  id?: string
  children: ReactNode
}): ReactNode {
  return (
    <section id={id} className="mb-6 scroll-mt-6">
      <h3 className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">{title}</h3>
      <div className="glass-card overflow-hidden">{children}</div>
    </section>
  )
}

/** Key-vault IPC wiring for one provider's KeyCard (shared by both provider sections). */
export function useProviderKey(provider: ProviderId): {
  status: ProviderKeyStatus | null
  save: (key: string) => Promise<void>
  test: (key: string) => Promise<void>
  clear: () => void
} {
  const [status, setStatus] = useState<ProviderKeyStatus | null>(null)

  const refresh = useCallback((): void => {
    window.electronAPI.getProviderKeyStatus(provider).then(setStatus).catch(() => {})
  }, [provider])

  useEffect(() => {
    setStatus(null)
    refresh()
  }, [refresh])

  return {
    status,
    save: async (key) => {
      const res = await window.electronAPI.setProviderKey(provider, key)
      if (!res.ok) throw new Error(res.error || "Couldn't save the key.")
      refresh()
    },
    test: async (key) => {
      const res = await window.electronAPI.testProviderKey(provider, key)
      if (!res.ok) throw new Error(res.error || 'Key test failed.')
    },
    clear: () => {
      window.electronAPI.clearProviderKey(provider)
      setStatus({ provider, hasKey: false, maskedKey: null })
    }
  }
}

/** Small labeled form atoms shared by the provider sections. */
export function LabeledField({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-muted">
      {label}
      {children}
    </label>
  )
}

export function LabeledSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}): ReactNode {
  return (
    <LabeledField label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="ui-input min-w-[160px]">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {!options.some((o) => o.value === value) && <option value={value}>{value}</option>}
      </select>
    </LabeledField>
  )
}

/** A label/description row with a control on the right — the settings-list atom. */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  last
}: {
  label: string
  description?: ReactNode
  /** id of the control inside `children`, associates the visible label (A11). */
  htmlFor?: string
  children: ReactNode
  last?: boolean
}): ReactNode {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-4 ${last ? '' : 'border-b border-stroke'}`}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-strong">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
