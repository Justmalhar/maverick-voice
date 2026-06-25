import { describe, expect, it } from 'vitest'
import {
  cleanTranscript,
  applyReplacements,
  applySnippets,
  buildSttPromptHint,
} from './textPipeline'
import type { ReplacementEntry, Snippet, VocabularyEntry } from '../shared/types'

describe('cleanTranscript', () => {
  it('strips trailing thank-you hallucinations', () => {
    expect(cleanTranscript('Hello world thank you')).toBe('Hello world')
  })

  it('removes whisper sentinel phrases', () => {
    expect(cleanTranscript('Thanks for watching.')).toBe('')
  })
})

describe('applyReplacements', () => {
  const entries: ReplacementEntry[] = [
    { id: '1', from: 'mavrik', to: 'Maverick' },
    { id: '2', from: 'teh', to: 'the' },
  ]

  it('applies longest match first with word boundaries', () => {
    expect(applyReplacements('say mavrik and teh code', entries)).toBe('say Maverick and the code')
  })
})

describe('applySnippets', () => {
  const snippets: Snippet[] = [{ id: '1', trigger: 'my email', content: 'hello@example.com' }]

  it('expands trigger phrases case-insensitively', () => {
    expect(applySnippets('Send My Email please', snippets)).toBe('Send hello@example.com please')
  })
})

describe('buildSttPromptHint', () => {
  it('joins distinct vocabulary and replacement targets capped at ~200 chars', () => {
    const vocabulary: VocabularyEntry[] = [{ id: '1', term: 'Maverick' }]
    const replacements: ReplacementEntry[] = [{ id: '2', from: 'x', to: 'Mobiiworld' }]
    expect(buildSttPromptHint(vocabulary, replacements)).toBe('Maverick, Mobiiworld')
  })

  it('returns undefined when empty', () => {
    expect(buildSttPromptHint([], [])).toBeUndefined()
  })
})
