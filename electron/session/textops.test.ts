// Vitest wrapper for the assert-based self-check (kept for dev tooling) plus
// granular per-branch tests for 100% line+branch coverage of textops.ts.
import { describe, it, expect } from 'vitest'
import { runTextopsSpec } from './textops.spec'
import {
  applyReplacements,
  applySnippets,
  buildSttPromptHint,
  cleanTranscript,
  escapeRegex,
  isJunk,
  isLLMRefusal
} from './textops'
import type { ReplacementEntry, Snippet } from '../../shared/types'

describe('textops (assert-based spec)', () => {
  it('passes', () => runTextopsSpec())
})

describe('cleanTranscript', () => {
  it('returns empty string for empty/falsy input', () => {
    expect(cleanTranscript('')).toBe('')
  })

  it('returns empty string when only sentinels remain after trim', () => {
    expect(cleanTranscript('   [BLANK_AUDIO]   ')).toBe('')
  })

  it('strips \\r characters', () => {
    expect(cleanTranscript('a\r\nb\r')).toBe('a\nb')
  })

  it('collapses 3+ newlines to a blank line', () => {
    expect(cleanTranscript('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('strips trailing "please subscribe"', () => {
    expect(cleanTranscript('great video. Please subscribe!')).toBe('great video.')
  })

  it('strips trailing bare "thank you"', () => {
    expect(cleanTranscript('nice work thank you')).toBe('nice work')
  })

  it('is idempotent', () => {
    const once = cleanTranscript('hello [MUSIC] world. Thanks for watching.')
    expect(cleanTranscript(once)).toBe(once)
  })
})

describe('escapeRegex', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegex('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\')
  })

  it('leaves plain text untouched', () => {
    expect(escapeRegex('plain text')).toBe('plain text')
  })
})

describe('applyReplacements', () => {
  it('returns input unchanged for empty text', () => {
    expect(applyReplacements('', [{ id: '1', from: 'a', to: 'b' }])).toBe('')
  })

  it('returns input unchanged for empty entries array', () => {
    expect(applyReplacements('hello', [])).toBe('hello')
  })

  it('skips entries with a blank/whitespace-only from', () => {
    const entries: ReplacementEntry[] = [{ id: '1', from: '   ', to: 'X' }]
    expect(applyReplacements('hello', entries)).toBe('hello')
  })

  it('skips entries missing a valid `from` (non-string / undefined)', () => {
    const entries = [{ id: '1', to: 'X' }] as unknown as ReplacementEntry[]
    expect(applyReplacements('hello', entries)).toBe('hello')
  })

  it('defensively skips entries whose `to` is not a string', () => {
    const entries = [{ id: '1', from: 'hello', to: undefined }] as unknown as ReplacementEntry[]
    expect(applyReplacements('hello world', entries)).toBe('hello world')
  })
})

describe('applySnippets', () => {
  it('returns input unchanged for empty text', () => {
    expect(applySnippets('', [{ id: '1', trigger: 'a', content: 'b' }])).toBe('')
  })

  it('returns input unchanged for empty snippets array', () => {
    expect(applySnippets('hello', [])).toBe('hello')
  })

  it('skips snippets with a blank trigger', () => {
    const snips: Snippet[] = [{ id: '1', trigger: '  ', content: 'X' }]
    expect(applySnippets('hello', snips)).toBe('hello')
  })

  it('skips snippets missing a valid trigger', () => {
    const snips = [{ id: '1', content: 'X' }] as unknown as Snippet[]
    expect(applySnippets('hello', snips)).toBe('hello')
  })

  it('applies the longest trigger first', () => {
    const snips: Snippet[] = [
      { id: '1', trigger: 'my link', content: 'SHORT' },
      { id: '2', trigger: 'my linkedin', content: 'LONG' }
    ]
    expect(applySnippets('see my linkedin', snips)).toBe('see LONG')
  })
})

describe('buildSttPromptHint', () => {
  it('returns undefined when no words/replacements given', () => {
    expect(buildSttPromptHint([])).toBeUndefined()
  })

  it('skips blank/whitespace-only candidates', () => {
    expect(buildSttPromptHint([{ id: '1', word: '   ' }], [])).toBeUndefined()
  })

  it('defaults the replacements arg to an empty array', () => {
    expect(buildSttPromptHint([{ id: '1', word: 'Maverick' }])).toBe('Maverick')
  })

  it('stops appending once the 200-char cap would be exceeded', () => {
    const words = [
      { id: '1', word: 'A'.repeat(190) },
      { id: '2', word: 'B'.repeat(50) }
    ]
    const hint = buildSttPromptHint(words, [])
    expect(hint).toBe('A'.repeat(190))
  })

  it('returns undefined when even the first term alone exceeds the cap', () => {
    const words = [{ id: '1', word: 'A'.repeat(250) }]
    expect(buildSttPromptHint(words, [])).toBeUndefined()
  })
})

describe('isLLMRefusal', () => {
  it('matches every anchored refusal opener pattern', () => {
    const refusals = [
      "I'm sorry, but I cannot help with that request.",
      "I am not able to do that.",
      "I can't process this request for you.",
      "As an AI, I cannot do this.",
      "I'm unable to help with that.",
      'This request contains inappropriate material.',
      "I won't fulfill that request.",
      'I must decline to do that.'
    ]
    for (const r of refusals) expect(isLLMRefusal(r)).toBe(true)
  })

  it('does not match a genuine offer to help', () => {
    expect(isLLMRefusal('I can help you plan that trip.')).toBe(false)
  })

  it('does not match ordinary text with no refusal opener', () => {
    expect(isLLMRefusal('Just a normal sentence about the weather.')).toBe(false)
  })
})

describe('isJunk', () => {
  it('treats text over the max length as non-junk regardless of content', () => {
    expect(isJunk('...............')).toBe(false)
  })

  it('treats short non-punctuation text as non-junk', () => {
    expect(isJunk('ok')).toBe(false)
  })

  it('treats short punctuation-only text as junk', () => {
    expect(isJunk('!?')).toBe(true)
  })
})
