import { useState, useEffect, useRef, useCallback } from 'react'
import type { DictionaryEntry } from '../../shared/types'

// ════════════════════════════════════════════════════════════════════════
// Dictionary.tsx — spoken-word fixes applied to dictation + instruction
// transcripts ("mavrik" -> "Maverick"). Loads once via getDictionary,
// keeps optimistic local state, and persists the WHOLE list (debounced
// ~400ms) on every change via setDictionary. Strict monochrome black glass.
// ════════════════════════════════════════════════════════════════════════

const PERSIST_DEBOUNCE_MS = 400

export default function Dictionary() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')

  // Persist debounce. Skip the very first persist (the load itself).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydrated = useRef(false)

  useEffect(() => {
    window.electronAPI
      .getDictionary()
      .then((data) => {
        setEntries(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        console.error('[dictionary] Failed to load entries:', err)
      })
      .finally(() => {
        setLoading(false)
        hydrated.current = true
      })
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  // Debounced whole-list persist on any change (after hydration).
  useEffect(() => {
    if (!hydrated.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.electronAPI.setDictionary(entries).catch((err) => {
        console.error('[dictionary] Failed to persist entries:', err)
      })
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [entries])

  const addEntry = useCallback(() => {
    const from = draftFrom.trim()
    if (!from) return
    const to = draftTo.trim() || undefined
    setEntries((prev) => [...prev, { id: crypto.randomUUID(), from, to }])
    setDraftFrom('')
    setDraftTo('')
  }, [draftFrom, draftTo])

  function updateEntry(id: string, patch: Partial<Omit<DictionaryEntry, 'id'>>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div>
      <PageHeader />

      {/* Inline add row */}
      <div className="mv-glass-card px-4 py-3.5 mb-5">
        <div className="flex items-center gap-2.5">
          <input
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addEntry()
            }}
            placeholder="mavrik"
            spellCheck={false}
            autoComplete="off"
            className="mv-input flex-1"
          />
          <ArrowGlyph />
          <input
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addEntry()
            }}
            placeholder="Maverick (optional)"
            spellCheck={false}
            autoComplete="off"
            className="mv-input flex-1"
          />
          <button
            onClick={addEntry}
            disabled={!draftFrom.trim()}
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
            <DictionaryRow
              key={entry.id}
              entry={entry}
              index={index}
              onUpdate={updateEntry}
              onDelete={deleteEntry}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Row ─── */

function DictionaryRow({
  entry,
  index,
  onUpdate,
  onDelete
}: {
  entry: DictionaryEntry
  index: number
  onUpdate: (id: string, patch: Partial<Omit<DictionaryEntry, 'id'>>) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className="group relative flex items-center gap-2.5 p-3 rounded-mv-lg border border-mv-border bg-mv-glass-panel backdrop-blur-xl transition-all duration-200 hover:border-mv-border-focus hover:bg-mv-white-04 animate-slide-in-up"
      style={{ animationDelay: `${Math.min(index, 12) * 0.04}s` }}
    >
      <input
        value={entry.from}
        onChange={(e) => onUpdate(entry.id, { from: e.target.value })}
        spellCheck={false}
        autoComplete="off"
        className="mv-input flex-1"
        aria-label="Heard as"
      />
      <ArrowGlyph />
      <input
        value={entry.to ?? ''}
        onChange={(e) => onUpdate(entry.id, { to: e.target.value || undefined })}
        spellCheck={false}
        autoComplete="off"
        placeholder="vocabulary"
        className="mv-input flex-1 placeholder:text-mv-text-muted placeholder:italic"
        aria-label="Replace with"
      />
      <button
        onClick={() => onDelete(entry.id)}
        className="w-9 h-9 shrink-0 rounded-mv-md flex items-center justify-center border bg-mv-white-04 border-mv-border text-mv-text-muted opacity-0 group-hover:opacity-100 hover:text-mv-text-primary hover:bg-mv-white-08 transition-all duration-200"
        title="Delete entry"
        aria-label="Delete entry"
      >
        <TrashGlyph />
      </button>
    </div>
  )
}

/* ─── Pieces ─── */

function PageHeader() {
  return (
    <div className="mb-6">
      <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">
        Dictionary
      </h2>
      <p className="text-[11px] text-mv-text-muted mt-1.5">
        Teach the AI your vocabulary. Add a replacement to fix mishears, or leave it blank to just register the spelling.
      </p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center mb-6 animate-card-breathe">
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-mv-text-muted"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </div>
      <p className="font-display font-bold text-mv-text-primary text-lg mb-1.5">No words yet</p>
      <p className="text-mv-text-secondary text-sm max-w-[320px] leading-relaxed">
        Fix mishears (<span className="font-mono text-mv-text-primary">mavrik</span>{' '}
        <span className="text-mv-text-muted">→</span>{' '}
        <span className="font-mono text-mv-text-primary">Maverick</span>) or add names and
        terms so the AI recognises them.
      </p>
    </div>
  )
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-2.5 py-24 justify-center">
      <div className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce" />
      <div
        className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce"
        style={{ animationDelay: '0.15s' }}
      />
      <div
        className="w-[6px] h-[6px] rounded-full bg-mv-white-48 animate-dashboard-dot-bounce"
        style={{ animationDelay: '0.3s' }}
      />
    </div>
  )
}

/* ─── Glyphs ─── */

function ArrowGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-mv-text-muted shrink-0"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  )
}

function TrashGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}
