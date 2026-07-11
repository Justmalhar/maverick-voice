// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI, LLMSettings, ProviderKeyStatus, RendererSettings } from '../../../shared/types'
import LlmProviderSection from './LlmProviderSection'

afterEach(() => cleanup())

const mockUseSettings = vi.fn()
vi.mock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))

/** A reactive stand-in for the real SettingsProvider — update() actually
 *  merges into state and re-renders, needed for tests where switching a
 *  provider must be observable on a second render (e.g. stale-fetch guard). */
function useReactiveSettings(initial: RendererSettings): { settings: RendererSettings; update: (p: Partial<RendererSettings>) => void } {
  const [settings, setSettings] = useState(initial)
  return { settings, update: (partial) => setSettings((prev) => ({ ...prev, ...partial })) }
}

function mockApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  return {
    getProviderKeyStatus: vi.fn().mockResolvedValue({ provider: 'openai', hasKey: false, maskedKey: null } as ProviderKeyStatus),
    setProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    testProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    clearProviderKey: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn(),
    ...overrides
  } as unknown as ElectronAPI
}

function llmSettings(overrides: Partial<LLMSettings> = {}): LLMSettings {
  return { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '', ...overrides }
}

function settingsWith(llm: LLMSettings): RendererSettings {
  return { llmSettings: llm } as RendererSettings
}

describe('LlmProviderSection', () => {
  it('returns null while settings have not loaded', () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    mockUseSettings.mockReturnValue({ settings: null, update: vi.fn() })
    const { container } = render(<LlmProviderSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a free-text model input when the catalog is empty, and edits call update()', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ listModels: vi.fn().mockResolvedValue([]) })
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update })
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    const modelInput = screen.getByPlaceholderText('model id')
    expect(modelInput).toHaveValue('gpt-4o-mini')
    await user.type(modelInput, '!')
    expect(update).toHaveBeenCalledWith({ llmSettings: { ...llmSettings(), model: 'gpt-4o-mini!' } })
  })

  it('renders a select once the model catalog resolves, and choosing a model calls update()', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      listModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
        { id: 'gpt-4o', label: 'GPT-4o' }
      ])
    })
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update })
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    await waitFor(() => expect(screen.queryByPlaceholderText('model id')).not.toBeInTheDocument())
    const select = screen.getByLabelText('Model')
    await user.selectOptions(select, 'gpt-4o')
    expect(update).toHaveBeenCalledWith({ llmSettings: { ...llmSettings(), model: 'gpt-4o' } })
  })

  it('switching provider resets model to the new provider default and clears baseUrl, refetching models', async () => {
    const listModels = vi.fn().mockResolvedValue([])
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ listModels })
    const update = vi.fn()
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update })
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    await waitFor(() => expect(listModels).toHaveBeenCalledWith('openai', 'llm'))
    await user.selectOptions(screen.getByLabelText('LLM provider'), 'groq')
    expect(update).toHaveBeenCalledWith({ llmSettings: { provider: 'groq', model: 'llama-3.3-70b-versatile', baseUrl: '' } })
  })

  it('shows the Base URL field only for the custom provider, and typing calls update()', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    const update = vi.fn()
    mockUseSettings.mockReturnValue({
      settings: settingsWith(llmSettings({ provider: 'custom', model: 'llama3', baseUrl: '' })),
      update
    })
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    const baseUrlInput = screen.getByPlaceholderText('https://my-server.example/v1')
    await user.type(baseUrlInput, 'x')
    expect(update).toHaveBeenCalledWith({
      llmSettings: { provider: 'custom', model: 'llama3', baseUrl: 'x' }
    })
    // custom has no consoleUrl -> no "Get an API key" link rendered.
    expect(screen.queryByText('Get an API key →')).not.toBeInTheDocument()
  })

  it('shows the "Get an API key" link for providers with a consoleUrl and opens it externally', async () => {
    const openExternal = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ openExternal })
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update: vi.fn() })
    const user = userEvent.setup()
    render(<LlmProviderSection />)
    await user.click(screen.getByText('Get an API key →'))
    expect(openExternal).toHaveBeenCalledWith('https://platform.openai.com/api-keys')
  })

  it('saves an API key through the KeyCard, refreshing status and the model catalog', async () => {
    const setProviderKey = vi.fn().mockResolvedValue({ ok: true })
    const getProviderKeyStatus = vi
      .fn()
      .mockResolvedValueOnce({ provider: 'openai', hasKey: false, maskedKey: null })
      .mockResolvedValueOnce({ provider: 'openai', hasKey: true, maskedKey: 'sk-***abc' })
    const listModels = vi.fn().mockResolvedValue([])
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      setProviderKey,
      getProviderKeyStatus,
      listModels
    })
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update: vi.fn() })
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    const keyInput = screen.getByLabelText('API key API key')
    await user.type(keyInput, 'sk-new-key')
    await user.click(screen.getByText('Save'))

    expect(setProviderKey).toHaveBeenCalledWith('openai', 'sk-new-key')
    await waitFor(() => expect(screen.getByText('Key saved securely.')).toBeInTheDocument())
    await waitFor(() => expect(getProviderKeyStatus).toHaveBeenCalledTimes(2))
  })

  it('surfaces a test-key error message from the KeyCard', async () => {
    const testProviderKey = vi.fn().mockResolvedValue({ ok: false, error: 'invalid format' })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ testProviderKey })
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update: vi.fn() })
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    const keyInput = screen.getByLabelText('API key API key')
    await user.type(keyInput, 'bad-key')
    await user.click(screen.getByText('Test'))
    await waitFor(() => expect(screen.getByText('invalid format')).toBeInTheDocument())
  })

  it('clears a saved key via the KeyCard', async () => {
    const clearProviderKey = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      clearProviderKey,
      getProviderKeyStatus: vi.fn().mockResolvedValue({ provider: 'openai', hasKey: true, maskedKey: 'sk-***abc' })
    })
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update: vi.fn() })
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    await user.click(screen.getByText('Clear'))
    expect(clearProviderKey).toHaveBeenCalledWith('openai')
  })

  it('falls back to the first provider metadata when the stored provider id is unrecognized', () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    mockUseSettings.mockReturnValue({
      settings: settingsWith(llmSettings({ provider: 'not-a-real-provider' as never })),
      update: vi.fn()
    })
    render(<LlmProviderSection />)
    // meta falls back to LLM_PROVIDERS[0] (OpenAI) -> its consoleUrl link renders.
    expect(screen.getByText('Get an API key →')).toBeInTheDocument()
  })

  it('swallows a listModels rejection (model list stays empty, free-text input shown)', async () => {
    const listModels = vi.fn().mockRejectedValue(new Error('network down'))
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ listModels })
    mockUseSettings.mockReturnValue({ settings: settingsWith(llmSettings()), update: vi.fn() })
    render(<LlmProviderSection />)
    await waitFor(() => expect(listModels).toHaveBeenCalled())
    expect(screen.getByPlaceholderText('model id')).toBeInTheDocument()
  })

  it('ignores a listModels resolution that arrives after the provider changed again (stale guard)', async () => {
    let resolveFirst: (models: { id: string; label: string }[]) => void = () => {}
    const listModels = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValue([])
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ listModels })
    mockUseSettings.mockImplementation(() => useReactiveSettings(settingsWith(llmSettings())))
    const user = userEvent.setup()
    render(<LlmProviderSection />)

    await waitFor(() => expect(listModels).toHaveBeenCalledWith('openai', 'llm'))
    // Switching providers reruns the effect, marking the first (openai) fetch stale.
    await user.selectOptions(screen.getByLabelText('LLM provider'), 'groq')
    await waitFor(() => expect(listModels).toHaveBeenCalledWith('groq', 'llm'))

    // Resolve the stale openai fetch after the switch — it must be ignored.
    resolveFirst([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }])
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByPlaceholderText('model id')).toBeInTheDocument()
  })
})
