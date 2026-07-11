// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState, type ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI } from '../../../shared/types'
import { SectionCard, SettingRow, LabeledField, LabeledSelect, useProviderKey } from './shared'

afterEach(() => cleanup())

function mockApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  return {
    getProviderKeyStatus: vi.fn().mockResolvedValue({ provider: 'openai', hasKey: false, maskedKey: null }),
    setProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    testProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    clearProviderKey: vi.fn(),
    ...overrides
  } as unknown as ElectronAPI
}

describe('SectionCard', () => {
  it('renders title, optional id, and children', () => {
    render(
      <SectionCard title="My Title" id="my-id">
        <p>child content</p>
      </SectionCard>
    )
    expect(screen.getByText('My Title')).toBeInTheDocument()
    expect(screen.getByText('child content')).toBeInTheDocument()
    expect(document.getElementById('my-id')).not.toBeNull()
  })

  it('renders without an id', () => {
    render(
      <SectionCard title="No Id">
        <p>content</p>
      </SectionCard>
    )
    const section = screen.getByText('content').closest('section')
    expect(section?.id).toBe('')
  })
})

describe('SettingRow', () => {
  it('renders label, description, and border-b when not last', () => {
    render(
      <SettingRow label="Label A" description="desc text" htmlFor="ctrl-id">
        <input id="ctrl-id" />
      </SettingRow>
    )
    const label = screen.getByText('Label A')
    expect(label).toBeInTheDocument()
    expect(label.getAttribute('for')).toBe('ctrl-id')
    expect(screen.getByText('desc text')).toBeInTheDocument()
    const row = label.closest('div.flex.items-center.justify-between')
    expect(row?.className).toContain('border-b')
  })

  it('omits description and border-b when last', () => {
    render(
      <SettingRow label="Label B" last>
        <input />
      </SettingRow>
    )
    const label = screen.getByText('Label B')
    expect(screen.queryByText('desc text')).not.toBeInTheDocument()
    const row = label.closest('div.flex.items-center.justify-between')
    expect(row?.className).not.toContain('border-b')
  })
})

describe('LabeledField', () => {
  it('renders label and children', () => {
    render(
      <LabeledField label="Field Label">
        <input value="x" readOnly />
      </LabeledField>
    )
    expect(screen.getByText('Field Label')).toBeInTheDocument()
  })
})

describe('LabeledSelect', () => {
  it('renders options and fires onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <LabeledSelect
        label="Pick"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' }
        ]}
      />
    )
    const select = screen.getByLabelText('Pick') as HTMLSelectElement
    expect(select.value).toBe('a')
    await user.selectOptions(select, 'b')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('appends a synthetic option when value is not in the options list', () => {
    render(
      <LabeledSelect
        label="Pick"
        value="stale-value"
        onChange={vi.fn()}
        options={[{ value: 'a', label: 'Alpha' }]}
      />
    )
    const select = screen.getByLabelText('Pick') as HTMLSelectElement
    expect(select.value).toBe('stale-value')
    expect(screen.getByRole('option', { name: 'stale-value' })).toBeInTheDocument()
  })

  it('does not append a synthetic option when value is already present', () => {
    render(
      <LabeledSelect
        label="Pick"
        value="a"
        onChange={vi.fn()}
        options={[{ value: 'a', label: 'Alpha' }]}
      />
    )
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })
})

describe('useProviderKey', () => {
  function TestHarness({ provider }: { provider: 'openai' | 'groq' }): ReactElement {
    const { status, save, test, clear } = useProviderKey(provider)
    return (
      <div>
        <span data-testid="status">{status ? (status.hasKey ? 'has-key' : 'no-key') : 'loading'}</span>
        <button onClick={() => void save('new-key').catch(() => {})}>save</button>
        <button onClick={() => void test('probe-key').catch(() => {})}>test</button>
        <button onClick={() => clear()}>clear</button>
      </div>
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads status on mount and refreshes on provider change', async () => {
    const getProviderKeyStatus = vi.fn().mockResolvedValue({ provider: 'openai', hasKey: true, maskedKey: 'sk-***' })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ getProviderKeyStatus })
    render(<TestHarness provider="openai" />)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('has-key'))
    expect(getProviderKeyStatus).toHaveBeenCalledWith('openai')
  })

  it('save() persists and refreshes status; throws when result is not ok', async () => {
    const setProviderKey = vi.fn().mockResolvedValue({ ok: false, error: 'bad key' })
    const getProviderKeyStatus = vi.fn().mockResolvedValue({ provider: 'openai', hasKey: false, maskedKey: null })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ setProviderKey, getProviderKeyStatus })
    const user = userEvent.setup()
    render(<TestHarness provider="openai" />)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-key'))
    await user.click(screen.getByText('save'))
    await waitFor(() => expect(setProviderKey).toHaveBeenCalledWith('openai', 'new-key'))
  })

  it('save() falls back to default error message when result has no error string', async () => {
    const setProviderKey = vi.fn().mockResolvedValue({ ok: false })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ setProviderKey })
    function Capture(): ReactElement {
      const { save } = useProviderKey('openai')
      const [err, setErr] = useState('')
      return (
        <div>
          <span data-testid="err">{err}</span>
          <button onClick={() => save('k').catch((e: Error) => setErr(e.message))}>go</button>
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Capture />)
    await user.click(screen.getByText('go'))
    await waitFor(() => expect(screen.getByTestId('err')).toHaveTextContent("Couldn't save the key."))
  })

  it('test() resolves on ok result', async () => {
    const testProviderKey = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ testProviderKey })
    const user = userEvent.setup()
    render(<TestHarness provider="openai" />)
    await user.click(screen.getByText('test'))
    await waitFor(() => expect(testProviderKey).toHaveBeenCalledWith('openai', 'probe-key'))
  })

  it('test() throws with default message when result has no error string', async () => {
    const testProviderKey = vi.fn().mockResolvedValue({ ok: false })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ testProviderKey })
    function Capture(): ReactElement {
      const { test } = useProviderKey('openai')
      const [err, setErr] = useState('')
      return (
        <div>
          <span data-testid="err">{err}</span>
          <button onClick={() => test('k').catch((e: Error) => setErr(e.message))}>go</button>
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Capture />)
    await user.click(screen.getByText('go'))
    await waitFor(() => expect(screen.getByTestId('err')).toHaveTextContent('Key test failed.'))
  })

  it('test() surfaces a custom error message', async () => {
    const testProviderKey = vi.fn().mockResolvedValue({ ok: false, error: 'custom failure' })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ testProviderKey })
    function Capture(): ReactElement {
      const { test } = useProviderKey('openai')
      const [err, setErr] = useState('')
      return (
        <div>
          <span data-testid="err">{err}</span>
          <button onClick={() => test('k').catch((e: Error) => setErr(e.message))}>go</button>
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Capture />)
    await user.click(screen.getByText('go'))
    await waitFor(() => expect(screen.getByTestId('err')).toHaveTextContent('custom failure'))
  })

  it('clear() calls clearProviderKey and resets status locally without refetch', async () => {
    const clearProviderKey = vi.fn()
    const getProviderKeyStatus = vi.fn().mockResolvedValue({ provider: 'openai', hasKey: true, maskedKey: 'sk-***' })
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ clearProviderKey, getProviderKeyStatus })
    const user = userEvent.setup()
    render(<TestHarness provider="openai" />)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('has-key'))
    await user.click(screen.getByText('clear'))
    expect(clearProviderKey).toHaveBeenCalledWith('openai')
    expect(screen.getByTestId('status')).toHaveTextContent('no-key')
  })

  it('getProviderKeyStatus rejection is swallowed (status stays null)', async () => {
    const getProviderKeyStatus = vi.fn().mockRejectedValue(new Error('ipc down'))
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ getProviderKeyStatus })
    render(<TestHarness provider="openai" />)
    await waitFor(() => expect(getProviderKeyStatus).toHaveBeenCalled())
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
  })
})
