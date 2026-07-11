// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ThemeSetting, ElectronAPI } from '../../shared/types'

function mockElectronAPI(getThemeResolved: ThemeSetting = 'system'): {
  api: ElectronAPI
  settingsCb: { current: ((partial: { theme?: ThemeSetting }) => void) | null }
} {
  const settingsCb: { current: ((partial: { theme?: ThemeSetting }) => void) | null } = { current: null }
  const api = {
    getTheme: vi.fn().mockResolvedValue(getThemeResolved),
    setTheme: vi.fn(),
    onSettingsChanged: vi.fn((cb: (partial: { theme?: ThemeSetting }) => void) => {
      settingsCb.current = cb
      return vi.fn()
    })
  } as unknown as ElectronAPI
  return { api, settingsCb }
}

function mockMatchMedia(matchesDark: boolean): {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
} {
  const addEventListener = vi.fn()
  const removeEventListener = vi.fn()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: matchesDark,
    addEventListener,
    removeEventListener
  })
  return { addEventListener, removeEventListener }
}

beforeEach(() => {
  window.location.hash = ''
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('ThemeProvider / useTheme (non-widget)', () => {
  it('resolves initial theme via getTheme() and applies system->dark to the DOM', async () => {
    mockMatchMedia(true)
    const { api } = mockElectronAPI('system')
    ;(window as any).electronAPI = api
    const { ThemeProvider, useTheme } = await import('./ThemeProvider')

    function Probe(): ReactNode {
      const { theme } = useTheme()
      return <span data-testid="theme">{theme}</span>
    }

    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      )
      await Promise.resolve()
    })

    expect(api.getTheme).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('theme').textContent).toBe('system')
    expect(document.documentElement.dataset['theme']).toBe('dark')
  })

  it('resolves system->light when matchMedia does not match dark', async () => {
    mockMatchMedia(false)
    const { api } = mockElectronAPI('system')
    ;(window as any).electronAPI = api
    const { ThemeProvider } = await import('./ThemeProvider')

    await act(async () => {
      render(<ThemeProvider>{null}</ThemeProvider>)
      await Promise.resolve()
    })

    expect(document.documentElement.dataset['theme']).toBe('light')
  })

  it('applies a non-system theme directly', async () => {
    mockMatchMedia(false)
    const { api } = mockElectronAPI('dark')
    ;(window as any).electronAPI = api
    const { ThemeProvider } = await import('./ThemeProvider')

    await act(async () => {
      render(<ThemeProvider>{null}</ThemeProvider>)
      await Promise.resolve()
    })

    expect(document.documentElement.dataset['theme']).toBe('dark')
  })

  it('onSettingsChanged partial with theme key updates state + DOM', async () => {
    mockMatchMedia(false)
    const { api, settingsCb } = mockElectronAPI('light')
    ;(window as any).electronAPI = api
    const { ThemeProvider, useTheme } = await import('./ThemeProvider')

    function Probe(): ReactNode {
      const { theme } = useTheme()
      return <span data-testid="theme">{theme}</span>
    }

    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      )
      await Promise.resolve()
    })
    expect(screen.getByTestId('theme').textContent).toBe('light')

    act(() => {
      settingsCb.current?.({ theme: 'dark' })
    })
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.dataset['theme']).toBe('dark')
  })

  it('onSettingsChanged partial without theme key is a no-op', async () => {
    mockMatchMedia(false)
    const { api, settingsCb } = mockElectronAPI('light')
    ;(window as any).electronAPI = api
    const { ThemeProvider, useTheme } = await import('./ThemeProvider')

    function Probe(): ReactNode {
      const { theme } = useTheme()
      return <span data-testid="theme">{theme}</span>
    }

    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      )
      await Promise.resolve()
    })

    act(() => {
      settingsCb.current?.({})
    })
    expect(screen.getByTestId('theme').textContent).toBe('light')
  })

  it('adds a matchMedia change listener only while theme is system, and removes it on theme change/unmount', async () => {
    const { addEventListener, removeEventListener } = mockMatchMedia(false)
    const { api, settingsCb } = mockElectronAPI('system')
    ;(window as any).electronAPI = api
    const { ThemeProvider } = await import('./ThemeProvider')

    let unmount: () => void = () => {}
    await act(async () => {
      const result = render(<ThemeProvider>{null}</ThemeProvider>)
      unmount = result.unmount
      await Promise.resolve()
    })

    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    // Switching away from 'system' should trigger the cleanup (removeEventListener).
    act(() => {
      settingsCb.current?.({ theme: 'dark' })
    })
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    unmount()
  })

  it('matchMedia change handler re-applies system resolution', async () => {
    const mq = mockMatchMedia(false)
    const { api } = mockElectronAPI('system')
    ;(window as any).electronAPI = api
    const { ThemeProvider } = await import('./ThemeProvider')

    await act(async () => {
      render(<ThemeProvider>{null}</ThemeProvider>)
      await Promise.resolve()
    })
    expect(document.documentElement.dataset['theme']).toBe('light')

    const onChange = mq.addEventListener.mock.calls[0][1] as () => void
    // Flip matchMedia to report dark now, then fire the change handler.
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    act(() => {
      onChange()
    })
    expect(document.documentElement.dataset['theme']).toBe('dark')
  })

  it('setTheme() updates state, applies DOM synchronously, and calls electronAPI.setTheme', async () => {
    mockMatchMedia(false)
    const { api } = mockElectronAPI('light')
    ;(window as any).electronAPI = api
    const { ThemeProvider, useTheme } = await import('./ThemeProvider')

    let captured: { theme: ThemeSetting; setTheme: (t: ThemeSetting) => void } | null = null
    function Probe(): ReactNode {
      captured = useTheme()
      return <span data-testid="theme">{captured.theme}</span>
    }

    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      )
      await Promise.resolve()
    })

    act(() => {
      captured!.setTheme('dark')
    })

    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.dataset['theme']).toBe('dark')
    expect(api.setTheme).toHaveBeenCalledWith('dark')
  })

  it('useTheme default context value is used outside a provider, and its setTheme is a no-op', async () => {
    const { useTheme } = await import('./ThemeProvider')
    function Probe(): ReactNode {
      const { theme, setTheme } = useTheme()
      return (
        <button data-testid="theme" onClick={() => setTheme('dark')}>
          {theme}
        </button>
      )
    }
    render(<Probe />)
    expect(screen.getByTestId('theme').textContent).toBe('system')
    // Default context's setTheme is `() => {}` — calling it must not throw or change anything.
    expect(() => screen.getByTestId('theme').click()).not.toThrow()
    expect(screen.getByTestId('theme').textContent).toBe('system')
  })

  it('does not apply a stale getTheme() resolution after the provider has unmounted', async () => {
    mockMatchMedia(false)
    let resolveGetTheme: (t: ThemeSetting) => void = () => {}
    const api = {
      getTheme: vi.fn(
        () =>
          new Promise<ThemeSetting>((resolve) => {
            resolveGetTheme = resolve
          })
      ),
      setTheme: vi.fn(),
      onSettingsChanged: vi.fn().mockReturnValue(vi.fn())
    } as unknown as ElectronAPI
    ;(window as any).electronAPI = api
    const { ThemeProvider } = await import('./ThemeProvider')

    const { unmount } = render(<ThemeProvider>{null}</ThemeProvider>)
    unmount()

    // Resolve getTheme() after unmount — the `mounted` guard must prevent
    // setState/apply from running on the torn-down component.
    await act(async () => {
      resolveGetTheme('dark')
      await Promise.resolve()
    })

    expect(document.documentElement.dataset['theme']).toBeUndefined()
  })
})

describe('ThemeProvider / apply (widget mode)', () => {
  it('forces dark theme in the widget hash route regardless of setting', async () => {
    window.location.hash = '#/widget'
    vi.resetModules()
    mockMatchMedia(false)
    const { api } = mockElectronAPI('light')
    ;(window as any).electronAPI = api
    const { ThemeProvider } = await import('./ThemeProvider')

    await act(async () => {
      render(<ThemeProvider>{null}</ThemeProvider>)
      await Promise.resolve()
    })

    expect(document.documentElement.dataset['theme']).toBe('dark')
  })
})
