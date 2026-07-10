import { useState, type ReactNode } from 'react'
import type { ActivationMode, DictationKey, ModifierKey } from '../../../shared/types'
import { IS_MAC, Kbd, modifierLabel, Segmented } from '../../ui'
import { useSettings } from '../settingsContext'
import { SectionCard, SettingRow } from './shared'

const DICTATION_KEY_OPTIONS: { value: DictationKey; label: string }[] = IS_MAC
  ? [
      { value: 'fn', label: 'Fn' },
      { value: 'right-option', label: 'Right Option' }
    ]
  : [
      { value: 'right-ctrl', label: 'Right Ctrl' },
      { value: 'right-alt', label: 'Right Alt' }
    ]

const COMBO_OPTION = '__combo__'

const MODIFIER_CHOICES: ModifierKey[] = IS_MAC ? ['cmd', 'ctrl', 'option', 'shift', 'fn'] : ['cmd', 'ctrl', 'option', 'shift']

const ACTIVATION_MODES: { value: ActivationMode; label: string; description: string }[] = [
  { value: 'tap-toggle', label: 'Tap toggle', description: 'Tap once to start, tap again to stop.' },
  { value: 'push-to-talk', label: 'Push to talk', description: 'Hold the key to record, release to submit.' },
  { value: 'double-tap-push', label: 'Dual mode', description: 'Double-tap for hands-free, or hold to push-to-talk.' }
]

export default function ShortcutsSection(): ReactNode {
  const { settings, update } = useSettings()
  // Local-only combo-in-progress selection — NOT persisted until >= 2 mods
  // are picked (matches INTERFACES.md `keys/listener.ts` combo semantics).
  const [draftCombo, setDraftCombo] = useState<ModifierKey[] | null>(null)

  if (!settings) return null

  const binding = settings.dictationBinding
  const isComboMode = binding.type === 'combo' || draftCombo !== null
  const comboMods = draftCombo ?? (binding.type === 'combo' ? binding.mods : [])
  const pickerValue = isComboMode ? COMBO_OPTION : binding.type === 'key' ? binding.key : COMBO_OPTION

  function handlePickerChange(value: string): void {
    if (value === COMBO_OPTION) {
      setDraftCombo(binding.type === 'combo' ? binding.mods : [])
      return
    }
    setDraftCombo(null)
    update({ dictationBinding: { type: 'key', key: value as DictationKey } })
  }

  function toggleModifier(mod: ModifierKey): void {
    const next = comboMods.includes(mod) ? comboMods.filter((m) => m !== mod) : [...comboMods, mod]
    setDraftCombo(next)
    if (next.length >= 2) update({ dictationBinding: { type: 'combo', mods: next } })
  }

  const activationDescription = ACTIVATION_MODES.find((a) => a.value === settings.activationMode)?.description

  return (
    <SectionCard title="Shortcuts" id="shortcuts">
      <SettingRow label="Dictation trigger" description="The key — or modifier combo — you press to start dictating.">
        <Segmented
          aria-label="Dictation trigger"
          options={[...DICTATION_KEY_OPTIONS, { value: COMBO_OPTION, label: 'Custom combo' }]}
          value={pickerValue}
          onChange={handlePickerChange}
        />
      </SettingRow>

      {isComboMode && (
        <div className="border-b border-stroke px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <p className="max-w-[280px] text-[11px] leading-snug text-ink-muted">
              Hold these together to dictate. Pick at least two to avoid clashing with system shortcuts.
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {comboMods.length > 0 ? (
                comboMods.map((m) => <Kbd key={m}>{modifierLabel(m)}</Kbd>)
              ) : (
                <span className="text-[11px] text-ink-muted">No combo set</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Combo modifiers">
            {MODIFIER_CHOICES.map((mod) => {
              const active = comboMods.includes(mod)
              return (
                <button
                  key={mod}
                  type="button"
                  onClick={() => toggleModifier(mod)}
                  aria-pressed={active}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium ${
                    active ? 'border-stroke-strong bg-surface-veil text-ink-strong' : 'border-stroke text-ink-muted hover:text-ink'
                  }`}
                >
                  {modifierLabel(mod)}
                </button>
              )
            })}
          </div>
          {comboMods.length < 2 && <p className="mt-2.5 text-[11px] text-ink-muted">Pick at least two modifiers to save.</p>}
        </div>
      )}

      <SettingRow label="Activation mode" description={activationDescription}>
        <Segmented
          aria-label="Activation mode"
          options={ACTIVATION_MODES}
          value={settings.activationMode}
          onChange={(mode: ActivationMode) => update({ activationMode: mode })}
        />
      </SettingRow>

      <SettingRow
        label="Instruction key"
        description={
          <>
            Opt-in — enable AI editing of selected text in{' '}
            <a href="#advanced" className="underline underline-offset-2 hover:text-ink">
              Advanced
            </a>
            .
          </>
        }
        last
      >
        <Kbd>Caps Lock</Kbd>
      </SettingRow>
    </SectionCard>
  )
}
