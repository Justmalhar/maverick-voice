// ════════════════════════════════════════════════════════════════════════
// renderer/theme.ts — DASHBOARD theme applier (Goal B wiring).
//
// The token CSS (renderer/styles/tokens.css) declares every color token TWICE:
//   • `:root, [data-theme='dark']`  → dark values (default; no attr === dark)
//   • `[data-theme='light']`        → light values
// Tailwind utilities are inlined via `@theme inline { --color-mv-*: var(--mv-*) }`
// in renderer/styles.css, so they re-resolve at whatever DOM scope `data-theme`
// is set on. Switching the WHOLE dashboard is therefore a single attribute flip
// on <html> — no per-component edits.
//
// CONTRACT (must match the tokens agent):
//   resolved = setting === 'system'
//     ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
//     : setting
//   document.documentElement.setAttribute('data-theme', resolved)
// where resolved ∈ {'dark','light'}. There is NO [data-theme='system'] in CSS —
// 'system' MUST be resolved here before the attribute is set. Default / no attr
// is already dark (`:root` carries the dark set), so first paint is never
// unstyled.
//
// The HUD widget window is handled separately (WidgetApp forces data-theme=
// 'dark' on its own root) and never calls into this module.
// ════════════════════════════════════════════════════════════════════════

import type { Theme } from '../shared/types'

const PREFERS_DARK = '(prefers-color-scheme: dark)'

// The active OS-theme listener, registered ONLY while the setting is 'system'.
// Tracked at module scope so applyTheme() can detach it when the user pins a
// theme and re-attach it when they switch back to 'system'.
let mediaQuery: MediaQueryList | null = null
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

/** Resolve a Theme setting to the concrete attribute value the CSS understands. */
function resolve(setting: Theme): 'dark' | 'light' {
  if (setting === 'system') {
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia(PREFERS_DARK).matches
      ? 'dark'
      : 'light'
  }
  return setting
}

/** Set the data-theme attribute on <html> to the resolved concrete value. */
function applyResolved(resolved: 'dark' | 'light'): void {
  document.documentElement.setAttribute('data-theme', resolved)
}

/** Detach any active prefers-color-scheme listener (idempotent). */
function detachSystemListener(): void {
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener('change', mediaListener)
  }
  mediaQuery = null
  mediaListener = null
}

/**
 * Attach a prefers-color-scheme listener that re-applies the resolved theme
 * live when the OS theme changes. Only used while the setting is 'system'.
 * Replaces any previously-attached listener.
 */
function attachSystemListener(): void {
  detachSystemListener()
  if (typeof window === 'undefined' || !window.matchMedia) return
  mediaQuery = window.matchMedia(PREFERS_DARK)
  mediaListener = (e: MediaQueryListEvent) => {
    applyResolved(e.matches ? 'dark' : 'light')
  }
  mediaQuery.addEventListener('change', mediaListener)
}

/**
 * Apply a theme NOW (and manage the live OS listener), WITHOUT persisting.
 * Internal: shared by initTheme (read → apply) and applyTheme (persist → apply).
 */
function applyOnly(setting: Theme): void {
  applyResolved(resolve(setting))
  if (setting === 'system') {
    attachSystemListener()
  } else {
    detachSystemListener()
  }
}

/**
 * Persist the chosen theme AND apply it live. Called from Settings on switch.
 * The renderer is authoritative for the visible attribute; main just stores the
 * preference (no relaunch).
 */
export function applyTheme(setting: Theme): void {
  window.electronAPI.setTheme(setting)
  applyOnly(setting)
}

/**
 * Read the persisted theme, apply it, and (when 'system') attach the live OS
 * listener. Call once, early, in the DASHBOARD renderer entry. Falls back to
 * 'system' if the persisted value can't be read — and applies 'system'
 * optimistically first so first paint is never unstyled while the IPC resolves.
 */
export async function initTheme(): Promise<void> {
  // Optimistic first paint: resolve 'system' immediately so <html> carries an
  // explicit data-theme matching the OS before the persisted value arrives.
  // (No attr is already dark, but resolving lets a light-OS user avoid a
  // dark→light flash.)
  applyResolved(resolve('system'))
  try {
    const setting = await window.electronAPI.getTheme()
    applyOnly(setting)
  } catch {
    applyOnly('system')
  }
}
