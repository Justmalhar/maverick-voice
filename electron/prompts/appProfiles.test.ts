import { describe, it, expect } from 'vitest'
import { detectProfile, profilePromptBlock } from './appProfiles'

describe('detectProfile', () => {
  it('matches by exact bundle id (case-insensitive)', () => {
    expect(detectProfile('COM.APPLE.MAIL', null)).toBe('email')
  })

  it('matches a prefix rule by id (com.jetbrains.*)', () => {
    expect(detectProfile('com.jetbrains.intellij', null)).toBe('code-editor')
  })

  it('matches a prefix rule by name when id does not match', () => {
    expect(detectProfile(null, 'com.jetbrains.pycharm')).toBe('code-editor')
  })

  it('matches by name substring (includes) when id is absent', () => {
    expect(detectProfile(null, 'My Slack Window')).toBe('messaging')
  })

  it('falls through unmatched apps (including browsers) to default', () => {
    expect(detectProfile('com.google.chrome', 'Google Chrome')).toBe('default')
  })

  it('returns default for null/empty id and name', () => {
    expect(detectProfile(null, null)).toBe('default')
  })

  it('trims whitespace before matching', () => {
    expect(detectProfile('  com.apple.mail  ', null)).toBe('email')
  })
})

describe('profilePromptBlock', () => {
  it('returns the correct block for every non-default profile', () => {
    expect(profilePromptBlock('email')).toContain('TARGET: EMAIL')
    expect(profilePromptBlock('chat-ai')).toContain('AI CHAT ASSISTANT')
    expect(profilePromptBlock('code-editor')).toContain('IN-IDE AI ASSISTANT')
    expect(profilePromptBlock('messaging')).toContain('CASUAL MESSAGING')
    expect(profilePromptBlock('notes')).toContain('NOTES / MARKDOWN')
  })

  it('returns empty string for default', () => {
    expect(profilePromptBlock('default')).toBe('')
  })
})
