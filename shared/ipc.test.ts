import { describe, it, expect } from 'vitest'
import { IPC } from './ipc'

describe('IPC channel table', () => {
  it('exposes stable, unique channel string values', () => {
    expect(IPC.RECORDING_START).toBe('recording:start')
    expect(IPC.OUTPUT_READY).toBe('output:ready')
    expect(IPC.DEV_ERROR_LOG).toBe('dev:error-log')
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })
})
