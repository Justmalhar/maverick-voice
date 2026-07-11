// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RulesSettings } from '../../shared/types'
import Rules from './Rules'
import { useSettings } from './settingsContext'

vi.mock('./settingsContext', () => ({ useSettings: vi.fn() }))

afterEach(() => cleanup())

function mockSettings(settings: { rules?: RulesSettings; autoFormat?: boolean } | null, update = vi.fn()) {
  ;(useSettings as Mock).mockReturnValue({ settings, update })
  return update
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Rules', () => {
  it('falls back to DEFAULT_RULES when settings.rules is absent', () => {
    mockSettings({})
    render(<Rules />)
    // all four built-in toggles render unchecked
    expect(screen.getByRole('switch', { name: 'Fix Grammar & Spelling' })).toHaveAttribute('aria-checked', 'false')
  })

  it('does not render the custom-rules empty state while settings are still loading (null)', () => {
    mockSettings(null)
    render(<Rules />)
    expect(screen.queryByText('No custom rules yet')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no custom rules', () => {
    mockSettings({ rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] } })
    render(<Rules />)
    expect(screen.getByText('No custom rules yet')).toBeInTheDocument()
  })

  it('renders each built-in rule reflecting its current checked state', () => {
    mockSettings({
      rules: { fixGrammar: true, removeFillers: false, smartPunctuation: true, professionalTone: false, custom: [] }
    })
    render(<Rules />)
    expect(screen.getByRole('switch', { name: 'Fix Grammar & Spelling' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Remove Filler Words' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Smart Punctuation' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Professional Tone' })).toHaveAttribute('aria-checked', 'false')
  })

  it('toggling a built-in rule persists the merged rules object', async () => {
    const update = mockSettings({
      rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    })
    render(<Rules />)
    await userEvent.click(screen.getByRole('switch', { name: 'Fix Grammar & Spelling' }))
    expect(update).toHaveBeenCalledWith({
      rules: { fixGrammar: true, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    })
  })

  it('Add rule stays disabled unless both name and instruction are non-whitespace', async () => {
    mockSettings({ rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] } })
    render(<Rules />)
    const addBtn = screen.getByRole('button', { name: 'Add rule' })
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Rule name'), 'British spelling')
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Rule instruction'), '   ')
    expect(addBtn).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Rule instruction'), 'Use British spelling')
    expect(addBtn).not.toBeDisabled()
  })

  it('adds a custom rule enabled by default, prepended, and clears the drafts', async () => {
    const update = mockSettings({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: 'e', name: 'Existing', instruction: 'do x', enabled: false }]
      }
    })
    render(<Rules />)
    // draft fields are the first match; the existing custom rule is the second.
    await userEvent.type(screen.getAllByLabelText('Rule name')[0], 'British spelling')
    await userEvent.type(screen.getAllByLabelText('Rule instruction')[0], 'Use British spelling')
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(update).toHaveBeenCalledWith({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [
          { id: expect.any(String), name: 'British spelling', instruction: 'Use British spelling', enabled: true },
          { id: 'e', name: 'Existing', instruction: 'do x', enabled: false }
        ]
      }
    })
    expect(screen.getAllByLabelText('Rule name')[0]).toHaveValue('')
    expect(screen.getAllByLabelText('Rule instruction')[0]).toHaveValue('')
  })

  it('does not add a custom rule when name or instruction is empty/whitespace-only', async () => {
    const update = mockSettings({
      rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    })
    render(<Rules />)
    await userEvent.type(screen.getByLabelText('Rule name'), '   ')
    // Add button click won't fire since disabled; call the underlying addCustom
    // guard directly is not possible, so assert via the disabled button + no update.
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    expect(update).not.toHaveBeenCalled()
  })

  it('toggles a custom rule enabled state', async () => {
    const update = mockSettings({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: '1', name: 'British', instruction: 'do x', enabled: false }]
      }
    })
    render(<Rules />)
    await userEvent.click(screen.getByRole('switch', { name: 'Enable British' }))
    expect(update).toHaveBeenCalledWith({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: '1', name: 'British', instruction: 'do x', enabled: true }]
      }
    })
  })

  it('falls back to "rule" in the toggle aria-label when a custom rule has no name yet', () => {
    mockSettings({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: '1', name: '', instruction: 'do x', enabled: false }]
      }
    })
    render(<Rules />)
    expect(screen.getByRole('switch', { name: 'Enable rule' })).toBeInTheDocument()
  })

  it('edits a custom rule name and instruction', async () => {
    const update = mockSettings({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: '1', name: 'British', instruction: 'do x', enabled: true }]
      }
    })
    render(<Rules />)
    // second "Rule name" field is the custom rule's editable name input — it's
    // a controlled field driven by the static mocked entry, so use a single
    // bulk change event rather than character-by-character typing.
    const nameInputs = screen.getAllByLabelText('Rule name')
    fireEvent.change(nameInputs[1], { target: { value: 'US spelling' } })
    expect(update).toHaveBeenCalledWith({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: '1', name: 'US spelling', instruction: 'do x', enabled: true }]
      }
    })

    const instructionInputs = screen.getAllByLabelText('Rule instruction')
    fireEvent.change(instructionInputs[1], { target: { value: 'do y' } })
    expect(update).toHaveBeenLastCalledWith({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: '1', name: 'British', instruction: 'do y', enabled: true }]
      }
    })
  })

  it('edits one custom rule, leaving a sibling custom rule untouched by the map', async () => {
    const update = mockSettings({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [
          { id: '1', name: 'British', instruction: 'do x', enabled: true },
          { id: '2', name: 'Other', instruction: 'do z', enabled: false }
        ]
      }
    })
    render(<Rules />)
    const nameInputs = screen.getAllByLabelText('Rule name')
    fireEvent.change(nameInputs[1], { target: { value: 'US spelling' } })
    expect(update).toHaveBeenCalledWith({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [
          { id: '1', name: 'US spelling', instruction: 'do x', enabled: true },
          { id: '2', name: 'Other', instruction: 'do z', enabled: false }
        ]
      }
    })
  })

  it('shows the auto-format notice when autoFormat is off', () => {
    mockSettings({
      autoFormat: false,
      rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    })
    render(<Rules />)
    expect(screen.getByText('Rules apply only while AI auto-format is on')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
  })

  it('hides the auto-format notice when autoFormat is on', () => {
    mockSettings({
      autoFormat: true,
      rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    })
    render(<Rules />)
    expect(screen.queryByText('Rules apply only while AI auto-format is on')).not.toBeInTheDocument()
  })

  it('hides the auto-format notice while settings are still loading (null)', () => {
    mockSettings(null)
    render(<Rules />)
    expect(screen.queryByText('Rules apply only while AI auto-format is on')).not.toBeInTheDocument()
  })

  it('enabling the notice calls update({ autoFormat: true })', async () => {
    const update = mockSettings({
      autoFormat: false,
      rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    })
    render(<Rules />)
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }))
    expect(update).toHaveBeenCalledWith({ autoFormat: true })
  })

  it('deletes a custom rule', async () => {
    const update = mockSettings({
      rules: {
        fixGrammar: false,
        removeFillers: false,
        smartPunctuation: false,
        professionalTone: false,
        custom: [{ id: '1', name: 'British', instruction: 'do x', enabled: true }]
      }
    })
    render(<Rules />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete rule' }))
    expect(update).toHaveBeenCalledWith({
      rules: { fixGrammar: false, removeFillers: false, smartPunctuation: false, professionalTone: false, custom: [] }
    })
  })
})
