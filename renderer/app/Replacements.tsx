import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReplacementEntry } from '../../shared/types'

const PERSIST_DEBOUNCE_MS = 400

export default function Replacements() {
  const [entries, setEntries] = useState<ReplacementEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydrated = useRef(false)

  useEffect(() => {
    window.electronAPI
      .getReplacements()
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch((err) => console.error('[replacements] load failed:', err))
      .finally(() => {
        setLoading(false)
        hydrated.current = true
      })
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.electronAPI.setReplacements(entries).catch((err) => {
        console.error('[replacements] persist failed:', err)
      })
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [entries])

  const addEntry = useCallback(() => {
    const from = draftFrom.trim()
    const to = draftTo.trim()
    if (!from || !to) return
    setEntries((prev) => [...prev, { id: crypto.randomUUID(), from, to }])
    setDraftFrom('')
    setDraftTo('')
  }, [draftFrom, draftTo])

  function updateEntry(id: string, patch: Partial<Omit<ReplacementEntry, 'id'>>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">
          Replacements
        </h2>
        <p className="text-[11px] text-mv-text-muted mt-1.5">
          Fix mishears after transcription — replace what the AI heard with what you meant.
        </p>
      </div>

      <div className="mv-glass-card px-4 py-3.5 mb-5">
        <div className="flex items-center gap-2.5">
          <input
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            placeholder="mavrik"
            spellCheck={false}
            autoComplete="off"
            className="mv-input flex-1"
          />
          <ArrowGlyph />
          <input
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            placeholder="Maverick"
            spellCheck={false}
            autoComplete="off"
            className="mv-input flex-1"
          />
          <button
            onClick={addEntry}
            disabled={!draftFrom.trim() || !draftTo.trim()}
            className="btn-glass btn-glass--primary !px-4 !py-2.5 !text-[12px] whitespace-nowrap"
          >
            Add
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingDots />
      ) : entries.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className="group relative flex items-center gap-2.5 p-3 rounded-mv-lg border border-mv-border bg-mv-glass-panel backdrop-blur-xl transition-all duration-200 hover:border-mv-border-focus hover:bg-mv-white-04 animate-slide-in-up"
              style={{ animationDelay: `${Math.min(index, 12) * 0.04}s` }}
            >
              <input
                value={entry.from}
                onChange={(e) => updateEntry(entry.id, { from: e.target.value })}
                spellCheck={false}
                className="mv-input flex-1"
                aria-label="Heard as"
              />
              <ArrowGlyph />
              <input
                value={entry.to}
                onChange={(e) => updateEntry(entry.id, { to: e.target.value })}
                spellCheck={false}
                className="mv-input flex-1"
                aria-label="Replace with"
              />
              <button
                onClick={() => deleteEntry(entry.id)}
                className="w-9 h-9 shrink-0 rounded-mv-md flex items-center justify-center border bg-mv-white-04 border-mv-border text-mv-text-muted opacity-0 group-hover:opacity-100 hover:text-mv-text-primary hover:bg-mv-white-08 transition-all duration-200"
                aria-label="Delete entry"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="font-display font-bold text-mv-text-primary text-lg mb-1.5">No replacements yet</p>
      <p className="text-mv-text-secondary text-sm max-w-[320px] leading-relaxed">
        Map mishears like <span className="font-mono">mavrik</span> → <span className="font-mono">Maverick</span>.
      </p>
    </div>
  )
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-2.5 py-24 justify-center">
      <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" />
      <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" style={{ animationDelay: '0.15s' }} />
      <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" style={{ animationDelay: '0.3s' }} />
    </div>
  )
}

function ArrowGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-mv-text-muted shrink-0">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  )
}
