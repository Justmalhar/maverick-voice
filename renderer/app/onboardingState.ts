/**
 * THE single localStorage key gating onboarding (v1 had 3 copies — LEGACY-ISSUES #16).
 * Import these functions everywhere the app needs to read/write onboarding state —
 * never touch localStorage directly outside this file.
 */
const ONBOARDING_KEY = 'maverickvoice_onboarding_complete'

export function isOnboardingComplete(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === 'true'
}

export function setOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_KEY, 'true')
}

export function resetOnboarding(): void {
  localStorage.removeItem(ONBOARDING_KEY)
}
