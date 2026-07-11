import { describe, it, expect } from 'vitest'
import { buildRulesBlock, BUILTIN_RULES } from './rules'
import type { RulesSettings } from '../../shared/types'

function rules(overrides: Partial<RulesSettings> = {}): RulesSettings {
  return {
    fixGrammar: false,
    removeFillers: false,
    smartPunctuation: false,
    professionalTone: false,
    custom: [],
    ...overrides
  }
}

describe('buildRulesBlock', () => {
  it('returns empty string when nothing is enabled', () => {
    expect(buildRulesBlock(rules())).toBe('')
  })

  it('includes every enabled builtin rule instruction', () => {
    const block = buildRulesBlock(
      rules({ fixGrammar: true, removeFillers: true, smartPunctuation: true, professionalTone: true })
    )
    for (const { instruction } of BUILTIN_RULES) {
      expect(block).toContain(instruction)
    }
    expect(block).toContain('USER RULES')
  })

  it('includes enabled custom rules and skips disabled ones', () => {
    const block = buildRulesBlock(
      rules({
        custom: [
          { id: '1', name: 'a', instruction: 'Always say hi.', enabled: true },
          { id: '2', name: 'b', instruction: 'Never say bye.', enabled: false }
        ]
      })
    )
    expect(block).toContain('Always say hi.')
    expect(block).not.toContain('Never say bye.')
  })

  it('skips a custom rule whose trimmed instruction is empty', () => {
    const block = buildRulesBlock(
      rules({ custom: [{ id: '1', name: 'a', instruction: '   ', enabled: true }] })
    )
    expect(block).toBe('')
  })
})
