import { useState, useEffect, useRef, useCallback } from 'react'
import type { Snippet } from '../../shared/types'

// ════════════════════════════════════════════════════════════════════════
// Snippets.tsx — spoken triggers expanded inline ("my linkedin" -> a URL).
// Loads once via getSnippets, keeps optimistic local state, persists the
// WHOLE list (debounced ~400ms) on every change via setSnippets. Content may
// be multiline. Strict monochrome black glass.
// ════════════════════════════════════════════════════════════════════════

const PERSIST_DEBOUNCE_MS = 400

export default function Snippets() {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [loading, setLoading] = useState(true)
  const [draftTrigger, setDraftTrigger] = useState('')
  const [draftContent, setDraftContent] = useState('')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydrated = useRef(false)

  useEffect(() => {
    window.electronAPI
      .getSnippets()
      .then((data) => {
        setSnippets(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        console.error('[snippets] Failed to load snippets:', err)
      })
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
      window.electronAPI.setSnippets(snippets).catch((err) => {
        console.error('[snippets] Failed to persist snippets:', err)
      })
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [snippets])

  const addSnippet = useCallback(() => {
    const trigger = draftTrigger.trim()
    const content = draftContent.trim()
    if (!trigger || !content) return
    setSnippets((prev) => [...prev, { id: crypto.randomUUID(), trigger, content }])
    setDraftTrigger('')
    setDraftContent('')
  }, [draftTrigger, draftContent])

  function updateSnippet(id: string, patch: Partial<Omit<Snippet, 'id'>>) {
    setSnippets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function deleteSnippet(id: string) {
    setSnippets((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <div>
      <PageHeader />

      {/* Inline add card */}
      <div className="mv-glass-card px-4 py-4 mb-5">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-mv-text-muted w-[64px] shrink-0">
              Say
            </span>
            <input
              value={draftTrigger}
              onChange={(e) => setDraftTrigger(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addSnippet()
              }}
              placeholder="my linkedin"
              spellCheck={false}
              autoComplete="off"
              className="mv-input flex-1"
            />
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-mv-text-muted w-[64px] shrink-0 mt-3">
              Types
            </span>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder="https://linkedin.com/in/justmalhar"
              spellCheck={false}
              autoComplete="off"
              rows={2}
              className="mv-input flex-1 resize-y !font-mono"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={addSnippet}
              disabled={!draftTrigger.trim() || !draftContent.trim()}
              className="btn-glass btn-glass--primary !px-5 !py-2.5 !text-[12px] whitespace-nowrap"
            >
              Add snippet
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingDots />
      ) : snippets.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2.5">
          {snippets.map((snippet, index) => (
            <SnippetCard
              key={snippet.id}
              snippet={snippet}
              index={index}
              onUpdate={updateSnippet}
              onDelete={deleteSnippet}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Card ─── */

function SnippetCard({
  snippet,
  index,
  onUpdate,
  onDelete
}: {
  snippet: Snippet
  index: number
  onUpdate: (id: string, patch: Partial<Omit<Snippet, 'id'>>) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className="group relative p-3.5 rounded-mv-lg border border-mv-border bg-mv-glass-panel backdrop-blur-xl transition-all duration-200 hover:border-mv-border-focus hover:bg-mv-white-04 animate-slide-in-up"
      style={{ animationDelay: `${Math.min(index, 12) * 0.04}s` }}
    >
      <button
        onClick={() => onDelete(snippet.id)}
        className="absolute top-3 right-3 w-9 h-9 rounded-mv-md flex items-center justify-center border bg-mv-white-04 border-mv-border text-mv-text-muted opacity-0 group-hover:opacity-100 hover:text-mv-text-primary hover:bg-mv-white-08 transition-all duration-200"
        title="Delete snippet"
        aria-label="Delete snippet"
      >
        <TrashGlyph />
      </button>

      <div className="flex flex-col gap-2.5 pr-11">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-mv-text-muted w-[64px] shrink-0">
            Say
          </span>
          <input
            value={snippet.trigger}
            onChange={(e) => onUpdate(snippet.id, { trigger: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            className="mv-input flex-1"
            aria-label="Trigger phrase"
          />
        </div>
        <div className="flex items-start gap-2.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-mv-text-muted w-[64px] shrink-0 mt-3">
            Types
          </span>
          <textarea
            value={snippet.content}
            onChange={(e) => onUpdate(snippet.id, { content: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            rows={2}
            className="mv-input flex-1 resize-y !font-mono"
            aria-label="Expansion content"
          />
        </div>
      </div>
    </div>
  )
}

/* ─── Pieces ─── */

function PageHeader() {
  return (
    <div className="mb-6">
      <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">
        Snippets
      </h2>
      <p className="text-[11px] text-mv-text-muted mt-1.5">
        Short phrases that expand into longer text as you dictate.
      </p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mv-glass-card w-20 h-20 !rounded-mv-xl flex items-center justify-center mb-6 animate-card-breathe">
        <BoltGlyph />
      </div>
      <p className="font-display font-bold text-mv-text-primary text-lg mb-1.5">No snippets yet</p>
      <p className="text-mv-text-secondary text-sm max-w-[320px] leading-relaxed">
        Say <span className="font-mono text-mv-text-primary">my linkedin</span> and Maverick types
        your URL.
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

function BoltGlyph() {
  return (
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
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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
