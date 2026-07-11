// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snippet } from '../../shared/types'
import Snippets from './Snippets'
import { useSettings } from './settingsContext'

vi.mock('./settingsContext', () => ({ useSettings: vi.fn() }))

afterEach(() => cleanup())

function mockSettings(snippets: Snippet[] | null, update = vi.fn()) {
  ;(useSettings as Mock).mockReturnValue({
    settings: snippets === null ? null : { snippets },
    update
  })
  return update
}

beforeEach(() => {
  vi.clearAllMocks()
  window.electronAPI = {
    setSnippets: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.electronAPI
})

describe('Snippets', () => {
  it('renders nothing in the list region while settings are still loading (null)', () => {
    mockSettings(null)
    render(<Snippets />)
    expect(screen.queryByText('No snippets yet')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no snippets', () => {
    mockSettings([])
    render(<Snippets />)
    expect(screen.getByText('No snippets yet')).toBeInTheDocument()
  })

  it('renders existing snippets', () => {
    mockSettings([{ id: '1', trigger: 'my linkedin', content: 'https://linkedin.com/in/justmalhar' }])
    render(<Snippets />)
    expect(screen.getByDisplayValue('my linkedin')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://linkedin.com/in/justmalhar')).toBeInTheDocument()
  })

  it('Add snippet stays disabled unless both trigger and content are non-whitespace', async () => {
    mockSettings([])
    render(<Snippets />)
    const addBtn = screen.getByRole('button', { name: 'Add snippet' })
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Trigger phrase'), 'my linkedin')
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Expansion content'), '   ')
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Expansion content'), 'https://x.com')
    expect(addBtn).not.toBeDisabled()
  })

  it('adds a new snippet, prepended, and clears the drafts', async () => {
    const update = mockSettings([{ id: 'e', trigger: 't', content: 'c' }])
    render(<Snippets />)
    // draft fields are the first match; the existing snippet is the second.
    await userEvent.type(screen.getAllByLabelText('Trigger phrase')[0], 'my linkedin')
    await userEvent.type(screen.getAllByLabelText('Expansion content')[0], 'https://linkedin.com/in/justmalhar')
    await userEvent.click(screen.getByRole('button', { name: 'Add snippet' }))
    expect(update).toHaveBeenCalledWith({
      snippets: [
        { id: expect.any(String), trigger: 'my linkedin', content: 'https://linkedin.com/in/justmalhar' },
        { id: 'e', trigger: 't', content: 'c' }
      ]
    })
    expect(screen.getAllByLabelText('Trigger phrase')[0]).toHaveValue('')
    expect(screen.getAllByLabelText('Expansion content')[0]).toHaveValue('')
  })

  it('adds a snippet by pressing Enter in the trigger field', async () => {
    const update = mockSettings([])
    render(<Snippets />)
    await userEvent.type(screen.getByLabelText('Expansion content'), 'https://x.com')
    await userEvent.type(screen.getByLabelText('Trigger phrase'), 'my linkedin{Enter}')
    expect(update).toHaveBeenCalledWith({ snippets: [{ id: expect.any(String), trigger: 'my linkedin', content: 'https://x.com' }] })
  })

  it('does not add when either field is empty/whitespace-only', async () => {
    const update = mockSettings([])
    render(<Snippets />)
    await userEvent.type(screen.getByLabelText('Trigger phrase'), '   {Enter}')
    expect(update).not.toHaveBeenCalled()
  })

  it('deletes a snippet', async () => {
    const update = mockSettings([{ id: '1', trigger: 'my linkedin', content: 'https://x.com' }])
    render(<Snippets />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete snippet' }))
    expect(update).toHaveBeenCalledWith({ snippets: [] })
  })

  it('edits one snippet via onChange, leaving a sibling snippet untouched by the map', async () => {
    const update = mockSettings([
      { id: '1', trigger: 'my linkedin', content: 'https://x.com' },
      { id: '2', trigger: 'my github', content: 'https://y.com' }
    ])
    render(<Snippets />)
    const triggerInputs = screen.getAllByLabelText('Trigger phrase')
    fireEvent.change(triggerInputs[1], { target: { value: 'my twitter' } })
    expect(update).toHaveBeenCalledWith({
      snippets: [
        { id: '1', trigger: 'my twitter', content: 'https://x.com' },
        { id: '2', trigger: 'my github', content: 'https://y.com' }
      ]
    })
  })

  it('edits trigger locally then commits on blur via electronAPI', async () => {
    const update = mockSettings([{ id: '1', trigger: 'my linkedin', content: 'https://x.com' }])
    render(<Snippets />)
    // the existing snippet's input is the second match after the draft field;
    // it's a controlled field driven by static mocked props, so use a single
    // bulk change event rather than character-by-character typing.
    const triggerInput = screen.getAllByLabelText('Trigger phrase')[1]
    fireEvent.change(triggerInput, { target: { value: 'my github' } })
    expect(update).toHaveBeenCalledWith({ snippets: [{ id: '1', trigger: 'my github', content: 'https://x.com' }] })
    fireEvent.blur(triggerInput)
    expect(window.electronAPI.setSnippets).toHaveBeenCalled()
  })

  it('edits content locally then commits on blur via electronAPI', async () => {
    const update = mockSettings([{ id: '1', trigger: 'my linkedin', content: 'https://x.com' }])
    render(<Snippets />)
    const contentInput = screen.getAllByLabelText('Expansion content')[1]
    fireEvent.change(contentInput, { target: { value: 'https://y.com' } })
    expect(update).toHaveBeenCalledWith({ snippets: [{ id: '1', trigger: 'my linkedin', content: 'https://y.com' }] })
    fireEvent.blur(contentInput)
    expect(window.electronAPI.setSnippets).toHaveBeenCalled()
  })

  it('commits an edit on Enter in the trigger field (blurs it)', async () => {
    mockSettings([{ id: '1', trigger: 'my linkedin', content: 'https://x.com' }])
    render(<Snippets />)
    const triggerInput = screen.getAllByLabelText('Trigger phrase')[1]
    triggerInput.focus()
    await userEvent.keyboard('{Enter}')
    expect(triggerInput).not.toHaveFocus()
  })

  it('swallows a rejected setSnippets without throwing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(window.electronAPI.setSnippets as Mock).mockRejectedValue(new Error('nope'))
    mockSettings([{ id: '1', trigger: 'my linkedin', content: 'https://x.com' }])
    render(<Snippets />)
    const triggerInput = screen.getAllByLabelText('Trigger phrase')[1]
    triggerInput.focus()
    triggerInput.blur()
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalledWith('[snippets] failed to persist'))
    errSpy.mockRestore()
  })
})
