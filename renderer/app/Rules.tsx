import { useState, type ReactNode } from 'react'
import type { CustomRule, RulesSettings } from '../../shared/types'
import { EmptyState, PageHeader, Toggle, TrashGlyph } from '../ui'
import { useSettings } from './settingsContext'

/**
 * Rules — always-on instructions applied to every transcription when AI
 * auto-format is on. Four built-in toggles + user-authored custom rules.
 * Same immediate-persist-through-update() contract as Replacements/Snippets.
 */

const DEFAULT_RULES: RulesSettings = {
  fixGrammar: false,
  removeFillers: false,
  smartPunctuation: false,
  professionalTone: false,
  custom: []
}

type BuiltIn = 'fixGrammar' | 'removeFillers' | 'smartPunctuation' | 'professionalTone'

const BUILT_INS: { key: BuiltIn; name: string; description: string; before: string; after: string }[] = [
  { key: 'fixGrammar', name: 'Fix Grammar & Spelling', description: 'Correct grammar, spelling, and punctuation errors', before: 'i was going too the store', after: 'I was going to the store.' },
  { key: 'removeFillers', name: 'Remove Filler Words', description: "Remove 'um', 'uh', 'like', 'you know', etc.", before: 'so like, um, option A', after: 'option A' },
  { key: 'smartPunctuation', name: 'Smart Punctuation', description: 'Add proper sentence structure and punctuation', before: 'the meeting is at 3pm we need slides', after: 'The meeting is at 3pm. We need slides.' },
  { key: 'professionalTone', name: 'Professional Tone', description: 'Ensure a polished tone for business communication', before: 'hey can u send me that thing', after: 'Hi, could you please send me the document?' }
]

export default function Rules(): ReactNode {
  const { settings, update } = useSettings()
  const [draftName, setDraftName] = useState('')
  const [draftInstruction, setDraftInstruction] = useState('')

  const rules = settings?.rules ?? DEFAULT_RULES
  const custom = rules.custom ?? []

  function persist(next: Partial<RulesSettings>): void {
    update({ rules: { ...rules, ...next } })
  }

  function updateCustom(id: string, patch: Partial<Omit<CustomRule, 'id'>>): void {
    persist({ custom: custom.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  }

  function addCustom(): void {
    const name = draftName.trim()
    const instruction = draftInstruction.trim()
    if (!name || !instruction) return
    persist({ custom: [{ id: crypto.randomUUID(), name, instruction, enabled: true }, ...custom] })
    setDraftName('')
    setDraftInstruction('')
  }

  const canAdd = draftName.trim().length > 0 && draftInstruction.trim().length > 0
  const autoFormatOff = settings !== null && !settings.autoFormat

  return (
    <div>
      <PageHeader
        title="Rules"
        subtitle="Automatic cleanup applied to every transcription before it's typed."
      />

      {autoFormatOff && (
        <div className="glass-card mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <p className="text-[12px] text-ink">Rules apply only while AI auto-format is on</p>
          <button
            type="button"
            onClick={() => update({ autoFormat: true })}
            className="btn-raised whitespace-nowrap px-3 py-1.5 text-[12px] font-semibold text-ink-strong"
          >
            Enable
          </button>
        </div>
      )}

      <p className="mb-5 text-[12px] leading-relaxed text-ink-muted">
        Rules combine — enabling several applies all of them. They take effect when AI auto-format is on.
      </p>

      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">Always-on rules</h2>
      <div className="glass-card mb-6 divide-y divide-stroke px-4">
        {BUILT_INS.map((r) => (
          <div key={r.key} className="flex items-start gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-strong">{r.name}</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">{r.description}</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                <span className="line-through">{r.before}</span>
                {' → '}
                <span>{r.after}</span>
              </p>
            </div>
            <Toggle
              checked={rules[r.key]}
              onChange={(v) => persist({ [r.key]: v })}
              aria-label={r.name}
            />
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">Custom rules</h2>
      <div className="glass-card mb-5 flex flex-col gap-2.5 px-4 py-4">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Rule name (e.g. Use British spelling)"
          spellCheck={false}
          autoComplete="off"
          aria-label="Rule name"
          className="ui-input"
        />
        <textarea
          value={draftInstruction}
          onChange={(e) => setDraftInstruction(e.target.value)}
          placeholder="Instruction for the AI (e.g. Always spell words using British English conventions)"
          spellCheck={false}
          autoComplete="off"
          rows={2}
          aria-label="Rule instruction"
          className="ui-input resize-y"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addCustom}
            disabled={!canAdd}
            className="btn-raised whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold text-ink-strong disabled:opacity-40"
          >
            Add rule
          </button>
        </div>
      </div>

      {settings === null ? null : custom.length === 0 ? (
        <EmptyState
          icon={<ChecklistGlyph size={28} />}
          heading="No custom rules yet"
          body="Add your own instructions to shape every transcription."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {custom.map((rule) => (
            <div key={rule.id} className="group glass-card relative flex items-start gap-3 px-3.5 py-3.5 pr-16">
              <Toggle
                checked={rule.enabled}
                onChange={(v) => updateCustom(rule.id, { enabled: v })}
                aria-label={`Enable ${rule.name || 'rule'}`}
              />
              <div className="min-w-0 flex-1 flex flex-col gap-2">
                <input
                  value={rule.name}
                  onChange={(e) => updateCustom(rule.id, { name: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Rule name"
                  className="ui-input"
                />
                <textarea
                  value={rule.instruction}
                  onChange={(e) => updateCustom(rule.id, { instruction: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  rows={2}
                  aria-label="Rule instruction"
                  className="ui-input resize-y"
                />
              </div>
              <button
                type="button"
                onClick={() => persist({ custom: custom.filter((r) => r.id !== rule.id) })}
                aria-label="Delete rule"
                title="Delete rule"
                className="absolute right-4 top-3.5 flex h-9 w-9 items-center justify-center rounded-lg border border-stroke bg-surface-veil text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
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

function ChecklistGlyph({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 7 2 2 4-4" />
      <path d="m3 17 2 2 4-4" />
      <line x1="13" y1="6" x2="21" y2="6" />
      <line x1="13" y1="18" x2="21" y2="18" />
    </svg>
  )
}
