import './ui.css'

/**
 * Three-dot loader — transform/opacity keyframes only (DESIGN.md §5.1),
 * reduced-motion safe (falls back to static dots in ui.css).
 */
export function LoadingDots({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="ui-dots" role="status" aria-label={label}>
      <span className="ui-dots__dot" />
      <span className="ui-dots__dot" />
      <span className="ui-dots__dot" />
    </span>
  )
}
