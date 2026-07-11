import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import './ui.css'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  icon?: ReactNode
}

export interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group — required (A11 fix). */
  'aria-label': string
  disabled?: boolean
}

/** THE app segmented control — radiogroup semantics + arrow-key navigation. */
export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const activeIndex = options.findIndex((o) => o.value === value)
  const tabbableIndex = activeIndex === -1 ? 0 : activeIndex
  // ponytail: read once per render instead of subscribing — OS motion prefs
  // don't flip while the control is on screen, and any re-render (value
  // change) already re-evaluates this.
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % options.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + options.length) % options.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = options.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="ui-segment">
      <div
        aria-hidden="true"
        className="ui-segment__thumb"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${activeIndex < 0 ? 0 : activeIndex * 100}%)`,
          opacity: activeIndex < 0 ? 0 : 1,
          transition: reducedMotion ? 'none' : undefined
        }}
      />
      {options.map((opt, i) => (
        <button
          key={opt.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={i === activeIndex}
          tabIndex={i === tabbableIndex ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          className="ui-segment__btn"
        >
          {opt.icon && <span aria-hidden="true">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}
