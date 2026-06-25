import { useState, useEffect, useCallback } from 'react'
import type { ErrorEntry } from '../../../shared/types'
import { ChevronIcon, CogIcon } from './settingsUi'

const MAX_VISIBLE = 50

export default function SettingsDeveloper() {
  const [open, setOpen] = useState(false)
  const [errorLog, setErrorLog] = useState<ErrorEntry[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const entries = await window.electronAPI.getErrorLog()
      setErrorLog(entries)
    } catch {
      setErrorLog([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    const onEntry = (entry: ErrorEntry) => {
      setErrorLog((prev) => [entry, ...prev].slice(0, MAX_VISIBLE))
    }
    window.electronAPI.onDevErrorLog(onEntry)
    return () => window.electronAPI.removeAllListeners('dev:error-log')
  }, [open, refresh])

  return (
    <div className="mv-glass-card overflow-hidden mb-3 mt-6">
      <button
        className="mv-disclosure__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0 text-left">
          <div className="mv-section-label !mb-0 !mt-0">
            <span className="text-mv-text-muted">
              <CogIcon />
            </span>
            Developer
          </div>
          <p className="text-[11px] text-mv-text-muted mt-1">
            Local error log for debugging pipeline failures
          </p>
        </div>
        <span className={`mv-disclosure__chevron ${open ? 'mv-disclosure__chevron--open' : ''}`}>
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div className="border-t border-mv-border px-5 py-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <p className="text-[12px] text-mv-text-secondary leading-relaxed max-w-md">
              Recent main-process errors (newest first). Useful when a session fails silently or an API call errors out.
            </p>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="btn-glass !px-4 !py-2 !text-[12px] shrink-0"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {errorLog.length === 0 ? (
            <p className="text-[11px] text-mv-text-muted">No errors recorded yet.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-mv-md border border-mv-border bg-mv-white-02">
              {errorLog.slice(0, MAX_VISIBLE).map((entry, i) => (
                <div key={`${entry.timestamp}-${entry.source}-${i}`} className="px-3 py-2 border-b border-mv-border last:border-b-0">
                  <p className="text-[10px] font-mono text-mv-text-muted">
                    {entry.timestamp} · {entry.source}
                  </p>
                  <p className="text-[11px] text-mv-text-secondary mt-0.5 break-words">{entry.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
