import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadPlatform(ua: string | undefined) {
  vi.resetModules()
  vi.stubGlobal('navigator', ua === undefined ? undefined : { userAgent: ua })
  return import('./platform')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('platform detection', () => {
  it('detects macOS from a Macintosh UA', async () => {
    const { IS_MAC, IS_WIN, IS_LINUX } = await loadPlatform(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    )
    expect(IS_MAC).toBe(true)
    expect(IS_WIN).toBe(false)
    expect(IS_LINUX).toBe(false)
  })

  it('detects Windows from a Windows UA', async () => {
    const { IS_MAC, IS_WIN, IS_LINUX } = await loadPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(IS_MAC).toBe(false)
    expect(IS_WIN).toBe(true)
    expect(IS_LINUX).toBe(false)
  })

  it('detects Linux when neither mac nor windows and UA contains Linux', async () => {
    const { IS_MAC, IS_WIN, IS_LINUX } = await loadPlatform('Mozilla/5.0 (X11; Linux x86_64)')
    expect(IS_MAC).toBe(false)
    expect(IS_WIN).toBe(false)
    expect(IS_LINUX).toBe(true)
  })

  it('flags nothing when the UA matches none of the patterns', async () => {
    const { IS_MAC, IS_WIN, IS_LINUX } = await loadPlatform('SomeOtherAgent/1.0')
    expect(IS_MAC).toBe(false)
    expect(IS_WIN).toBe(false)
    expect(IS_LINUX).toBe(false)
  })

  it('defaults ua to empty string when navigator is undefined', async () => {
    const { IS_MAC, IS_WIN, IS_LINUX } = await loadPlatform(undefined)
    expect(IS_MAC).toBe(false)
    expect(IS_WIN).toBe(false)
    expect(IS_LINUX).toBe(false)
  })
})
