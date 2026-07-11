// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI, RendererSettings, STTSettings } from '../../../shared/types'
import SttProviderSection from './SttProviderSection'

afterEach(() => cleanup())

const mockUseSettings = vi.fn()
vi.mock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))

function mockApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  return {
    getProviderKeyStatus: vi.fn().mockResolvedValue({ provider: 'groq', hasKey: false, maskedKey: null }),
    setProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    testProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    clearProviderKey: vi.fn(),
    openExternal: vi.fn(),
    ...overrides
  } as unknown as ElectronAPI
}

function sttSettings(overrides: Partial<STTSettings> = {}): STTSettings {
  return { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'auto', baseUrl: '', ...overrides }
}

function settingsWith(stt: STTSettings): RendererSettings {
  return { sttSettings: stt } as RendererSettings
}

describe('SttProviderSection', () => {
  it('returns null while settings have not loaded', () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    mockUseSettings.mockReturnValue({ settings: null, update: vi.fn() })
    const { container } = render(<SttProviderSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('snaps a stale/foreign stored model to the provider default', () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    mockUseSettings.mockReturnValue({
      settings: settingsWith(sttSettings({ model: 'not-a-real-model' })),
      update: vi.fn()
    })
    render(<SttProviderSection />)
    expect(screen.getByLabelText('Model')).toHaveValue('whisper-large-v3-turbo')
  })

  it('keeps a valid stored model selected', () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    mockUseSettings.mockReturnValue({
      settings: settingsWith(sttSettings({ model: 'whisper-large-v3' })),
      update: vi.fn()
    })
    render(<SttProviderSection />)
    expect(screen.getByLabelText('Model')).toHaveValue('whisper-large-v3')
  })

  it('switching provider updates provider + model to the new default, preserving language/baseUrl', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: settingsWith(sttSettings({ language: 'fr' })), update })
    const user = userEvent.setup()
    render(<SttProviderSection />)

    await user.selectOptions(screen.getByLabelText('Speech-to-text provider'), 'openai')
    expect(update).toHaveBeenCalledWith({
      sttSettings: { provider: 'openai', model: 'gpt-4o-mini-transcribe', language: 'fr', baseUrl: '' }
    })
  })

  it('changing the model and language calls update() with the merged sttSettings', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: settingsWith(sttSettings()), update })
    const user = userEvent.setup()
    render(<SttProviderSection />)

    await user.selectOptions(screen.getByLabelText('Model'), 'whisper-large-v3')
    expect(update).toHaveBeenCalledWith({ sttSettings: { ...sttSettings(), model: 'whisper-large-v3' } })

    await user.selectOptions(screen.getByLabelText('Language'), 'es')
    expect(update).toHaveBeenCalledWith({ sttSettings: { ...sttSettings(), language: 'es' } })
  })

  it('opens the provider console link via openExternal', async () => {
    const openExternal = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ openExternal })
    mockUseSettings.mockReturnValue({ settings: settingsWith(sttSettings()), update: vi.fn() })
    const user = userEvent.setup()
    render(<SttProviderSection />)
    await user.click(screen.getByText('Get an API key →'))
    expect(openExternal).toHaveBeenCalledWith('https://console.groq.com/keys')
  })

  it('falls back to Groq metadata for a hidden/unknown provider id (e.g. local)', () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    mockUseSettings.mockReturnValue({
      settings: settingsWith({ provider: 'local', model: 'whatever', language: 'auto', baseUrl: '' } as unknown as STTSettings),
      update: vi.fn()
    })
    render(<SttProviderSection />)
    // Provider select shows only the 3 listed providers; falls back to groq's model list.
    expect(screen.getByLabelText('Model')).toHaveValue('whisper-large-v3-turbo')
  })

  it('saves an API key through the KeyCard', async () => {
    const setProviderKey = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ setProviderKey })
    mockUseSettings.mockReturnValue({ settings: settingsWith(sttSettings()), update: vi.fn() })
    const user = userEvent.setup()
    render(<SttProviderSection />)

    await user.type(screen.getByLabelText('API key API key'), 'gsk_new')
    await user.click(screen.getByText('Save'))
    expect(setProviderKey).toHaveBeenCalledWith('groq', 'gsk_new')
    await waitFor(() => expect(screen.getByText('Key saved securely.')).toBeInTheDocument())
  })
})
