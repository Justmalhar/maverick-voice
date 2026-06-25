import type { STTSettings, ProviderModel } from '../../../shared/types'
import { IS_MAC } from './constants'
import { SettingRow, Segmented, Toggle, PermissionRow, CogIcon, ChevronIcon } from './settingsUi'

export interface SettingsAdvancedSectionProps {
  advancedOpen: boolean
  onAdvancedOpenChange: (open: boolean) => void
  instructionEnabled: boolean
  outputMode: 'paste' | 'clipboard'
  chunkedTranscription: boolean
  sttSettings: STTSettings
  sttModels: ProviderModel[]
  micGranted: boolean
  micStatus: string
  accessibilityGranted: boolean
  onInstructionEnabledChange: (value: boolean) => void
  onOutputModeChange: (mode: 'paste' | 'clipboard') => void
  onChunkedChange: (value: boolean) => void
  onSttPatch: (patch: Partial<STTSettings>) => void
  onGrantMic: () => void
  onGrantAccessibility: () => void
  onRefreshPermissions: () => void
}

export default function SettingsAdvancedSection({
  advancedOpen,
  onAdvancedOpenChange,
  instructionEnabled,
  outputMode,
  chunkedTranscription,
  sttSettings,
  sttModels,
  micGranted,
  micStatus,
  accessibilityGranted,
  onInstructionEnabledChange,
  onOutputModeChange,
  onChunkedChange,
  onSttPatch,
  onGrantMic,
  onGrantAccessibility,
  onRefreshPermissions,
}: SettingsAdvancedSectionProps) {
  return (
    <>
      <div className="mv-section-label mb-2.5 mt-6">
        <span className="text-mv-text-muted">
          <CogIcon />
        </span>
        Advanced
      </div>
      <div className="mv-glass-card overflow-hidden mb-3">
        <button
          className="mv-disclosure__head"
          onClick={() => onAdvancedOpenChange(!advancedOpen)}
          aria-expanded={advancedOpen}
        >
          <div className="min-w-0 text-left">
            <p className="text-[13px] font-semibold text-mv-text-primary">Advanced settings</p>
            <p className="text-[11px] text-mv-text-muted mt-0.5">Voice editing, output, permissions</p>
          </div>
          <span className={`mv-disclosure__chevron ${advancedOpen ? 'mv-disclosure__chevron--open' : ''}`}>
            <ChevronIcon />
          </span>
        </button>

        {advancedOpen && (
          <div className="border-t border-mv-border">
            <SettingRow
              label="Edit selected text with voice"
              description="Select text, tap a key, and speak an instruction to rewrite it."
            >
              <Toggle checked={instructionEnabled} onChange={onInstructionEnabledChange} />
            </SettingRow>
            {instructionEnabled && (
              <SettingRow label="Instruction key" description="The key you press while text is selected">
                <span className="kbd-3d">Caps Lock</span>
              </SettingRow>
            )}

            <SettingRow label="Output mode" description="How the result is delivered">
              <Segmented
                options={[
                  { value: 'paste', label: 'Paste at cursor' },
                  { value: 'clipboard', label: 'Clipboard' },
                ]}
                value={outputMode}
                onChange={(v) => onOutputModeChange(v as 'paste' | 'clipboard')}
              />
            </SettingRow>

            <SettingRow label="Chunked transcription" description="Stream long recordings in VAD-split chunks">
              <Toggle checked={chunkedTranscription} onChange={onChunkedChange} />
            </SettingRow>

            <SettingRow
              label="Transcription model"
              description={`${sttSettings.provider === 'deepgram' ? 'Deepgram' : 'Groq'} model for speech-to-text`}
              last={!IS_MAC}
            >
              <select className="mv-select min-w-[200px]" value={sttSettings.model} onChange={(e) => onSttPatch({ model: e.target.value })}>
                {sttModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {!sttModels.some((m) => m.id === sttSettings.model) && (
                  <option value={sttSettings.model}>{sttSettings.model}</option>
                )}
              </select>
            </SettingRow>

            {IS_MAC && (
              <>
                <PermissionRow
                  title="Microphone"
                  description="Required so Maverick Voice can hear what you say."
                  granted={micGranted}
                  statusText={
                    micGranted ? 'Granted' : micStatus === 'denied' || micStatus === 'restricted' ? 'Denied' : 'Not granted'
                  }
                  primary={!micGranted ? { label: 'Grant', onClick: onGrantMic } : null}
                  secondary={
                    micStatus === 'denied' || micStatus === 'restricted'
                      ? { label: 'Open Settings', onClick: () => window.electronAPI.openMicSettings() }
                      : null
                  }
                />
                <PermissionRow
                  title="Accessibility"
                  description="Required to detect shortcut keys and paste at the cursor."
                  granted={accessibilityGranted}
                  statusText={accessibilityGranted ? 'Granted' : 'Not granted'}
                  primary={!accessibilityGranted ? { label: 'Grant', onClick: onGrantAccessibility } : null}
                  secondary={
                    !accessibilityGranted ? { label: "I've enabled it", onClick: onRefreshPermissions } : null
                  }
                />
                <div className="px-5 py-4 border-t border-mv-border">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <p className="text-[13px] font-semibold text-mv-text-primary">Free up the Fn key</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-mv-text-muted">Recommended</span>
                  </div>
                  <p className="text-[12px] text-mv-text-secondary leading-relaxed">
                    macOS uses <span className="font-mono text-mv-text-primary">Fn</span> for emoji / Apple Dictation. To use it
                    for Maverick Voice, set <span className="font-semibold text-mv-text-primary">"Press 🌐 key to" → "Do Nothing"</span>.
                  </p>
                  <button onClick={() => window.electronAPI.openKeyboardSettings()} className="btn-glass !px-3.5 !py-2 !text-[11px] mt-3">
                    Open Keyboard Settings
                  </button>
                </div>
              </>
            )}

            <SettingRow label="Replay onboarding" description="Walk through the welcome and setup steps again" last>
              <button
                onClick={() => {
                  localStorage.removeItem('maverickvoice_onboarding_complete')
                  location.reload()
                }}
                className="btn-glass !px-4 !py-2 !text-[12px]"
              >
                Replay
              </button>
            </SettingRow>
          </div>
        )}
      </div>
    </>
  )
}
