// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { isOnboardingComplete, resetOnboarding, setOnboardingComplete } from './onboardingState'

describe('onboardingState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is not complete before anything is set', () => {
    expect(isOnboardingComplete()).toBe(false)
  })

  it('becomes complete after setOnboardingComplete', () => {
    setOnboardingComplete()
    expect(isOnboardingComplete()).toBe(true)
    expect(localStorage.getItem('maverickvoice_onboarding_complete')).toBe('true')
  })

  it('reverts to incomplete after resetOnboarding', () => {
    setOnboardingComplete()
    resetOnboarding()
    expect(isOnboardingComplete()).toBe(false)
    expect(localStorage.getItem('maverickvoice_onboarding_complete')).toBeNull()
  })

  it('treats any non-"true" stored value as incomplete', () => {
    localStorage.setItem('maverickvoice_onboarding_complete', 'garbage')
    expect(isOnboardingComplete()).toBe(false)
  })
})
