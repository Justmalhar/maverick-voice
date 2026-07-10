// ─── electron/session/textops.ts — pure text-pipeline functions ───
// Ported from v1 sessionManager.ts (semantics + tuned constants, not structure).
// Order in the pipeline is load-bearing: cleanTranscript → applyReplacements →
// applySnippets → optional auto-format. No side effects; unit-testable
// (see textops.spec.ts). Never log transcript text.

import type { DictionaryWord, ReplacementEntry, Snippet } from '../../shared/types'
import { APP_CONFIG } from '../config'

/**
 * Special bracketed tokens STT engines emit for non-speech segments. Stripped
 * wherever they appear — including mid-transcript when chunked dictation
 * stitches a silent chunk between two spoken ones. (v1 verbatim.)
 */
const WHISPER_SENTINELS_RE =
  /\[\s*(?:BLANK_AUDIO|SILENCE|\*SILENCE\*|MUSIC|INAUDIBLE|NO\s*SPEECH|NOISE|SOUND|APPLAUSE|LAUGHTER)\s*\]/gi

/**
 * Lightweight deterministic cleanup for raw dictation output — no LLM.
 * Trims, normalises whitespace, strips non-speech sentinels, and removes
 * trailing hallucinations that commonly appear on terminal silence
 * ("Thank you.", "Thanks for watching.", "Please subscribe."). Idempotent.
 */
export function cleanTranscript(text: string): string {
  if (!text) return ''
  let t = text.replace(/\r/g, '')
  // Drop sentinels wherever they appear (chunk-level or whole-string).
  t = t.replace(WHISPER_SENTINELS_RE, ' ').trim()
  if (!t) return ''
  // normalise runs of spaces/tabs and excessive blank lines
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  // strip well-known trailing STT hallucinations on silence
  t = t.replace(/[\s]*(?:thanks? for watching[.!]?|please subscribe[.!]?|thank you[.!]?)\s*$/i, '').trim()
  return t
}

/** Escape regex metacharacters so a `from`/`trigger` is matched literally. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word-boundary regex tolerant of punctuation adjacency. JS `\b` is unreliable
 * around non-ASCII and breaks on tokens that start/end with a regex metaclass,
 * so we anchor on "start-of-string or a non-word, non-apostrophe character"
 * lookbehind/lookahead. Matches "mavrik" in "mavrik." / "(mavrik)" /
 * "say mavrik" but NOT inside "mavriking". The apostrophe carve-out keeps
 * contractions (e.g. "it's") from being split mid-token. (v1 verbatim.)
 */
function boundaryPattern(escaped: string): RegExp {
  return new RegExp(`(?<![\\w'])(?:${escaped})(?![\\w'])`, 'gi')
}

/**
 * Apply text Replacements to a transcript.
 *  - case-insensitive
 *  - word-boundary match tolerant of adjacent punctuation
 *  - regex specials in `from` escaped
 *  - LONGEST `from` applied first (so "mac book pro" beats "mac")
 * Entries with an empty `from` are skipped.
 */
export function applyReplacements(text: string, entries: ReplacementEntry[]): string {
  if (!text || !entries.length) return text
  const ordered = entries
    .filter((e) => e && typeof e.from === 'string' && e.from.trim().length > 0)
    .slice()
    .sort((a, b) => b.from.length - a.from.length)
  let out = text
  for (const entry of ordered) {
    // Defensive: types require `to`, but renderer-supplied data is a trust
    // boundary — a malformed entry must not throw mid-pipeline.
    if (typeof entry.to !== 'string') continue
    const re = boundaryPattern(escapeRegex(entry.from.trim()))
    // Replacer function so `$` sequences in `to` (e.g. a price) are not
    // interpreted as regex backreferences.
    out = out.replace(re, () => entry.to)
  }
  return out
}

/**
 * Expand Snippet triggers inline.
 *  - case-insensitive
 *  - tolerant of adjacent punctuation (same boundary rule as the dictionary,
 *    so "my linkedin." expands and keeps the trailing period)
 *  - LONGEST `trigger` applied first
 * Entries with an empty `trigger` are skipped.
 */
export function applySnippets(text: string, snippets: Snippet[]): string {
  if (!text || !snippets.length) return text
  const ordered = snippets
    .filter((s) => s && typeof s.trigger === 'string' && s.trigger.trim().length > 0)
    .slice()
    .sort((a, b) => b.trigger.length - a.trigger.length)
  let out = text
  for (const snip of ordered) {
    const re = boundaryPattern(escapeRegex(snip.trigger.trim()))
    out = out.replace(re, () => snip.content)
  }
  return out
}

/**
 * STT vocabulary biasing hint: dictionary words first, then replacement `to`
 * spellings (`from` as fallback), joined and capped to ~200 chars. Passed as
 * the Whisper `prompt` so the STT model biases toward these spellings — the
 * ONLY sanctioned Whisper prompt (silence-parroting concern bans arbitrary
 * prompts).
 */
const STT_PROMPT_HINT_MAX = 200

export function buildSttPromptHint(words: DictionaryWord[], replacements: ReplacementEntry[] = []): string | undefined {
  const candidates = [
    ...words.map((w) => w?.word),
    ...replacements.map((e) => e?.to || e?.from)
  ]
  const seen = new Set<string>()
  const terms: string[] = []
  for (const candidate of candidates) {
    const term = candidate?.trim()
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  if (!terms.length) return undefined
  let hint = ''
  for (const term of terms) {
    const next = hint ? `${hint}, ${term}` : term
    if (next.length > STT_PROMPT_HINT_MAX) break
    hint = next
  }
  return hint || undefined
}

// ─── LLM refusal detection ───
// v1 patterns ported, but ANCHORED to the start of the reply — v1 matched
// anywhere in the text and discarded correct transforms that merely contained
// phrases like "I can't help feeling…" or "as an AI" mid-sentence
// (LEGACY-ISSUES §3 item 10). A refusal is an OPENING move; a legitimate
// transform never begins with one.
//
// The "(?!\s+(?:but\b|\w+ing\b))" lookahead excludes the English idiom
// "can't help feeling / can't help but", which is not a refusal even when it
// opens the reply.
// ponytail: catch-all phrases v1 matched free-floating ("against my
// guidelines", "not appropriate") are folded into anchored openers; add a
// first-sentence scan only if real refusals slip through.
const REFUSAL_OPENERS: RegExp[] = [
  /^i(?:'m| am) sorry\b.{0,30}?\b(?:can't|cannot|can not|unable to|not able to|won't|will not|not appropriate|against my)/,
  /^i(?:'m| am) not able to\b/,
  /^i (?:can't|cannot|can not) (?:help|assist)(?!\s+(?:but\b|\w+ing\b))/,
  /^i (?:can't|cannot|can not) (?:process|generate|create|produce|write|provide|do that)/,
  /^as an ai\b.{0,30}\b(?:can't|cannot|can not|unable)/,
  /^i(?:'m| am) unable to (?:help|assist|process|fulfill|comply)/,
  /^this (?:content|text|request|input) (?:is|contains|includes|involves).{0,30}(?:inappropriate|harmful|offensive|violent|abusive)/,
  /^i (?:can't|cannot|can not|won't|will not) (?:fulfill|comply|process) (?:this|that|your)/,
  /^i (?:must|have to) (?:decline|refuse|refrain)/
]

/**
 * Detect LLM refusal responses — safety guardrails that refuse to process the
 * user's dictation. In a voice-to-text app the user dictates their own words
 * and the LLM should never censor them; on refusal we fall back to the raw
 * transcript. Anchored to the reply start (see note above).
 */
export function isLLMRefusal(text: string): boolean {
  // Normalize smart/curly quotes to straight quotes — LLMs often return
  // Unicode quotes (v1 verbatim).
  const lower = text
    .toLowerCase()
    .trim()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
  return REFUSAL_OPENERS.some((pattern) => pattern.test(lower))
}

// ─── Junk guard ───
const JUNK_RE = new RegExp(APP_CONFIG.junk_detection.pattern)

/**
 * True when a transcript is empty/junk (e.g. just punctuation from a breath).
 * Thresholds come from APP_CONFIG.junk_detection (tuned v1 values).
 */
export function isJunk(text: string): boolean {
  return text.length <= APP_CONFIG.junk_detection.max_length && JUNK_RE.test(text)
}
