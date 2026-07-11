// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DictionaryWord } from '../../shared/types'
import Dictionary from './Dictionary'
import { useSettings } from './settingsContext'

vi.mock('./settingsContext', () => ({ useSettings: vi.fn() }))

afterEach(() => cleanup())

function mockSettings(dictionary: DictionaryWord[] | null, update = vi.fn()) {
  ;(useSettings as Mock).mockReturnValue({
    settings: dictionary === null ? null : { dictionary },
    update
  })
  return update
}

describe('Dictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing in the list region while settings are still loading (null)', () => {
    mockSettings(null)
    render(<Dictionary />)
    expect(screen.queryByText('No words yet')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no words', () => {
    mockSettings([])
    render(<Dictionary />)
    expect(screen.getByText('No words yet')).toBeInTheDocument()
  })

  it('renders existing words', () => {
    mockSettings([{ id: '1', word: 'Maverick' }])
    render(<Dictionary />)
    expect(screen.getByText('Maverick')).toBeInTheDocument()
  })

  it('disables Add until draft has non-whitespace content', async () => {
    mockSettings([])
    render(<Dictionary />)
    const addBtn = screen.getByRole('button', { name: 'Add' })
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Word'), '   ')
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Word'), 'x')
    expect(addBtn).not.toBeDisabled()
  })

  it('adds a single word via the Add button and clears the draft', async () => {
    const update = mockSettings([])
    render(<Dictionary />)
    await userEvent.type(screen.getByLabelText('Word'), 'Maverick')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(update).toHaveBeenCalledWith({ dictionary: [{ id: expect.any(String), word: 'Maverick' }] })
    expect(screen.getByLabelText('Word')).toHaveValue('')
  })

  it('adds a word by pressing Enter', async () => {
    const update = mockSettings([])
    render(<Dictionary />)
    await userEvent.type(screen.getByLabelText('Word'), 'Groq{Enter}')
    expect(update).toHaveBeenCalledWith({ dictionary: [{ id: expect.any(String), word: 'Groq' }] })
  })

  it('splits pasted text on whitespace/commas into multiple new words, prepended', async () => {
    const update = mockSettings([{ id: 'existing', word: 'Existing' }])
    render(<Dictionary />)
    await userEvent.type(screen.getByLabelText('Word'), 'Groq, Tailwind uv')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(update).toHaveBeenCalledWith({
      dictionary: [
        { id: expect.any(String), word: 'Groq' },
        { id: expect.any(String), word: 'Tailwind' },
        { id: expect.any(String), word: 'uv' },
        { id: 'existing', word: 'Existing' }
      ]
    })
  })

  it('dedupes new words case-insensitively against existing words and does not persist if everything is a dupe', async () => {
    const update = mockSettings([{ id: 'existing', word: 'Maverick' }])
    render(<Dictionary />)
    await userEvent.type(screen.getByLabelText('Word'), 'maverick MAVERICK')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(update).not.toHaveBeenCalled()
    // draft is still cleared even when nothing new was added
    expect(screen.getByLabelText('Word')).toHaveValue('')
  })

  it('does nothing when the draft is only whitespace/commas (no tokens)', async () => {
    const update = mockSettings([])
    render(<Dictionary />)
    const input = screen.getByLabelText('Word')
    await userEvent.type(input, '   ')
    // Add button is disabled for whitespace-only, but Enter key handler
    // still runs addWords() directly — exercise the "no tokens" early return.
    await userEvent.type(input, '{Enter}')
    expect(update).not.toHaveBeenCalled()
  })

  it('deletes a word', async () => {
    const update = mockSettings([{ id: '1', word: 'Maverick' }])
    render(<Dictionary />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Maverick' }))
    expect(update).toHaveBeenCalledWith({ dictionary: [] })
  })
})
