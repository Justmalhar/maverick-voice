import type { STTSettings, ActivationMode, ModifierKey } from '../../../shared/types'
import { STT_LANGUAGES, ACTIVATION_MODES, MODIFIER_CHIPS, modifierCapLabel } from './constants'
import { Section, SettingRow, Segmented, Toggle, MicIcon } from './settingsUi'

export interface SettingsDictationSectionProps {
  activationMode: ActivationMode
  sttSettings: STTSettings
  duckSystemAudio: boolean
  dictationKeyPickerOptions: { value: string; label: string }[]
  bindingPickerValue: string
  isComboMode: boolean
  comboMods: ModifierKey[]
  comboTooFew: boolean
  onBindingPickerChange: (value: string) => void
  onToggleComboModifier: (mod: ModifierKey) => void
  onActivationModeChange: (value: string) => void
  onSttPatch: (patch: Partial<STTSettings>) => void
  onDuckSystemAudioChange: (enabled: boolean) => void
}

export default function SettingsDictationSection({
  activationMode,
  sttSettings,
  duckSystemAudio,
  dictationKeyPickerOptions,
  bindingPickerValue,
  isComboMode,
  comboMods,
  comboTooFew,
  onBindingPickerChange,
  onToggleComboModifier,
  onActivationModeChange,
  onSttPatch,
  onDuckSystemAudioChange,
}: SettingsDictationSectionProps) {
  const activationBlurb = ACTIVATION_MODES.find((a) => a.value === activationMode)?.blurb

  return (
    <Section title="Dictation" icon={<MicIcon />}>
      <SettingRow label="Dictation trigger" description="The key — or modifier combo — you press to start dictating">
        <Segmented options={dictationKeyPickerOptions} value={bindingPickerValue} onChange={onBindingPickerChange} />
      </SettingRow>

      {isComboMode && (
        <div className="px-5 py-4 border-b border-mv-border">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-mv-text-secondary">Combo modifiers</p>
              <p className="text-[10.5px] text-mv-text-muted mt-0.5 max-w-[260px] leading-snug">
                Hold these together to dictate. Pick at least two to avoid clashing with system shortcuts.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              {comboMods.length > 0 ? (
                comboMods.map((m) => (
                  <kbd key={m} className="kbd-3d !min-w-[28px] !px-2 !py-1 !text-[11px]">
                    {modifierCapLabel(m)}
                  </kbd>
                ))
              ) : (
                <span className="text-[11px] text-mv-text-muted">No combo set</span>
              )}
            </div>
          </div>
          <div className="mv-combo-chips">
            {MODIFIER_CHIPS.map((chip) => {
              const active = comboMods.includes(chip.value)
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => onToggleComboModifier(chip.value)}
                  className={`mv-combo-chip ${active ? 'mv-combo-chip--active' : ''}`}
                  aria-pressed={active}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
          {comboTooFew && <p className="text-[11px] text-mv-text-muted mt-2.5">Pick at least two modifiers</p>}
        </div>
      )}

      <SettingRow label="Activation mode" description={activationBlurb || ''}>
        <Segmented options={ACTIVATION_MODES} value={activationMode} onChange={onActivationModeChange} />
      </SettingRow>
      <SettingRow
        label="Language"
        description="Speech recognition hint — auto-detect works for most cases"
      >
        <select
          className="mv-select min-w-[160px] shrink-0"
          value={sttSettings.language}
          onChange={(e) => onSttPatch({ language: e.target.value })}
        >
          {STT_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
          {!STT_LANGUAGES.some((l) => l.value === sttSettings.language) && (
            <option value={sttSettings.language}>{sttSettings.language}</option>
          )}
        </select>
      </SettingRow>
      <SettingRow
        label="Lower other audio while recording"
        description="Temporarily duck system volume so speakers and mic bleed less into transcription"
        last
      >
        <Toggle checked={duckSystemAudio} onChange={onDuckSystemAudioChange} />
      </SettingRow>
    </Section>
  )
}
