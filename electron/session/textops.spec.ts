// ─── electron/session/textops.spec.ts — assert-based self-check ───
// Not imported at runtime. Invoke runTextopsSpec() from dev tooling (or a
// future test runner); it throws on the first failing assertion.
// ponytail: plain asserts instead of a test framework — wire into vitest/jest
// when the project grows a real suite.

import assert from 'node:assert'
import {
  applyReplacements,
  applySnippets,
  buildSttPromptHint,
  cleanTranscript,
  isJunk,
  isLLMRefusal
} from './textops'
import type { ReplacementEntry, Snippet } from '../../shared/types'

export function runTextopsSpec(): void {
  // ── cleanTranscript: sentinel stripping ──
  assert.strictEqual(cleanTranscript('[BLANK_AUDIO]'), '')
  assert.strictEqual(cleanTranscript('hello [SILENCE] world'), 'hello world')
  assert.strictEqual(cleanTranscript('note [ NO SPEECH ] here'), 'note here')
  assert.strictEqual(cleanTranscript('done. Thanks for watching.'), 'done.')
  assert.strictEqual(cleanTranscript('a\r\nb'), 'a\nb')
  assert.strictEqual(cleanTranscript('a   b \t c'), 'a b c') // runs of 2+ collapse; single tab/space kept

  // ── applyReplacements: longest-first + punctuation tolerance ──
  const repl: ReplacementEntry[] = [
    { id: '1', from: 'mac', to: 'Mac' },
    { id: '2', from: 'mac book pro', to: 'MacBook Pro' }
  ]
  assert.strictEqual(applyReplacements('i love my mac book pro.', repl), 'i love my MacBook Pro.')
  assert.strictEqual(applyReplacements('(mac)', repl), '(Mac)')
  // no match inside a longer word
  assert.strictEqual(applyReplacements('machine', repl), 'machine')
  // case-insensitive; regex specials in `from` are escaped
  assert.strictEqual(
    applyReplacements('use c++ now', [{ id: '3', from: 'c++', to: 'C++' }]),
    'use C++ now'
  )
  // `$` in `to` is literal, not a backreference
  assert.strictEqual(
    applyReplacements('price', [{ id: '4', from: 'price', to: '$1.50' }]),
    '$1.50'
  )

  // ── applySnippets: expansion with adjacent punctuation ──
  const snips: Snippet[] = [{ id: '1', trigger: 'my linkedin', content: 'linkedin.com/in/justmalhar' }]
  assert.strictEqual(applySnippets('check my linkedin.', snips), 'check linkedin.com/in/justmalhar.')
  assert.strictEqual(applySnippets('MY LINKEDIN', snips), 'linkedin.com/in/justmalhar')

  // ── buildSttPromptHint: words + replacement targets, deduped, ~200-char cap ──
  assert.strictEqual(buildSttPromptHint([], []), undefined)
  assert.strictEqual(
    buildSttPromptHint(
      [{ id: 'w1', word: 'Maverick' }],
      [
        { id: '1', from: 'mavrik', to: 'Maverick' }, // duplicate of the word — deduped
        { id: '2', from: 'jira', to: '' } // empty `to` falls back to `from`
      ]
    ),
    'Maverick, jira'
  )
  const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i), word: `Correction${i}` }))
  const hint = buildSttPromptHint(many, [])
  assert.ok(hint !== undefined && hint.length <= 200, `hint capped at 200, got ${hint?.length}`)

  // ── isLLMRefusal: anchored — v1 false positives fixed ──
  assert.strictEqual(isLLMRefusal("I'm sorry, I can't assist with that."), true)
  assert.strictEqual(isLLMRefusal('I cannot help with that request.'), true)
  assert.strictEqual(isLLMRefusal('As an AI, I cannot process this.'), true)
  assert.strictEqual(isLLMRefusal('I must decline this request.'), true)
  // curly-quote normalization
  assert.strictEqual(isLLMRefusal('I’m sorry, I can’t assist with that.'), true)
  // the v1 false positives (LEGACY-ISSUES §3 item 10):
  assert.strictEqual(isLLMRefusal("I can't help feeling that this is right."), false)
  assert.strictEqual(isLLMRefusal("I can't help but admire the design."), false)
  assert.strictEqual(isLLMRefusal('Working as an AI engineer taught me a lot.'), false)
  assert.strictEqual(
    isLLMRefusal('The report says the model replied "I cannot help" twice.'),
    false
  )
  // genuine offer of help must not match
  assert.strictEqual(isLLMRefusal('I can help you with that tomorrow.'), false)

  // ── isJunk: APP_CONFIG.junk_detection thresholds ──
  assert.strictEqual(isJunk(''), true)
  assert.strictEqual(isJunk('. '), true)
  assert.strictEqual(isJunk('hi'), false) // length ≤ 2 but not punctuation-only
  assert.strictEqual(isJunk('hello world'), false)

  console.log('[textops] spec passed')
}
