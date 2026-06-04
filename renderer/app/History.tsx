import { useState, useEffect } from 'react'
import type { Session, DictationKey } from '../../shared/types'
import { IPC } from '../../shared/ipc'

// Flow badges. Monochrome ONLY — intensity (white-alpha tier) encodes emphasis
// instead of hue. dictation = brightest (primary action), transform/instruction
// = bright, context = mid, quote = dim.
const FLOW_CONFIG: Record<string, { label: string; tier: string }> = {
  dictation: { label: 'Dictation', tier: 'text-mv-text-primary bg-mv-white-12 border-mv-white-12' },
  transform: { label: 'Instruction', tier: 'text-mv-text-primary bg-mv-white-08 border-mv-white-12' },
  instruction: { label: 'Instruction', tier: 'text-mv-text-primary bg-mv-white-08 border-mv-white-12' },
  context: { label: 'Context', tier: 'text-mv-text-secondary bg-mv-white-04 border-mv-white-08' },
  quote: { label: 'Quote', tier: 'text-mv-text-secondary bg-mv-white-04 border-mv-white-08' }
}

function dictationKeyLabel(key: DictationKey): string {
  switch (key) {
    case 'fn':
      return 'Fn'
    case 'right-option':
      return 'Right Opt'
    case 'right-ctrl':
      return 'Right Ctrl'
    case 'right-alt':
      return 'Right Alt'
    default:
      return 'Fn'
  }
}

interface HistoryProps {
  /** Active dictation key for the empty-state hint. Defaults to 'fn'. */
  dictationKey?: DictationKey
}

export default function History({ dictationKey = 'fn' }: HistoryProps = {}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSessions()

    // Live-patch rows as the main process re-processes saved audio.
    window.electronAPI.onRetryStatus((sessionId, status, data) => {
      if (status === 'processing') {
        setRetryingIds((prev) => new Set(prev).add(sessionId))
      } else {
        setRetryingIds((prev) => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })
        if (data) {
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...data } : s)))
        }
      }
    })

    return () => {
      window.electronAPI.removeAllListeners(IPC.SESSION_RETRY_STATUS)
    }
  }, [])

  async function loadSessions() {
    try {
      const data = await window.electronAPI.getSessions()
      setSessions(data)
    } catch (err) {
      console.error('[history] Failed to load sessions:', err)
    } finally {
      setLoading(false)
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function copyOutput(text: string, sessionId: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(sessionId)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function retrySession(sessionId: string) {
    window.electronAPI.retrySession(sessionId)
  }

  if (loading) {
    return (
      <div>
        <PageHeader />
        <div className="flex items-center gap-2.5 py-24 justify-center">
          <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" />
          <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" style={{ animationDelay: '0.15s' }} />
          <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div>
        <PageHeader />
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center mb-6 animate-card-breathe">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mv-text-muted">
              <rect x="9" y="1" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <p className="font-display font-bold text-mv-text-primary text-lg mb-1.5">No dictations yet</p>
          <p className="text-mv-text-secondary text-sm max-w-[280px] leading-relaxed">
            Press <kbd className="kbd-3d !min-w-0 !px-2 !py-0.5">{dictationKeyLabel(dictationKey)}</kbd> anywhere to start your first dictation.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader />
      <p className="text-[11px] text-mv-text-muted -mt-4 mb-6">
        Only today's sessions are shown. Audio is kept for the last 5 recordings.
      </p>

      <div className="flex flex-col gap-2.5">
        {sessions.map((session, index) => {
          const flow = FLOW_CONFIG[session.flowType] || FLOW_CONFIG.dictation
          const isCopied = copiedId === session.id
          const isRetrying = retryingIds.has(session.id)
          const hasAudio = !!session.audioFilePath
          const isError = session.status === 'error'

          return (
            <div
              key={session.id}
              className={`group relative p-4 rounded-mv-lg border transition-all duration-200 animate-slide-in-up ${
                isRetrying
                  ? 'border-mv-border-focus bg-mv-white-04'
                  : isError
                    ? 'border-mv-white-12 bg-mv-white-04 hover:border-mv-border-focus'
                    : 'border-mv-border bg-mv-glass-panel backdrop-blur-xl hover:border-mv-border-focus hover:bg-mv-white-04'
              }`}
              style={{ animationDelay: `${Math.min(index, 12) * 0.04}s` }}
            >
              {/* Header row — meta on the left, the waveform/actions cluster on
                  the right, both vertically centered on this row. Pinning the
                  cluster here (instead of in the tall content column) keeps it
                  at the SAME position on every card regardless of how many
                  lines the transcript wraps to. */}
              <div className="flex items-center justify-between gap-3 mb-2.5 min-h-8">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-mv-text-muted font-medium tabular-nums">{formatTime(session.createdAt)}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${flow.tier}`}>
                    {flow.label}
                  </span>
                  {isRetrying ? (
                    <span className="text-[10px] font-semibold text-mv-text-primary bg-mv-white-08 border border-mv-white-12 px-2 py-0.5 rounded-full whitespace-nowrap">
                      Retrying…
                    </span>
                  ) : isError ? (
                    <span className="text-[10px] font-semibold text-mv-text-secondary bg-mv-white-04 border border-mv-white-12 px-2 py-0.5 rounded-full whitespace-nowrap">
                      Failed
                    </span>
                  ) : null}
                </div>

                {/* Right slot — fixed width so the waveform (default) and the
                    hover actions occupy the exact same footprint and never
                    shift the layout. */}
                {!isRetrying && (
                  <div className="relative flex items-center justify-end shrink-0 h-8 w-[72px]">
                    {/* Static waveform decoration — fades out on hover. */}
                    <div className="flex items-center gap-[2px] opacity-[0.12] group-hover:opacity-0 transition-opacity duration-200">
                      {[6, 14, 10, 18, 8, 16, 12, 20].map((h, i) => (
                        <div key={i} className="w-[2.5px] rounded-sm bg-mv-white" style={{ height: `${h}px` }} />
                      ))}
                    </div>

                    {/* Row actions — fade in on hover, overlaid in the same slot. */}
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
                      {session.output && (
                        <button
                          onClick={() => copyOutput(session.output!, session.id)}
                          className={`w-8 h-8 rounded-mv-md flex items-center justify-center border transition-all duration-200 ${
                            isCopied
                              ? 'bg-mv-white-12 border-mv-border-focus text-mv-text-primary'
                              : 'bg-mv-white-04 border-mv-border text-mv-text-muted hover:text-mv-text-primary hover:bg-mv-white-08'
                          }`}
                          title="Copy output"
                        >
                          {isCopied ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      )}
                      {hasAudio && (
                        <button
                          onClick={() => retrySession(session.id)}
                          className="w-8 h-8 rounded-mv-md flex items-center justify-center border bg-mv-white-04 border-mv-border text-mv-text-muted hover:text-mv-text-primary hover:bg-mv-white-08 transition-all duration-200"
                          title="Re-process from saved audio"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Output / re-processing state — full width below the header. */}
              {isRetrying ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-[3px]">
                    {[6, 14, 10, 18, 8, 16, 12, 20].map((h, i) => (
                      <div
                        key={i}
                        className="w-[2.5px] rounded-sm bg-mv-white-72 animate-dashboard-dot-bounce"
                        style={{ height: `${h}px`, animationDelay: `${i * 0.1}s` }}
                      />
                    ))}
                  </div>
                  <span className="text-[13px] text-mv-text-secondary font-medium">Re-processing audio…</span>
                </div>
              ) : (
                <p className="text-[13px] text-mv-text-primary leading-relaxed line-clamp-2">
                  {session.output || session.dictationTranscript || session.errorMessage || 'No output'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PageHeader() {
  return (
    <div className="mb-6">
      <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">History</h2>
    </div>
  )
}
