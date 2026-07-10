import { useEffect, useId, useState, type ReactNode } from 'react'
import type { ProviderId, ProviderKeyStatus } from '../../shared/types'
import { ProviderGlyph } from './ProviderGlyph'
import { CheckGlyph, EyeGlyph, EyeOffGlyph } from './glyphs'
import './ui.css'

export interface KeyCardProps {
  provider: ProviderId
  title: string
  description: string
  placeholder: string
  /** null while the page is still loading the status. */
  status: ProviderKeyStatus | null
  /** Persist the key. Reject with an Error to surface its message. */
  onSave: (key: string) => Promise<void>
  /** Validate the key ('' = test the stored key). Reject to surface the message. */
  onTest: (key: string) => Promise<void>
  onClear: () => void
  /** Extra footer content (e.g. "Get an API key →" link). */
  extra?: ReactNode
}

type Flow = { phase: 'idle' | 'testing' | 'ok' | 'error'; message?: string }

/**
 * THE provider-key entry card, shared by Settings and Onboarding (v1 shipped
 * two divergent copies — A9). Pure presentational: all IPC lives in the
 * page-level onSave/onTest/onClear callbacks.
 */
export function KeyCard({
  provider,
  title,
  description,
  placeholder,
  status,
  onSave,
  onTest,
  onClear,
  extra
}: KeyCardProps) {
  const titleId = useId()
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [reveal, setReveal] = useState(false)
  const [flow, setFlow] = useState<Flow>({ phase: 'idle' })

  // Reset local state when the card is re-pointed at another provider.
  useEffect(() => {
    setEditing(false)
    setInput('')
    setReveal(false)
    setFlow({ phase: 'idle' })
  }, [provider])

  const hasKey = status?.hasKey ?? false
  const busy = flow.phase === 'testing'
  // ONE constant layout — the input always renders (no saved-vs-empty shape
  // shift). Untouched + saved => it displays the masked preview; focusing
  // empties it for fresh entry; blurring empty restores the mask. The real
  // key never reaches the renderer, so "show" reveals the masked preview.
  const showingMask = !editing && !input && hasKey
  const inputValue = showingMask ? (status?.maskedKey ?? '') : input

  async function handleTest() {
    const key = input.trim()
    if (busy || (!key && !hasKey)) return
    setFlow({ phase: 'testing' })
    try {
      await onTest(key)
      setFlow({ phase: 'ok', message: 'Key is valid.' })
    } catch (err) {
      setFlow({ phase: 'error', message: err instanceof Error ? err.message : 'Key test failed.' })
    }
  }

  async function handleSave() {
    const key = input.trim()
    if (!key || busy) return
    setFlow({ phase: 'testing' })
    try {
      await onSave(key)
      setInput('')
      setEditing(false)
      setFlow({ phase: 'ok', message: 'Key saved securely.' })
    } catch (err) {
      setFlow({
        phase: 'error',
        message: err instanceof Error ? err.message : "Couldn't save the key."
      })
    }
  }

  function handleClear() {
    onClear()
    setEditing(false)
    setInput('')
    setFlow({ phase: 'idle' })
  }

  function cancelEdit() {
    setEditing(false)
    setInput('')
    setFlow({ phase: 'idle' })
  }

  return (
    <div className="glass-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-strong">
            <ProviderGlyph provider={provider} />
            <span
              aria-hidden="true"
              className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${hasKey ? 'bg-ink-strong' : 'bg-ink-faint'}`}
            />
          </span>
          <div className="min-w-0">
            <p id={titleId} className="text-[13px] font-semibold text-ink-strong">
              {title}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-ink-muted">{description}</p>
          </div>
        </div>
        <div className="flex h-6 shrink-0 items-center gap-2">
          {hasKey && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
              <CheckGlyph size={12} strokeWidth={3} />
              Saved
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={reveal ? 'text' : 'password'}
            value={inputValue}
            onChange={(e) => {
              setInput(e.target.value)
              setFlow({ phase: 'idle' })
            }}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              if (!input.trim()) {
                setEditing(false)
                setInput('')
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave()
              if (e.key === 'Escape' && editing) cancelEdit()
            }}
            placeholder={hasKey ? 'Enter a new key to replace' : placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-labelledby={titleId}
            aria-label={`${title} API key`}
            className="ui-input pr-9"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide key' : 'Show key'}
            aria-pressed={reveal}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink focus-visible:text-ink"
          >
            {reveal ? <EyeOffGlyph size={14} /> : <EyeGlyph size={14} />}
          </button>
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={busy || (!input.trim() && !hasKey)}
          className="btn-raised whitespace-nowrap px-3 py-2 text-[12px] disabled:opacity-40"
        >
          Test
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !input.trim()}
          className="btn-raised whitespace-nowrap px-3.5 py-2 text-[12px] font-semibold text-ink-strong disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasKey}
          className="px-2 py-1 text-[11px] font-medium text-ink-muted hover:text-ink focus-visible:text-ink disabled:opacity-40 disabled:hover:text-ink-muted"
        >
          Clear
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span role="status" aria-live="polite" className="min-h-4 text-[11px] font-medium">
          {flow.message && (
            <span className={flow.phase === 'error' ? 'text-ink-strong' : 'text-ink-muted'}>
              {flow.message}
            </span>
          )}
        </span>
        {extra}
      </div>
    </div>
  )
}
