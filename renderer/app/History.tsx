import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FlowType, Session } from '../../shared/types'
import {
  CheckGlyph,
  CopyGlyph,
  dictationBindingLabel,
  EmptyState,
  Kbd,
  LoadingDots,
  MicGlyph,
  PageHeader,
  TrashGlyph
} from '../ui'
import { useSettings } from './settingsContext'

const COPY_RESET_MS = 1500

// Monochrome intensity tiers (DESIGN.md §1) — dictation brightest, quote dimmest.
const FLOW_CONFIG: Record<FlowType, { label: string; className: string }> = {
  dictation: { label: 'Dictation', className: 'border-stroke-strong bg-surface-veil text-ink-strong' },
  transform: { label: 'Instruction', className: 'border-stroke bg-surface-veil text-ink-strong' },
  instruction: { label: 'Instruction', className: 'border-stroke bg-surface-veil text-ink-strong' },
  context: { label: 'Context', className: 'border-stroke text-ink' },
  quote: { label: 'Quote', className: 'border-stroke text-ink-muted' }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function History(): ReactNode {
  const { settings } = useSettings()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function load(): void {
    window.electronAPI
      .getSessions()
      .then(setSessions)
      .catch(() => console.error('[history] failed to load sessions'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const onFocus = (): void => load()
    window.addEventListener('focus', onFocus)

    const unsubscribe = window.electronAPI.onRetryStatus((sessionId, status, data) => {
      if (status === 'processing') {
        setRetryingIds((prev) => new Set(prev).add(sessionId))
        return
      }
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
      if (data) {
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...data } : s)))
      }
    })

    return () => {
      window.removeEventListener('focus', onFocus)
      unsubscribe()
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  function copyOutput(text: string, sessionId: string): void {
    void navigator.clipboard.writeText(text)
    setCopiedId(sessionId)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedId(null), COPY_RESET_MS)
  }

  function retry(sessionId: string): void {
    void window.electronAPI.retrySession(sessionId).catch(() => {})
  }

  function deleteOne(sessionId: string): void {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    void window.electronAPI.deleteSession(sessionId).catch(() => load())
  }

  function clearAll(): void {
    setConfirmClear(false)
    setSessions([])
    void window.electronAPI.clearAllSessions().catch(() => load())
  }

  const bindingLabel = settings ? dictationBindingLabel(settings.dictationBinding) : null

  if (loading) {
    return (
      <div>
        <PageHeader title="History" />
        <div className="flex justify-center py-24">
          <LoadingDots label="Loading history" />
        </div>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div>
        <PageHeader title="History" />
        <EmptyState
          icon={<MicGlyph size={28} />}
          heading="No dictations yet"
          body="Your past dictations will show up here."
          hint={bindingLabel ? <>Press <Kbd>{bindingLabel}</Kbd> anywhere to start your first dictation.</> : undefined}
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="Local session history — recent audio is kept for retry."
        actions={
          confirmClear ? (
            <>
              <span className="text-[12px] text-ink-muted">Clear all sessions?</span>
              <button type="button" onClick={clearAll} className="btn-raised px-3 py-1.5 text-[12px] font-semibold text-ink-strong">
                Confirm
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="px-2 py-1.5 text-[12px] text-ink-muted hover:text-ink">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="btn-raised px-3 py-1.5 text-[12px]">
              Clear all
            </button>
          )
        }
      />

      <div className="flex flex-col gap-2.5">
        {sessions.map((session) => {
          const flow = FLOW_CONFIG[session.flowType] ?? FLOW_CONFIG.dictation
          const isCopied = copiedId === session.id
          const isRetrying = retryingIds.has(session.id)
          const isError = session.status === 'error'
          const preview = session.output || session.dictationTranscript || session.errorMessage || 'No output'

          return (
            <div
              key={session.id}
              className={`group glass-card px-4 py-3.5 ${isError ? 'border-stroke-strong' : ''}`}
            >
              <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[11px] font-medium tabular-nums text-ink-muted">
                    {formatTime(session.createdAt)}
                  </span>
                  <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${flow.className}`}>
                    {flow.label}
                  </span>
                  {isRetrying && (
                    <span className="whitespace-nowrap rounded-full border border-stroke bg-surface-veil px-2 py-0.5 text-[10px] font-semibold text-ink-strong">
                      Retrying…
                    </span>
                  )}
                  {!isRetrying && isError && (
                    <span className="whitespace-nowrap rounded-full border border-stroke px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                      Failed
                    </span>
                  )}
                </div>

                {/* Row actions: visible on hover AND :focus-within — never keyboard-invisible (DESIGN §7). */}
                {!isRetrying && (
                  <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {session.output && (
                      <button
                        type="button"
                        onClick={() => copyOutput(session.output!, session.id)}
                        aria-label="Copy output"
                        title="Copy output"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted hover:text-ink focus-visible:text-ink"
                      >
                        {isCopied ? <CheckGlyph size={14} strokeWidth={3} /> : <CopyGlyph size={14} />}
                      </button>
                    )}
                    {session.audioRef && (
                      <button
                        type="button"
                        onClick={() => retry(session.id)}
                        aria-label="Retry from saved audio"
                        title="Retry from saved audio"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted hover:text-ink focus-visible:text-ink"
                      >
                        <RetryGlyph />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteOne(session.id)}
                      aria-label="Delete session"
                      title="Delete session"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted hover:text-ink focus-visible:text-ink"
                    >
                      <TrashGlyph size={14} />
                    </button>
                  </div>
                )}
              </div>

              {isRetrying ? (
                <p className="text-[13px] font-medium text-ink-muted">Re-processing audio…</p>
              ) : (
                <p className="line-clamp-2 text-[13px] leading-relaxed text-ink">{preview}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RetryGlyph(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}
