import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendCommand = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('./keyListener', () => ({
  keyListener: { sendCommand },
}))

import {
  duck,
  unduck,
  forceUnduck,
  setDuckSystemAudioEnabled,
  __resetSystemAudioForTests,
} from './systemAudio'

describe('systemAudio ref-count', () => {
  beforeEach(() => {
    __resetSystemAudioForTests()
    sendCommand.mockClear()
    setDuckSystemAudioEnabled(true)
  })

  it('sends DUCK once when duck is called twice before unduck', async () => {
    await duck()
    await duck()
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith('DUCK')
  })

  it('sends UNDUCK when ref-count returns to zero', async () => {
    await duck()
    await duck()
    await unduck()
    expect(sendCommand).toHaveBeenCalledWith('DUCK')
    expect(sendCommand).not.toHaveBeenCalledWith('UNDUCK')

    await unduck()
    expect(sendCommand).toHaveBeenCalledWith('UNDUCK')
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('forceUnduck resets stale ref-count and restores audio', async () => {
    await duck()
    await duck()
    sendCommand.mockClear()

    await forceUnduck()
    expect(sendCommand).toHaveBeenCalledWith('UNDUCK')
  })

  it('does nothing when ducking is disabled', async () => {
    setDuckSystemAudioEnabled(false)
    await duck()
    expect(sendCommand).not.toHaveBeenCalled()
  })
})
