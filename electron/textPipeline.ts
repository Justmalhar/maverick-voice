import type { DictionaryEntry, ReplacementEntry, Snippet, VocabularyEntry } from '../shared/types'

/**
 * Special bracketed tokens STT engines emit for non-speech segments. They must
 * be stripped wherever they appear — including mid-transcript when chunked
 * dictation stitches a silent chunk between two spoken ones.
 */
const WHISPER_SENTINELS_RE = /\[\s*(?:BLANK_AUDIO|SILENCE|\*SILENCE\*|MUSIC|INAUDIBLE|NO\s*SPEECH|NOISE|SOUND|APPLAUSE|LAUGHTER)\s*\]/gi

const STT_PROMPT_HINT_MAX = 200

/**
 * Lightweight deterministic cleanup for raw dictation output — no LLM.
 * Trims, normalises whitespace, strips non-speech sentinels (anywhere in the
 * text, not just when the whole transcript is one), and removes trailing
 * hallucinations that commonly appear on terminal silence (e.g. "Thank you.",
 * "Thanks for watching.", "Please subscribe.").
 */
export function cleanTranscript(text: string): string {
  if (!text) return ''
  let t = text.replace(/\r/g, '')
  t = t.replace(WHISPER_SENTINELS_RE, ' ').trim()
  if (!t) return ''
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  t = t.replace(/[\s]*(?:thanks? for watching[.!]?|please subscribe[.!]?|thank you[.!]?)\s*$/i, '').trim()
  return t
}

/** Join per-chunk transcripts into one clean block (deterministic, no LLM). */
export function stitchChunks(transcripts: string[]): string {
  const cleaned = transcripts
    .map((t) => t.replace(WHISPER_SENTINELS_RE, ' ').trim())
    .filter(Boolean)
  return cleanTranscript(cleaned.join(' '))
}

/** Escape regex metacharacters so a `from`/`trigger` is matched literally. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function boundaryPattern(escaped: string): RegExp {
  return new RegExp(`(?<![\\w'])(?:${escaped})(?![\\w'])`, 'gi')
}

/** Apply replacement rules to a transcript — case-insensitive, longest `from` first. */
export function applyReplacements(text: string, entries: ReplacementEntry[]): string {
  if (!text || !entries.length) return text
  const ordered = entries
    .filter((e) => e && e.from && e.from.trim().length > 0 && e.to && e.to.trim().length > 0)
    .slice()
    .sort((a, b) => b.from.length - a.from.length)
  let out = text
  for (const entry of ordered) {
    const re = boundaryPattern(escapeRegex(entry.from.trim()))
    out = out.replace(re, () => entry.to)
  }
  return out
}

/** @deprecated Use applyReplacements — kept for migration from DictionaryEntry. */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  const reps: ReplacementEntry[] = entries
    .filter((e) => e?.from?.trim() && e.to !== undefined && e.to.trim())
    .map((e) => ({ id: e.id, from: e.from.trim(), to: e.to!.trim() }))
  return applyReplacements(text, reps)
}

/** Expand Snippet triggers inline — case-insensitive, longest trigger first. */
export function applySnippets(text: string, snippets: Snippet[]): string {
  if (!text || !snippets.length) return text
  const ordered = snippets
    .filter((s) => s && s.trigger && s.trigger.trim().length > 0)
    .slice()
    .sort((a, b) => b.trigger.length - a.trigger.length)
  let out = text
  for (const snip of ordered) {
    const re = boundaryPattern(escapeRegex(snip.trigger.trim()))
    out = out.replace(re, () => snip.content)
  }
  return out
}

/** Replacements → Snippets, in order (the deterministic replacement stage). */
export function applyTextPipeline(
  text: string,
  replacements: ReplacementEntry[],
  snippets: Snippet[],
): string {
  if (!text) return text
  let out = applyReplacements(text, replacements)
  out = applySnippets(out, snippets)
  return out
}

/**
 * STT vocabulary biasing hint from vocabulary terms + replacement `to` values,
 * joined and capped to ~200 chars.
 */
export function buildSttPromptHint(
  vocabulary: VocabularyEntry[],
  replacements: ReplacementEntry[],
): string | undefined {
  const seen = new Set<string>()
  const terms: string[] = []
  const addTerm = (raw: string | undefined) => {
    const term = raw?.trim()
    if (!term) return
    const key = term.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    terms.push(term)
  }
  for (const e of vocabulary) addTerm(e.term)
  for (const e of replacements) addTerm(e.to)
  if (!terms.length) return undefined
  let hint = ''
  for (const term of terms) {
    const next = hint ? `${hint}, ${term}` : term
    if (next.length > STT_PROMPT_HINT_MAX) break
    hint = next
  }
  return hint || undefined
}
