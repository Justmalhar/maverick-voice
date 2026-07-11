import { useState, type ReactNode } from 'react'
import type { ReplacementEntry } from '../../shared/types'
import { EmptyState, PageHeader, TrashGlyph } from '../ui'
import { useSettings } from './settingsContext'

/**
 * Replacements — from→to text rewrites applied to dictation + instruction
 * transcripts. Persists the WHOLE list IMMEDIATELY on every commit (blur /
 * Enter / add / delete) — no debounce to cancel and lose edits on tab switch
 * (v1 #13; tabs also stay mounted in v2 so there's no unmount-losing-a-timer
 * risk either). Reads/writes through the shared SettingsContext.
 */
export default function Replacements(): ReactNode {
  const { settings, update } = useSettings()
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')

  const entries = settings?.replacements ?? []

  function persist(next: ReplacementEntry[]): void {
    update({ replacements: next })
  }

  function updateLocal(id: string, patch: Partial<Omit<ReplacementEntry, 'id'>>): void {
    update({ replacements: entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }

  function commitEdit(): void {
    // Local state already reflects the edit (updateLocal ran on change); this
    // just re-sends the current whole list on blur/Enter to satisfy the
    // "persist on commit" contract even if update() batching changes later.
    void window.electronAPI.setReplacements(entries).catch(() => console.error('[replacements] failed to persist'))
  }

  function addEntry(): void {
    const from = draftFrom.trim()
    const to = draftTo.trim()
    if (!from || !to) return
    persist([{ id: crypto.randomUUID(), from, to }, ...entries])
    setDraftFrom('')
    setDraftTo('')
  }

  function deleteEntry(id: string): void {
    persist(entries.filter((e) => e.id !== id))
  }

  const canAdd = draftFrom.trim().length > 0 && draftTo.trim().length > 0

  return (
    <div>
      <PageHeader
        title="Replacements"
        subtitle="Rewrite what was heard into what should be typed — fix mishears, expand shorthand."
      />

      <div className="glass-card mb-5 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <label className="sr-only" htmlFor="repl-draft-from">Heard as</label>
          <input
            id="repl-draft-from"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            placeholder="mavrik"
            spellCheck={false}
            autoComplete="off"
            className="ui-input flex-1"
          />
          <ArrowGlyph />
          <label className="sr-only" htmlFor="repl-draft-to">Replace with</label>
          <input
            id="repl-draft-to"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            placeholder="Maverick"
            spellCheck={false}
            autoComplete="off"
            className="ui-input flex-1"
          />
          <button
            type="button"
            onClick={addEntry}
            disabled={!canAdd}
            className="btn-raised whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold text-ink-strong disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      {settings === null ? null : entries.length === 0 ? (
        <EmptyState
          icon={<SwapGlyph size={28} />}
          heading="No replacements yet"
          body="Map what you say to what should be typed (mavrik → Maverick)."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map((entry) => (
            <div key={entry.id} className="group glass-card flex items-center gap-2.5 px-5 py-4">
              <input
                value={entry.from}
                onChange={(e) => updateLocal(entry.id, { from: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                spellCheck={false}
                autoComplete="off"
                aria-label="Heard as"
                className="ui-input flex-1"
              />
              <ArrowGlyph />
              <input
                value={entry.to}
                onChange={(e) => updateLocal(entry.id, { to: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                spellCheck={false}
                autoComplete="off"
                aria-label="Replace with"
                className="ui-input flex-1"
              />
              <button
                type="button"
                onClick={() => deleteEntry(entry.id)}
                aria-label="Delete entry"
                title="Delete entry"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <TrashGlyph size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SwapGlyph({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function ArrowGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-faint" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  )
}
