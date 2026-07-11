// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ComponentType } from 'react'

afterEach(() => cleanup())

// PrivacySection's copy branches on the module-scope IS_MAC/IS_WIN constants
// from '../../ui' (computed once at import time from navigator.userAgent —
// jsdom's default UA is neither Mac nor Windows). Force each platform value
// via vi.doMock + a fresh module registry so all three ternary branches of
// the keychainName computation get exercised.
async function loadWithPlatform(isMac: boolean, isWin: boolean): Promise<ComponentType> {
  vi.resetModules()
  vi.doMock('../../ui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ui')>()
    return { ...actual, IS_MAC: isMac, IS_WIN: isWin }
  })
  const mod = await import('./PrivacySection')
  return mod.default
}

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('../../ui')
})

describe('PrivacySection', () => {
  it('names the macOS Keychain on mac', async () => {
    const PrivacySection = await loadWithPlatform(true, false)
    render(<PrivacySection />)
    expect(screen.getByText(/backed by/)).toHaveTextContent('backed by the macOS Keychain.')
  })

  it('names Windows DPAPI on windows', async () => {
    const PrivacySection = await loadWithPlatform(false, true)
    render(<PrivacySection />)
    expect(screen.getByText(/backed by/)).toHaveTextContent('backed by Windows DPAPI.')
  })

  it('falls back to the desktop secret service elsewhere (e.g. Linux)', async () => {
    const PrivacySection = await loadWithPlatform(false, false)
    render(<PrivacySection />)
    expect(screen.getByText(/backed by/)).toHaveTextContent('backed by your desktop secret service (libsecret).')
  })

  it('renders under the Privacy section card', async () => {
    const PrivacySection = await loadWithPlatform(false, false)
    render(<PrivacySection />)
    expect(screen.getByText('Privacy')).toBeInTheDocument()
    expect(document.getElementById('privacy')).not.toBeNull()
  })
})
