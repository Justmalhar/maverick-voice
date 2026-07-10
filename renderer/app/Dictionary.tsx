import { useState, type ReactNode } from 'react'
import type { DictionaryWord } from '../../shared/types'
import { EmptyState, PageHeader } from '../ui'
import { useSettings } from './settingsContext'

/**
 * Dictionary — single vocabulary words that bias the STT model toward the
 * right spelling (names, jargon, product terms). Words never rewrite the
 * transcript; from→to rewrites live in Replacements. Persists the WHOLE list
 * IMMEDIATELY on every commit (add / delete) — no debounce (v1 #13).
 */
export default function Dictionary(): ReactNode {
  const { settings, update } = useSettings()
  const [draft, setDraft] = useState('')

  const words = settings?.dictionary ?? []

  function persist(next: DictionaryWord[]): void {
    update({ dictionary: next })
  }

  function addWords(): void {
    // Split on whitespace/commas so pasting "Groq, Tailwind uv" adds three
    // single words — the dictionary holds words, never phrases.
    const tokens = draft.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)
    if (!tokens.length) return
    const existing = new Set(words.map((w) => w.word.toLowerCase()))
    const fresh: DictionaryWord[] = []
    for (const token of tokens) {
      const key = token.toLowerCase()
      if (existing.has(key)) continue
      existing.add(key)
      fresh.push({ id: crypto.randomUUID(), word: token })
    }
    if (fresh.length) persist([...fresh, ...words])
    setDraft('')
  }

  function deleteWord(id: string): void {
    persist(words.filter((w) => w.id !== id))
  }

  const canAdd = draft.trim().length > 0

  return (
    <div>
      <PageHeader
        title="Dictionary"
        subtitle="Teach the app your vocabulary — names, jargon, and terms it should recognize and spell correctly."
      />

      <div className="glass-card mb-5 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <label className="sr-only" htmlFor="dict-draft">Word</label>
          <input
            id="dict-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addWords()}
            placeholder="Maverick"
            spellCheck={false}
            autoComplete="off"
            className="ui-input flex-1"
          />
          <button
            type="button"
            onClick={addWords}
            disabled={!canAdd}
            className="btn-raised whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold text-ink-strong disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <p className="mt-2 px-0.5 text-[11px] text-ink-faint">
          Single words only — separate several with spaces or commas. To rewrite phrases, use Replacements.
        </p>
      </div>

      {settings === null ? null : words.length === 0 ? (
        <EmptyState
          heading="No words yet"
          body="Add names, brands, and technical terms so transcription spells them right."
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {words.map((entry) => (
            <span
              key={entry.id}
              className="group glass-card inline-flex items-center gap-1.5 rounded-full py-1.5 pr-1.5 pl-3 text-[12.5px] font-medium text-ink"
            >
              {entry.word}
              <button
                type="button"
                onClick={() => deleteWord(entry.id)}
                aria-label={`Remove ${entry.word}`}
                title={`Remove ${entry.word}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-veil hover:text-ink"
              >
                <CrossGlyph />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function CrossGlyph(): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
      <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
    </svg>
  )
}
