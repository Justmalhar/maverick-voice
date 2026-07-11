import { describe, it, expect } from 'vitest'
import {
  assembleTransformMessages,
  buildAutoFormatPrompt,
  DICTATION_SYSTEM_PROMPT,
  CONTEXT_SYSTEM_PROMPT,
  TRANSFORM_SYSTEM_PROMPT,
  INSTRUCTION_SYSTEM_PROMPT
} from './prompts'

describe('buildAutoFormatPrompt', () => {
  it('returns BASE RULES only for the default profile', () => {
    const prompt = buildAutoFormatPrompt('default')
    expect(prompt).toContain('auto-format engine')
    expect(prompt).not.toContain('TARGET:')
  })

  it('appends the profile-specific block for a non-default profile', () => {
    const prompt = buildAutoFormatPrompt('email')
    expect(prompt).toContain('TARGET: EMAIL')
  })
})

describe('assembleTransformMessages — dictation flow', () => {
  it('assembles the non-chunked dictation message with temperature 0.1', () => {
    const { system, user, temperature } = assembleTransformMessages('dictation', 'hello world', null, null)
    expect(system).toBe(DICTATION_SYSTEM_PROMPT)
    expect(user).toContain('TRANSCRIPT: <<< hello world >>>')
    expect(temperature).toBe(0.1)
  })

  it('appends the rules block to the system prompt when provided', () => {
    const { system } = assembleTransformMessages('dictation', 'hi', null, null, false, 'USER RULES — x')
    expect(system).toContain('USER RULES — x')
  })

  it('uses the chunked-transcript note when chunked=true', () => {
    const { user } = assembleTransformMessages('dictation', 'part one part two', null, null, true)
    expect(user).toContain('CHUNKED TRANSCRIPT')
    expect(user).not.toContain('TRANSCRIPT: <<<')
  })

  it('defaults a missing content to an empty string when chunked=true', () => {
    const { user } = assembleTransformMessages('dictation', null, null, null, true)
    expect(user.endsWith('\n\n')).toBe(true)
  })

  it('defaults a missing content to an empty string', () => {
    const { user } = assembleTransformMessages('dictation', null, null, null)
    expect(user).toContain('TRANSCRIPT: <<<  >>>')
  })
})

describe('assembleTransformMessages — context flow', () => {
  it('assembles selected-text + command, temperature 0.1 without a spoken instruction override', () => {
    const { system, user, temperature } = assembleTransformMessages('context', null, 'the selection', 'shorten it')
    expect(system).toBe(CONTEXT_SYSTEM_PROMPT)
    expect(user).toContain('[SELECTED TEXT]:\nthe selection')
    expect(user).toContain('[COMMAND]:\nshorten it')
    // instruction is truthy here so temperature actually resolves to 0.3 (see rule below)
    expect(temperature).toBe(0.3)
  })

  it('defaults missing context/instruction to empty strings', () => {
    const { user } = assembleTransformMessages('context', null, null, null)
    expect(user).toContain('[SELECTED TEXT]:\n\n')
    expect(user).toContain('[COMMAND]:\n')
  })
})

describe('assembleTransformMessages — transform flow', () => {
  it('assembles dictated content + command and appends reference text when context given', () => {
    const { system, user, temperature } = assembleTransformMessages(
      'transform',
      'dictated content',
      'reference text',
      'make it a list'
    )
    expect(system).toBe(TRANSFORM_SYSTEM_PROMPT)
    expect(user).toContain('[DICTATED CONTENT]:\ndictated content')
    expect(user).toContain('[COMMAND]:\nmake it a list')
    expect(user).toContain('[REFERENCE TEXT]:\nreference text')
    expect(temperature).toBe(0.3)
  })

  it('omits the reference-text section when context is falsy', () => {
    const { user } = assembleTransformMessages('transform', 'content', null, 'do it')
    expect(user).not.toContain('[REFERENCE TEXT]')
  })

  it('defaults missing content/instruction to empty strings', () => {
    const { user } = assembleTransformMessages('transform', null, null, null)
    expect(user).toBe('[DICTATED CONTENT]:\n\n\n[COMMAND]:\n')
  })
})

describe('assembleTransformMessages — instruction flow', () => {
  it('uses instruction, falling back to content, temperature 0.3', () => {
    const { system, user, temperature } = assembleTransformMessages('instruction', null, null, 'write a haiku')
    expect(system).toBe(INSTRUCTION_SYSTEM_PROMPT)
    expect(user).toBe('[INSTRUCTION]:\nwrite a haiku')
    expect(temperature).toBe(0.3)
  })

  it('falls back to content when instruction is null', () => {
    const { user } = assembleTransformMessages('instruction', 'fallback content', null, null)
    expect(user).toBe('[INSTRUCTION]:\nfallback content')
  })

  it('defaults to an empty string when both instruction and content are null', () => {
    const { user } = assembleTransformMessages('instruction', null, null, null)
    expect(user).toBe('[INSTRUCTION]:\n')
  })
})

describe('assembleTransformMessages — fallback (quote/unknown) flow', () => {
  it('builds the default cleanup instruction when no instruction is given', () => {
    const { system, user, temperature } = assembleTransformMessages('quote', 'raw text', null, null)
    expect(system).toContain('precise text processing assistant')
    expect(user).toContain('[CONTENT]: raw text')
    expect(user).toContain('speech-to-text transcription')
    expect(temperature).toBe(0.1)
  })

  it('includes content, context, and instruction sections when all are present', () => {
    const { user, temperature } = assembleTransformMessages('quote', 'c', 'ctx', 'instr')
    expect(user).toContain('[CONTENT]: c\n')
    expect(user).toContain('[CONTEXT]: ctx\n')
    expect(user).toContain('[INSTRUCTION]: instr\n')
    expect(temperature).toBe(0.3)
  })

  it('omits the [CONTENT] section entirely when content is falsy', () => {
    const { user } = assembleTransformMessages('quote', null, 'ctx', 'instr')
    expect(user).not.toContain('[CONTENT]')
    expect(user).toContain('[CONTEXT]: ctx\n')
  })
})
