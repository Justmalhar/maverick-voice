import { useState, type ReactNode } from 'react'
import type { Snippet } from '../../shared/types'
import { EmptyState, PageHeader, TrashGlyph } from '../ui'
import { useSettings } from './settingsContext'

/**
 * Snippets — spoken triggers expanded inline ("my linkedin" -> a URL).
 * Same immediate-persist-on-commit contract as Dictionary.tsx (v1 #13 fix).
 */
export default function Snippets(): ReactNode {
  const { settings, update } = useSettings()
  const [draftTrigger, setDraftTrigger] = useState('')
  const [draftContent, setDraftContent] = useState('')

  const snippets = settings?.snippets ?? []

  function persist(next: Snippet[]): void {
    update({ snippets: next })
  }

  function updateLocal(id: string, patch: Partial<Omit<Snippet, 'id'>>): void {
    update({ snippets: snippets.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  function commitEdit(): void {
    void window.electronAPI.setSnippets(snippets).catch(() => console.error('[snippets] failed to persist'))
  }

  function addSnippet(): void {
    const trigger = draftTrigger.trim()
    const content = draftContent.trim()
    if (!trigger || !content) return
    persist([{ id: crypto.randomUUID(), trigger, content }, ...snippets])
    setDraftTrigger('')
    setDraftContent('')
  }

  function deleteSnippet(id: string): void {
    persist(snippets.filter((s) => s.id !== id))
  }

  const canAdd = draftTrigger.trim().length > 0 && draftContent.trim().length > 0

  return (
    <div>
      <PageHeader title="Snippets" subtitle="Short phrases that expand into longer text as you dictate." />

      <div className="glass-card mb-5 flex flex-col gap-2.5 px-4 py-3.5">
        <Field label="Say">
          <input
            value={draftTrigger}
            onChange={(e) => setDraftTrigger(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSnippet()}
            placeholder="my linkedin"
            spellCheck={false}
            autoComplete="off"
            aria-label="Trigger phrase"
            className="ui-input flex-1"
          />
        </Field>
        <Field label="Types" alignTop>
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            placeholder="https://linkedin.com/in/justmalhar"
            spellCheck={false}
            autoComplete="off"
            rows={2}
            aria-label="Expansion content"
            className="ui-input flex-1 resize-y font-mono"
          />
        </Field>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addSnippet}
            disabled={!canAdd}
            className="btn-raised whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold text-ink-strong disabled:opacity-40"
          >
            Add snippet
          </button>
        </div>
      </div>

      {settings === null ? null : snippets.length === 0 ? (
        <EmptyState
          icon={<ExpandGlyph size={28} />}
          heading="No snippets yet"
          body='Say "my linkedin" and the app types your URL.'
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {snippets.map((snippet) => (
            <div key={snippet.id} className="group glass-card relative flex flex-col gap-2.5 px-5 py-4 pr-16">
              <button
                type="button"
                onClick={() => deleteSnippet(snippet.id)}
                aria-label="Delete snippet"
                title="Delete snippet"
                className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <TrashGlyph size={14} />
              </button>
              <Field label="Say">
                <input
                  value={snippet.trigger}
                  onChange={(e) => updateLocal(snippet.id, { trigger: e.target.value })}
                  onBlur={commitEdit}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Trigger phrase"
                  className="ui-input flex-1"
                />
              </Field>
              <Field label="Types" alignTop>
                <textarea
                  value={snippet.content}
                  onChange={(e) => updateLocal(snippet.id, { content: e.target.value })}
                  onBlur={commitEdit}
                  spellCheck={false}
                  autoComplete="off"
                  rows={2}
                  aria-label="Expansion content"
                  className="ui-input flex-1 resize-y font-mono"
                />
              </Field>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExpandGlyph({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function Field({ label, alignTop, children }: { label: string; alignTop?: boolean; children: ReactNode }): ReactNode {
  return (
    <div className={`flex ${alignTop ? 'items-start' : 'items-center'} gap-2.5`}>
      <span className={`w-14 shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted ${alignTop ? 'mt-3' : ''}`}>
        {label}
      </span>
      {children}
    </div>
  )
}
