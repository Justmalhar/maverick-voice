// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { KeyCapability, PermissionsReport, ProviderKeyStatus } from '../../../shared/types'
import {
  HowItWorksStep,
  MicStep,
  PrivacyStep,
  ProviderKeysStep,
  ReadyStep,
  ShortcutsStep,
  StepShell,
  SystemPermissionsStep,
  WelcomeStep
} from './steps'

const platform = vi.hoisted(() => ({ IS_MAC: false }))

vi.mock('../../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui')>()
  return {
    ...actual,
    get IS_MAC() {
      return platform.IS_MAC
    }
  }
})

function report(overrides: Partial<PermissionsReport> = {}): PermissionsReport {
  return { mic: 'granted', accessibility: true, inputMonitoring: true, automation: 'granted', listenerAlive: true, ...overrides }
}

function capability(overrides: Partial<KeyCapability> = {}): KeyCapability {
  return { fnAvailable: true, globeConflict: false, defaultBinding: { type: 'key', key: 'fn' }, ...overrides }
}

function keyStatus(overrides: Partial<ProviderKeyStatus> = {}): ProviderKeyStatus {
  return { provider: 'groq', hasKey: false, maskedKey: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  platform.IS_MAC = false
  window.electronAPI = {
    getProviderKeyStatus: vi.fn().mockResolvedValue(keyStatus()),
    setProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    testProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    clearProviderKey: vi.fn(),
    openExternal: vi.fn(),
    requestMicPermission: vi.fn().mockResolvedValue(true),
    openPermissionPane: vi.fn()
  } as unknown as typeof window.electronAPI
})

afterEach(() => cleanup())

describe('StepShell', () => {
  it('renders subtitle without children (no body region, no mb-6 spacing)', () => {
    render(<StepShell icon={<span />} title="Title only" subtitle="Just a subtitle" />)
    expect(screen.getByText('Just a subtitle')).toBeInTheDocument()
  })

  it('renders children without a subtitle', () => {
    render(
      <StepShell icon={<span />} title="Title only">
        <div>body content</div>
      </StepShell>
    )
    expect(screen.getByText('body content')).toBeInTheDocument()
  })
})

describe('WelcomeStep', () => {
  it('renders the title and both feature cards', () => {
    render(<WelcomeStep />)
    expect(screen.getByText('Maverick Voice')).toBeInTheDocument()
    expect(screen.getByText('Dictate')).toBeInTheDocument()
    expect(screen.getByText('AI auto-format')).toBeInTheDocument()
  })
})

describe('HowItWorksStep', () => {
  it('renders the three flow cards', () => {
    render(<HowItWorksStep />)
    expect(screen.getByText('Pure Dictation')).toBeInTheDocument()
    expect(screen.getByText('AI Instruction (opt-in)')).toBeInTheDocument()
    expect(screen.getByText('Dictate-to-Instruct')).toBeInTheDocument()
  })
})

describe('PrivacyStep', () => {
  it('mentions the macOS Keychain on mac', () => {
    platform.IS_MAC = true
    render(<PrivacyStep />)
    expect(screen.getByText(/the macOS Keychain/)).toBeInTheDocument()
  })

  it('mentions the OS credential store off mac', () => {
    platform.IS_MAC = false
    render(<PrivacyStep />)
    expect(screen.getByText(/your OS credential store/)).toBeInTheDocument()
  })
})

describe('ProviderKeysStep', () => {
  it('fetches key status for groq, openai, and openrouter on mount', async () => {
    render(<ProviderKeysStep />)
    expect(window.electronAPI.getProviderKeyStatus).toHaveBeenCalledWith('groq')
    expect(window.electronAPI.getProviderKeyStatus).toHaveBeenCalledWith('openai')
    expect(window.electronAPI.getProviderKeyStatus).toHaveBeenCalledWith('openrouter')
    await screen.findByLabelText('Groq · Required API key')
  })

  it('saves the groq key, refreshes status on success', async () => {
    ;(window.electronAPI.getProviderKeyStatus as Mock).mockResolvedValue(keyStatus({ provider: 'groq' }))
    render(<ProviderKeysStep />)
    const input = await screen.findByLabelText('Groq · Required API key')
    await userEvent.type(input, 'gsk_secret')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(window.electronAPI.setProviderKey).toHaveBeenCalledWith('groq', 'gsk_secret')
    expect(await screen.findByText('Key saved securely.')).toBeInTheDocument()
  })

  it('surfaces the returned error message when saving fails', async () => {
    ;(window.electronAPI.setProviderKey as Mock).mockResolvedValue({ ok: false, error: 'bad key' })
    render(<ProviderKeysStep />)
    const input = await screen.findByLabelText('Groq · Required API key')
    await userEvent.type(input, 'gsk_bad')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(await screen.findByText('bad key')).toBeInTheDocument()
  })

  it('falls back to a generic save error message when none is provided', async () => {
    ;(window.electronAPI.setProviderKey as Mock).mockResolvedValue({ ok: false })
    render(<ProviderKeysStep />)
    const input = await screen.findByLabelText('Groq · Required API key')
    await userEvent.type(input, 'gsk_bad')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    expect(await screen.findByText("Couldn't save the key.")).toBeInTheDocument()
  })

  it('tests the openai key and surfaces a failure message with fallback text', async () => {
    ;(window.electronAPI.testProviderKey as Mock).mockResolvedValue({ ok: false })
    render(<ProviderKeysStep />)
    const input = await screen.findByLabelText('OpenAI · Optional API key')
    await userEvent.type(input, 'sk-test')
    await userEvent.click(screen.getAllByRole('button', { name: 'Test' })[1])
    expect(window.electronAPI.testProviderKey).toHaveBeenCalledWith('openai', 'sk-test')
    expect(await screen.findByText('Key test failed.')).toBeInTheDocument()
  })

  it('clears the openrouter key locally', async () => {
    ;(window.electronAPI.getProviderKeyStatus as Mock).mockResolvedValue(keyStatus({ hasKey: true, maskedKey: '***abc' }))
    render(<ProviderKeysStep />)
    await screen.findByLabelText('OpenRouter · Optional API key')
    const clearButtons = screen.getAllByRole('button', { name: 'Clear' })
    await userEvent.click(clearButtons[2])
    expect(window.electronAPI.clearProviderKey).toHaveBeenCalledWith('openrouter')
  })

  it('opens the correct "Get key" URL per provider', async () => {
    render(<ProviderKeysStep />)
    const links = screen.getAllByText('Get key →')
    // groq is always first in DOM order
    await userEvent.click(links[0])
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://console.groq.com/keys')
    await userEvent.click(links[1])
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://platform.openai.com/api-keys')
    await userEvent.click(links[2])
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://openrouter.ai/keys')
  })
})

describe('MicStep', () => {
  it('shows a granted pill when mic is granted', () => {
    render(<MicStep report={report({ mic: 'granted' })} onChange={vi.fn()} />)
    expect(screen.getByText('Microphone access granted')).toBeInTheDocument()
  })

  it('shows settings buttons when mic is denied', async () => {
    const onChange = vi.fn()
    render(<MicStep report={report({ mic: 'denied' })} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open System Settings' }))
    expect(window.electronAPI.openPermissionPane).toHaveBeenCalledWith('mic')
    await userEvent.click(screen.getByRole('button', { name: "I've enabled it" }))
    expect(onChange).toHaveBeenCalled()
  })

  it('requests mic permission when not-determined and succeeds', async () => {
    const onChange = vi.fn()
    render(<MicStep report={report({ mic: 'not-determined' })} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Grant microphone access' }))
    expect(window.electronAPI.requestMicPermission).toHaveBeenCalled()
    expect(window.electronAPI.openPermissionPane).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
  })

  it('opens the mic settings pane when the request is denied', async () => {
    ;(window.electronAPI.requestMicPermission as Mock).mockResolvedValue(false)
    const onChange = vi.fn()
    render(<MicStep report={report({ mic: 'not-determined' })} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Grant microphone access' }))
    expect(window.electronAPI.openPermissionPane).toHaveBeenCalledWith('mic')
    expect(onChange).toHaveBeenCalled()
  })
})

describe('SystemPermissionsStep', () => {
  it('shows a Wayland notice off mac', () => {
    platform.IS_MAC = false
    render(<SystemPermissionsStep report={report()} onChange={vi.fn()} />)
    expect(screen.getByText('Wayland detected')).toBeInTheDocument()
  })

  it('shows granted rows on mac when both permissions are granted', () => {
    platform.IS_MAC = true
    render(<SystemPermissionsStep report={report({ accessibility: true, inputMonitoring: true })} onChange={vi.fn()} />)
    expect(screen.getAllByText('Granted')).toHaveLength(2)
  })

  it('shows Open Settings + confirm buttons on mac when permissions are missing', async () => {
    platform.IS_MAC = true
    const onChange = vi.fn()
    render(<SystemPermissionsStep report={report({ accessibility: false, inputMonitoring: false })} onChange={onChange} />)
    const openButtons = screen.getAllByRole('button', { name: 'Open Settings' })
    await userEvent.click(openButtons[0])
    expect(window.electronAPI.openPermissionPane).toHaveBeenCalledWith('accessibility')
    await userEvent.click(openButtons[1])
    expect(window.electronAPI.openPermissionPane).toHaveBeenCalledWith('input-monitoring')

    const confirmButtons = screen.getAllByRole('button', { name: "I've enabled it" })
    await userEvent.click(confirmButtons[0])
    expect(onChange).toHaveBeenCalled()
  })
})

describe('ShortcutsStep', () => {
  it('shows the globe-conflict notice when present', () => {
    render(<ShortcutsStep capability={capability({ globeConflict: true })} />)
    expect(screen.getByText('Heads up:', { exact: false })).toBeInTheDocument()
  })

  it('omits the globe-conflict notice otherwise', () => {
    render(<ShortcutsStep capability={capability({ globeConflict: false })} />)
    expect(screen.queryByText('Heads up:', { exact: false })).not.toBeInTheDocument()
  })
})

describe('ReadyStep', () => {
  it('renders the final confirmation', () => {
    render(<ReadyStep capability={capability()} />)
    expect(screen.getByText("You're all set")).toBeInTheDocument()
  })
})
