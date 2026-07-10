// ════════════════════════════════════════════════════════════════════════
// keys/capability.ts — best-effort hardware/OS capability probe for the
// default dictation binding (v1 M5: Fn/Globe default was silently dead on
// non-Apple keyboards, and macOS itself can own the Globe key). Never throws.
// ════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { KeyCapability } from '../../shared/types'

const run = promisify(execFile)

export async function detectCapability(): Promise<KeyCapability> {
  if (process.platform !== 'darwin') {
    return {
      fnAvailable: false,
      globeConflict: false,
      defaultBinding: { type: 'key', key: 'right-ctrl' }
    }
  }

  // Fn/Globe presence: Apple's internal keyboards register the
  // AppleHIDKeyboardEventDriverV2 service; a Mac driven only by a third-party
  // external keyboard typically has none, and NSEvent never reports .function
  // for it. Empty ioreg output ⇒ no Fn. Any failure ⇒ assume true (Apple
  // keyboards are the overwhelmingly common case).
  let fnAvailable = true
  try {
    const { stdout } = await run('ioreg', ['-c', 'AppleHIDKeyboardEventDriverV2', '-r', '-d', '1'])
    fnAvailable = stdout.trim().length > 0
  } catch {
    fnAvailable = true
  }

  // Globe conflict: AppleFnUsageType — 0 Do Nothing, 1 Change Input Source,
  // 2 Show Emoji & Symbols, 3 Start Dictation. Only 3 makes macOS swallow the
  // press in a way that fights our hotkey. Key absent (system default) or any
  // read failure ⇒ no conflict.
  let globeConflict = false
  try {
    const { stdout } = await run('defaults', ['read', 'com.apple.HIToolbox', 'AppleFnUsageType'])
    globeConflict = stdout.trim() === '3'
  } catch {
    globeConflict = false
  }

  console.log('[keys] Capability: fnAvailable =', fnAvailable, 'globeConflict =', globeConflict)
  return {
    fnAvailable,
    globeConflict,
    defaultBinding: { type: 'key', key: fnAvailable ? 'fn' : 'right-option' }
  }
}
