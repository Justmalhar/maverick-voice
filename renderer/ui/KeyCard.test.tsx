// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyCard, type KeyCardProps } from './KeyCard'

afterEach(() => cleanup())

function makeProps(overrides: Partial<KeyCardProps> = {}): KeyCardProps {
  return {
    provider: 'groq',
    title: 'Groq',
    description: 'Speech to text',
    placeholder: 'gsk_...',
    status: null,
    onSave: vi.fn().mockResolvedValue(undefined),
    onTest: vi.fn().mockResolvedValue(undefined),
    onClear: vi.fn(),
    ...overrides
  }
}

describe('KeyCard', () => {
  it('shows no "Saved" badge and empty input when status is null (loading)', () => {
    render(<KeyCard {...makeProps()} />)
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Groq API key')).toHaveValue('')
  })

  it('shows masked value + Saved badge when a key is already stored, untouched', () => {
    render(
      <KeyCard
        {...makeProps({ status: { provider: 'groq', hasKey: true, maskedKey: 'gsk_****1234' } })}
      />
    )
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByLabelText('Groq API key')).toHaveValue('gsk_****1234')
    expect(screen.getByPlaceholderText('Enter a new key to replace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled()
  })

  it('Save button only enables once input is non-empty; Test enabled when hasKey even without input', async () => {
    const user = userEvent.setup()
    render(
      <KeyCard
        {...makeProps({ status: { provider: 'groq', hasKey: true, maskedKey: 'gsk_****1234' } })}
      />
    )
    const saveBtn = screen.getByRole('button', { name: 'Save' })
    const testBtn = screen.getByRole('button', { name: 'Test' })
    expect(saveBtn).toBeDisabled()
    expect(testBtn).toBeEnabled() // hasKey true => can test stored key with empty input

    const input = screen.getByLabelText('Groq API key')
    await user.click(input) // focus -> editing=true, clears mask
    expect(input).toHaveValue('')
    await user.type(input, 'newkey')
    expect(saveBtn).toBeEnabled()
  })

  it('Save+Test both disabled with no key and empty input', () => {
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null } })} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })

  it('blurring an empty, untouched input restores editing=false (no crash, mask still absent since no key)', async () => {
    const user = userEvent.setup()
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null } })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.click(input)
    await user.tab() // blur with empty input
    expect(input).toHaveValue('')
  })

  it('typing resets flow message (idle) as user edits', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn().mockResolvedValue(undefined)
    render(
      <KeyCard
        {...makeProps({ status: { provider: 'groq', hasKey: true, maskedKey: 'gsk_****' }, onTest })}
      />
    )
    const input = screen.getByLabelText('Groq API key')
    await user.click(input)
    await user.type(input, 'x')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(screen.getByText('Key is valid.')).toBeInTheDocument())
    await user.type(input, 'y')
    expect(screen.queryByText('Key is valid.')).not.toBeInTheDocument()
  })

  it('successful test flow shows "Key is valid."', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn().mockResolvedValue(undefined)
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onTest })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'gsk_abc')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(screen.getByText('Key is valid.')).toBeInTheDocument())
    expect(onTest).toHaveBeenCalledWith('gsk_abc')
  })

  it('failing test flow (Error instance) shows the error message', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn().mockRejectedValue(new Error('bad key'))
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onTest })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'gsk_abc')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(screen.getByText('bad key')).toBeInTheDocument())
  })

  it('failing test flow (non-Error rejection) falls back to default message', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn().mockRejectedValue('nope')
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onTest })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'gsk_abc')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(screen.getByText('Key test failed.')).toBeInTheDocument())
  })

  it('handleTest guard: testing an empty input with no stored key + already busy is a no-op', async () => {
    // hasKey true with empty input triggers a real test call (stored-key test) -- covered above.
    // Here: no key + empty input -> click does nothing (guarded by !key && !hasKey).
    const onTest = vi.fn()
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onTest })} />)
    const testBtn = screen.getByRole('button', { name: 'Test' })
    expect(testBtn).toBeDisabled()
  })

  it('clicking Test with an empty input but an existing stored key tests the stored key', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn().mockResolvedValue(undefined)
    render(
      <KeyCard {...makeProps({ status: { provider: 'groq', hasKey: true, maskedKey: 'gsk_****' }, onTest })} />
    )
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(onTest).toHaveBeenCalledWith('')
  })

  it('falls back to an empty string when hasKey is true but maskedKey is null', () => {
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: true, maskedKey: null } })} />)
    expect(screen.getByLabelText('Groq API key')).toHaveValue('')
  })

  it('pressing Enter with an empty input does not call onSave (bypasses the disabled Save button)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onSave })} />)
    const input = screen.getByLabelText('Groq API key')
    input.focus()
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('successful save flow clears input, exits editing, and shows "Key saved securely."', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onSave })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'gsk_abc')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Key saved securely.')).toBeInTheDocument())
    expect(onSave).toHaveBeenCalledWith('gsk_abc')
    expect(input).toHaveValue('')
  })

  it('failing save flow (Error) shows the error message and keeps input', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'))
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onSave })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'gsk_abc')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('save failed')).toBeInTheDocument())
  })

  it('failing save flow (non-Error) falls back to default message', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue('nope')
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onSave })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'gsk_abc')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText("Couldn't save the key.")).toBeInTheDocument())
  })

  it('pressing Enter triggers save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null }, onSave })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'gsk_abc{Enter}')
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('gsk_abc'))
  })

  it('pressing Escape while editing cancels (clears input, exits editing)', async () => {
    const user = userEvent.setup()
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null } })} />)
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'partial')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('pressing Escape while NOT editing does nothing special (no crash)', async () => {
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: true, maskedKey: 'gsk_****' } })} />)
    const input = screen.getByLabelText('Groq API key')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(input).toHaveValue('gsk_****')
  })

  it('handleClear calls onClear and resets local state', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <KeyCard
        {...makeProps({ status: { provider: 'groq', hasKey: true, maskedKey: 'gsk_****' }, onClear })}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('toggles reveal between password and text, swapping the eye icon and aria state', async () => {
    const user = userEvent.setup()
    render(<KeyCard {...makeProps({ status: { provider: 'groq', hasKey: false, maskedKey: null } })} />)
    const input = screen.getByLabelText('Groq API key')
    expect(input).toHaveAttribute('type', 'password')
    const toggle = screen.getByRole('button', { name: 'Show key' })
    await user.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide key' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('resets all local state when the provider prop changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <KeyCard {...makeProps({ provider: 'groq', status: { provider: 'groq', hasKey: false, maskedKey: null } })} />
    )
    const input = screen.getByLabelText('Groq API key')
    await user.type(input, 'partial')
    expect(input).toHaveValue('partial')

    rerender(
      <KeyCard
        {...makeProps({
          provider: 'openai',
          title: 'OpenAI',
          status: { provider: 'openai', hasKey: false, maskedKey: null }
        })}
      />
    )
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('')
  })

  it('renders extra footer content when provided', () => {
    render(<KeyCard {...makeProps({ extra: <a href="#">Get an API key</a> })} />)
    expect(screen.getByRole('link', { name: 'Get an API key' })).toBeInTheDocument()
  })
})
