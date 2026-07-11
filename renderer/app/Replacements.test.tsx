// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReplacementEntry } from '../../shared/types'
import Replacements from './Replacements'
import { useSettings } from './settingsContext'

vi.mock('./settingsContext', () => ({ useSettings: vi.fn() }))

afterEach(() => cleanup())

function mockSettings(replacements: ReplacementEntry[] | null, update = vi.fn()) {
  ;(useSettings as Mock).mockReturnValue({
    settings: replacements === null ? null : { replacements },
    update
  })
  return update
}

beforeEach(() => {
  vi.clearAllMocks()
  window.electronAPI = {
    setReplacements: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.electronAPI
})

describe('Replacements', () => {
  it('renders nothing in the list region while settings are still loading (null)', () => {
    mockSettings(null)
    render(<Replacements />)
    expect(screen.queryByText('No replacements yet')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no entries', () => {
    mockSettings([])
    render(<Replacements />)
    expect(screen.getByText('No replacements yet')).toBeInTheDocument()
  })

  it('renders existing entries', () => {
    mockSettings([{ id: '1', from: 'mavrik', to: 'Maverick' }])
    render(<Replacements />)
    expect(screen.getByDisplayValue('mavrik')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Maverick')).toBeInTheDocument()
  })

  it('Add stays disabled unless both fields are non-whitespace', async () => {
    mockSettings([])
    render(<Replacements />)
    const addBtn = screen.getByRole('button', { name: 'Add' })
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Heard as'), 'mavrik')
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Replace with'), '   ')
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Replace with'), 'Maverick')
    expect(addBtn).not.toBeDisabled()
  })

  it('adds a new entry, prepended, and clears the drafts', async () => {
    const update = mockSettings([{ id: 'e', from: 'a', to: 'b' }])
    render(<Replacements />)
    // draft fields are the first ("Heard as"/"Replace with") match; the
    // existing entry row is the second.
    await userEvent.type(screen.getAllByLabelText('Heard as')[0], 'mavrik')
    await userEvent.type(screen.getAllByLabelText('Replace with')[0], 'Maverick')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(update).toHaveBeenCalledWith({
      replacements: [{ id: expect.any(String), from: 'mavrik', to: 'Maverick' }, { id: 'e', from: 'a', to: 'b' }]
    })
    expect(screen.getAllByLabelText('Heard as')[0]).toHaveValue('')
    expect(screen.getAllByLabelText('Replace with')[0]).toHaveValue('')
  })

  it('adds an entry by pressing Enter in the "Replace with" field', async () => {
    const update = mockSettings([])
    render(<Replacements />)
    await userEvent.type(screen.getByLabelText('Heard as'), 'mavrik')
    await userEvent.type(screen.getByLabelText('Replace with'), 'Maverick{Enter}')
    expect(update).toHaveBeenCalledWith({ replacements: [{ id: expect.any(String), from: 'mavrik', to: 'Maverick' }] })
  })

  it('adds an entry by pressing Enter in the "Heard as" field', async () => {
    const update = mockSettings([])
    render(<Replacements />)
    await userEvent.type(screen.getByLabelText('Replace with'), 'Maverick')
    await userEvent.type(screen.getByLabelText('Heard as'), 'mavrik{Enter}')
    expect(update).toHaveBeenCalledWith({ replacements: [{ id: expect.any(String), from: 'mavrik', to: 'Maverick' }] })
  })

  it('does not add when either field is empty/whitespace-only', async () => {
    const update = mockSettings([])
    render(<Replacements />)
    await userEvent.type(screen.getByLabelText('Heard as'), '   ')
    await userEvent.type(screen.getByLabelText('Replace with'), 'Maverick{Enter}')
    expect(update).not.toHaveBeenCalled()
  })

  it('deletes an entry', async () => {
    const update = mockSettings([{ id: '1', from: 'mavrik', to: 'Maverick' }])
    render(<Replacements />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    expect(update).toHaveBeenCalledWith({ replacements: [] })
  })

  it('edits an entry locally on change and persists the whole list via electronAPI on blur', async () => {
    const update = mockSettings([{ id: '1', from: 'mavrik', to: 'Maverick' }])
    render(<Replacements />)
    // entry row is the second match after the draft field.
    const fromInput = screen.getAllByLabelText('Heard as')[1]
    // this field is a controlled input driven by the (static, mocked) entry
    // prop, not local state, so a single bulk change event is the correct way
    // to exercise onChange — character-by-character typing would fight the
    // controlled value on every re-render.
    fireEvent.change(fromInput, { target: { value: 'mavrick' } })
    expect(update).toHaveBeenCalledWith({ replacements: [{ id: '1', from: 'mavrick', to: 'Maverick' }] })
    fireEvent.blur(fromInput)
    expect(window.electronAPI.setReplacements).toHaveBeenCalled()
  })

  it('commits an edit on Enter (blurs the field)', async () => {
    mockSettings([{ id: '1', from: 'mavrik', to: 'Maverick' }])
    render(<Replacements />)
    const toInput = screen.getAllByLabelText('Replace with')[1]
    toInput.focus()
    await userEvent.keyboard('{Enter}')
    expect(toInput).not.toHaveFocus()
    expect(window.electronAPI.setReplacements).toHaveBeenCalled()
  })

  it('edits the "to" field via onChange, commits the "from" field via Enter, and leaves an untouched sibling entry alone', async () => {
    const update = mockSettings([
      { id: '1', from: 'mavrik', to: 'Maverick' },
      { id: '2', from: 'x', to: 'y' }
    ])
    render(<Replacements />)

    const toInputs = screen.getAllByLabelText('Replace with')
    fireEvent.change(toInputs[1], { target: { value: 'Maverick!' } })
    expect(update).toHaveBeenLastCalledWith({
      replacements: [
        { id: '1', from: 'mavrik', to: 'Maverick!' },
        { id: '2', from: 'x', to: 'y' }
      ]
    })

    const fromInputs = screen.getAllByLabelText('Heard as')
    fromInputs[1].focus()
    await userEvent.keyboard('{Enter}')
    expect(fromInputs[1]).not.toHaveFocus()
    expect(window.electronAPI.setReplacements).toHaveBeenCalled()
  })

  it('swallows a rejected setReplacements without throwing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(window.electronAPI.setReplacements as Mock).mockRejectedValue(new Error('nope'))
    mockSettings([{ id: '1', from: 'mavrik', to: 'Maverick' }])
    render(<Replacements />)
    const fromInput = screen.getAllByLabelText('Heard as')[1]
    fromInput.focus()
    fromInput.blur()
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalledWith('[replacements] failed to persist'))
    errSpy.mockRestore()
  })
})
