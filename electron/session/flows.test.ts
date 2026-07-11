import { describe, it, expect } from 'vitest'
import { determineFlowType, type FlowInputs } from './flows'

function inputs(overrides: Partial<FlowInputs>): FlowInputs {
  return {
    hasDictationText: false,
    hasInstructionText: false,
    hasInstructionAudio: false,
    hasSelection: false,
    ...overrides
  }
}

describe('determineFlowType', () => {
  it('routes dictation+instruction text to transform', () => {
    expect(determineFlowType(inputs({ hasDictationText: true, hasInstructionText: true }))).toBe('transform')
  })

  it('routes instruction-audio + selection + no text to quote', () => {
    expect(determineFlowType(inputs({ hasInstructionAudio: true, hasSelection: true }))).toBe('quote')
  })

  it('routes instruction text + selection (no dictation) to context', () => {
    expect(determineFlowType(inputs({ hasInstructionText: true, hasSelection: true }))).toBe('context')
  })

  it('routes plain dictation to dictation even with a selection present', () => {
    expect(determineFlowType(inputs({ hasDictationText: true, hasSelection: true }))).toBe('dictation')
  })

  it('routes plain dictation with no selection to dictation', () => {
    expect(determineFlowType(inputs({ hasDictationText: true }))).toBe('dictation')
  })

  it('routes instruction text with no selection to instruction', () => {
    expect(determineFlowType(inputs({ hasInstructionText: true }))).toBe('instruction')
  })

  it('falls back to dictation when nothing usable is present', () => {
    expect(determineFlowType(inputs({}))).toBe('dictation')
  })

  it('does not fall into quote when instruction text was actually spoken', () => {
    expect(determineFlowType(inputs({ hasInstructionAudio: true, hasInstructionText: true, hasSelection: true }))).toBe(
      'context'
    )
  })
})
