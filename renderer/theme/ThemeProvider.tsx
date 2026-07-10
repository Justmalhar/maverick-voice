import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ThemeSetting } from '../../shared/types'

interface ThemeContextValue {
  theme: ThemeSetting
  setTheme: (t: ThemeSetting) => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'system', setTheme: () => {} })

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

const isWidget = typeof window !== 'undefined' && window.location.hash.startsWith('#/widget')

function apply(theme: ThemeSetting): void {
  // Widget HUD always uses dark theme — the glass pill is designed for dark glass.
  if (isWidget) {
    document.documentElement.dataset['theme'] = 'dark'
    return
  }
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  document.documentElement.dataset['theme'] = resolved
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setThemeState] = useState<ThemeSetting>('system')

  useEffect(() => {
    let mounted = true
    void window.electronAPI.getTheme().then((t) => {
      if (mounted) {
        setThemeState(t)
        apply(t)
      }
    })
    const unsubscribe = window.electronAPI.onSettingsChanged((partial) => {
      if (partial.theme) {
        setThemeState(partial.theme)
        apply(partial.theme)
      }
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = (t: ThemeSetting): void => {
    setThemeState(t)
    apply(t)
    window.electronAPI.setTheme(t)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
