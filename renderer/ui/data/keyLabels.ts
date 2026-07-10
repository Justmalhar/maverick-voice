import type { DictationBinding, DictationKey, ModifierKey } from '../../../shared/types'
import { IS_MAC } from './platform'

/**
 * Platform-aware key labels. macOS uses keycap symbols (⌘⌥⇧⌃/fn); everything
 * else uses Ctrl/Alt/Shift/Win words. NEVER defaults to 'fn' off-mac (v1 bug:
 * legacy dictationKeyLabel had `default: return 'Fn'`).
 */

const MOD_LABELS: Record<ModifierKey, string> = IS_MAC
  ? { cmd: '⌘', ctrl: '⌃', option: '⌥', shift: '⇧', fn: 'fn' }
  : { cmd: 'Win', ctrl: 'Ctrl', option: 'Alt', shift: 'Shift', fn: 'Fn' }

/** Short keycap label for one modifier (combo chips in the binding picker). */
export function modifierLabel(mod: ModifierKey): string {
  return MOD_LABELS[mod]
}

function dictationKeyLabel(key: DictationKey): string {
  switch (key) {
    case 'fn':
      return 'fn'
    case 'right-option':
      return IS_MAC ? 'Right ⌥' : 'Right Alt'
    case 'right-ctrl':
      return 'Right Ctrl'
    case 'right-alt':
      return 'Right Alt'
  }
}

/** Human label for the active dictation binding (single key or combo). */
export function dictationBindingLabel(binding: DictationBinding): string {
  if (binding.type === 'combo') {
    // mac symbols compose without a separator (⌘⇧); words need a '+'.
    return binding.mods.map((m) => MOD_LABELS[m]).join(IS_MAC ? '' : '+')
  }
  return dictationKeyLabel(binding.key)
}

/** Caps Lock is the only instruction key (INTERFACES.md). */
export function instructionKeyLabel(): 'Caps Lock' {
  return 'Caps Lock'
}
