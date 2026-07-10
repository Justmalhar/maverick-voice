import type { ReactNode } from 'react'

/** Keycap chip — uses the `.kbd` recipe from the tokens layer. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={className ? `kbd ${className}` : 'kbd'}>{children}</kbd>
}
