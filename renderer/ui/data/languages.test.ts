import { describe, expect, it } from 'vitest'
import { LANGUAGES } from './languages'

describe('LANGUAGES', () => {
  it('leads with auto-detect', () => {
    expect(LANGUAGES[0]).toEqual({ code: 'auto', label: 'Auto-detect' })
  })

  it('every entry has a non-empty code and label', () => {
    expect(LANGUAGES.length).toBeGreaterThan(50)
    for (const lang of LANGUAGES) {
      expect(lang.code.length).toBeGreaterThan(0)
      expect(lang.label.length).toBeGreaterThan(0)
    }
  })
})
