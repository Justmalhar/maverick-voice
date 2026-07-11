import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

type FlowFilter = 'all' | 'dictation' | 'instruction' | 'transform' | 'context'
type StatusFilter = 'all' | 'done' | 'error'

const FLOW_FILTERS: FlowFilter[] = ['all', 'dictation', 'instruction', 'transform', 'context']
const STATUS_FILTERS: StatusFilter[] = ['all', 'done', 'error']
// One label map covers both selects — the values never collide.
const FILTER_LABELS: Record<FlowFilter | StatusFilter, string> = {
  all: 'All',
  dictation: 'Dictation',
  instruction: 'Instruction',
  transform: 'Transform',
  context: 'Context',
  done: 'Done',
  error: 'Error'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Case-insensitive substring match across every transcript/output field. */
function matchesSearch(session: Session, term: string): boolean {
  if (!term) return true
  const haystack = [session.dictationTranscript, session.instructionTranscript, session.output]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  return haystack.includes(term.toLowerCase())
}

function filterSessions(sessions: Session[], search: string, flow: FlowFilter, status: StatusFilter): Session[] {
  return sessions.filter((s) => {
    if (flow !== 'all' && s.flowType !== flow) return false
    if (status !== 'all' && s.status !== status) return false
    return matchesSearch(s, search)
  })
}

/** Shared select chrome for the flow/status filter pair — same options shape, same styling. */
function FilterSelect<T extends keyof typeof FILTER_LABELS>(props: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  label: string
}): ReactNode {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
      aria-label={props.label}
      className="ui-input sm:w-36"
    >
      {props.options.map((o) => (
        <option key={o} value={o}>
          {FILTER_LABELS[o]}
        </option>
      ))}
    </select>
  )
}

export default function History(): ReactNode {
  const { settings } = useSettings()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [search, setSearch] = useState('')
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Session list is small enough that filtering on every keystroke is cheap — no debounce needed.
  const filteredSessions = useMemo(
    () => filterSessions(sessions, search, flowFilter, statusFilter),
    [sessions, search, flowFilter, statusFilter]
  )

  function clearFilters(): void {
    setSearch('')
    setFlowFilter('all')
    setStatusFilter('all')
  }

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

      <div className="glass-card mb-4 flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transcripts and output…"
          aria-label="Search history"
          className="ui-input flex-1"
        />
        <FilterSelect value={flowFilter} options={FLOW_FILTERS} onChange={setFlowFilter} label="Filter by flow" />
        <FilterSelect value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} label="Filter by status" />
      </div>

      {filteredSessions.length === 0 ? (
        <EmptyState
          heading="No matching sessions"
          body="Try a different search term or filter."
          hint={
            <button type="button" onClick={clearFilters} className="btn-raised px-3 py-1.5 text-[12px] font-semibold text-ink-strong">
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredSessions.map((session) => {
            const flow = FLOW_CONFIG[session.flowType] ?? FLOW_CONFIG.dictation
            const isCopied = copiedId === session.id
            const isRetrying = retryingIds.has(session.id)
            const isError = session.status === 'error'
            const preview = session.output || session.dictationTranscript || session.errorMessage || 'No output'

            return (
              <div
                key={session.id}
                className={`group glass-card card-interactive px-4 py-3.5 ${isError ? 'border-stroke-strong' : ''}`}
              >
                <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[11px] font-medium tabular-nums text-ink-muted">
                      {formatTime(session.createdAt)}
                    </span>
                    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${flow.className}`}>
                      {flow.label}
                    </span>
                    {isRetrying && (
                      <span className="whitespace-nowrap rounded-full border border-stroke bg-surface-veil px-2 py-0.5 text-[11px] font-semibold text-ink-strong">
                        Retrying…
                      </span>
                    )}
                    {!isRetrying && isError && (
                      <span className="whitespace-nowrap rounded-full border border-stroke px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                        Failed
                      </span>
                    )}
                  </div>

                  {/* Row actions: visible on hover AND :focus-within — never keyboard-invisible (DESIGN §7).
                      Each button carries its own opacity-0/focus-visible/group-* reveal (majority
                      pattern shared with Replacements/Snippets/Rules) rather than a wrapper div, so a
                      button remains individually revealable even if it's ever moved out of this group. */}
                  {!isRetrying && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {session.output && (
                        <button
                          type="button"
                          onClick={() => copyOutput(session.output!, session.id)}
                          aria-label="Copy output"
                          title="Copy output"
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
                        >
                          {isCopied ? (
                            <span className="inline-flex success-pop">
                              <CheckGlyph size={14} strokeWidth={3} />
                            </span>
                          ) : (
                            <CopyGlyph size={14} />
                          )}
                        </button>
                      )}
                      {session.audioRef && (
                        <button
                          type="button"
                          onClick={() => retry(session.id)}
                          aria-label="Retry from saved audio"
                          title="Retry from saved audio"
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
                        >
                          <RetryGlyph />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteOne(session.id)}
                        aria-label="Delete session"
                        title="Delete session"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
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
      )}
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
