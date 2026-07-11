import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

import { detectCapability } from './capability'

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

const REAL_PLATFORM = process.platform

function respond(stdout: string, err: Error | null = null) {
  execFileMock.mockImplementationOnce((_cmd: string, _args: string[], cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
    cb(err, { stdout, stderr: '' })
  })
}

describe('capability.detectCapability', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })
  afterEach(() => {
    setPlatform(REAL_PLATFORM)
  })

  it('returns win32 default without probing when not darwin', async () => {
    setPlatform('win32')
    const cap = await detectCapability()
    expect(cap).toEqual({
      fnAvailable: false,
      globeConflict: false,
      defaultBinding: { type: 'key', key: 'right-ctrl' }
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('linux also gets the non-darwin default', async () => {
    setPlatform('linux')
    const cap = await detectCapability()
    expect(cap.defaultBinding).toEqual({ type: 'key', key: 'right-ctrl' })
  })

  it('darwin: fn present + globe conflict -> defaultBinding fn', async () => {
    setPlatform('darwin')
    respond('some-service-entry') // ioreg non-empty
    respond('3') // AppleFnUsageType == 3
    const cap = await detectCapability()
    expect(cap.fnAvailable).toBe(true)
    expect(cap.globeConflict).toBe(true)
    expect(cap.defaultBinding).toEqual({ type: 'key', key: 'fn' })
  })

  it('darwin: fn absent (empty ioreg) -> defaultBinding right-option', async () => {
    setPlatform('darwin')
    respond('   ') // ioreg empty after trim
    respond('1') // AppleFnUsageType != 3
    const cap = await detectCapability()
    expect(cap.fnAvailable).toBe(false)
    expect(cap.globeConflict).toBe(false)
    expect(cap.defaultBinding).toEqual({ type: 'key', key: 'right-option' })
  })

  it('darwin: ioreg failure -> fnAvailable assumed true', async () => {
    setPlatform('darwin')
    execFileMock.mockImplementationOnce((_c: string, _a: string[], cb: (e: Error | null) => void) => {
      cb(new Error('ioreg failed'))
    })
    respond('0')
    const cap = await detectCapability()
    expect(cap.fnAvailable).toBe(true)
  })

  it('darwin: defaults read failure -> globeConflict false', async () => {
    setPlatform('darwin')
    respond('present')
    execFileMock.mockImplementationOnce((_c: string, _a: string[], cb: (e: Error | null) => void) => {
      cb(new Error('defaults failed'))
    })
    const cap = await detectCapability()
    expect(cap.globeConflict).toBe(false)
  })
})
