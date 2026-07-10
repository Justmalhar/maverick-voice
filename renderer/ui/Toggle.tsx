import './ui.css'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  /** Accessible name. Pass this or `aria-labelledby` (id of the visible label). */
  'aria-label'?: string
  'aria-labelledby'?: string
}

/** THE app toggle — role="switch", token-driven knob/track (A9/A10 fix). */
export function Toggle({ checked, onChange, disabled, size = 'md', ...aria }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`ui-toggle${size === 'sm' ? ' ui-toggle--sm' : ''}`}
      {...aria}
    >
      <span className="ui-toggle__knob" aria-hidden="true" />
    </button>
  )
}
