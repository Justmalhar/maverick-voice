// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import Widget from './Widget'
import type { WidgetState } from '../../shared/types'
import type { ComponentProps } from 'react'

const EXIT_MS = 200

function baseProps(overrides: Partial<ComponentProps<typeof Widget>> = {}): ComponentProps<typeof Widget> {
  return {
    state: 'recording' as WidgetState,
    mode: 'dictation',
    analyserNode: null,
    onStop: vi.fn(),
    onCancel: vi.fn(),
    onUndo: vi.fn(),
    onExited: vi.fn(),
    ...overrides
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Widget', () => {
  it('renders nothing while hidden and never was shown', () => {
    const { container } = render(<Widget {...baseProps({ state: 'hidden' })} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the recording pill, waveform, timer, and buttons', () => {
    render(<Widget {...baseProps({ state: 'recording', appName: 'Notes' })} />)
    expect(screen.getByText('Listening')).toBeTruthy()
    expect(screen.getByText('· Notes')).toBeTruthy()
    expect(screen.getByRole('timer')).toBeTruthy()
    expect(screen.getByLabelText('Stop recording')).toBeTruthy()
    expect(screen.getByLabelText('Cancel recording (Escape)')).toBeTruthy()
  })

  it('shows "Instructing" label with the bright ring in instruction mode', () => {
    const { container } = render(<Widget {...baseProps({ state: 'recording', mode: 'instruction' })} />)
    expect(screen.getByText('Instructing')).toBeTruthy()
    expect(container.querySelector('.hud-ring--bright')).not.toBeNull()
  })

  it('truncates long app names with an ellipsis', () => {
    render(<Widget {...baseProps({ state: 'recording', appName: 'A Very Long Application Name Indeed' })} />)
    expect(screen.getByText(/^· A Very Long Applic…$/)).toBeTruthy()
  })

  it('omits the chip entirely when appName is undefined', () => {
    const { container } = render(<Widget {...baseProps({ state: 'recording', appName: undefined })} />)
    expect(container.querySelector('.hud-chip')).toBeNull()
  })

  it('calls onStop and onCancel when their buttons are clicked', () => {
    const onStop = vi.fn()
    const onCancel = vi.fn()
    render(<Widget {...baseProps({ state: 'recording', onStop, onCancel })} />)
    fireEvent.click(screen.getByLabelText('Stop recording'))
    fireEvent.click(screen.getByLabelText('Cancel recording (Escape)'))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('elapsed timer counts up and flips to a countdown warning near the max duration', () => {
    render(<Widget {...baseProps({ state: 'recording' })} />)
    expect(screen.getByRole('timer').textContent).toBe('0:00')

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByRole('timer').textContent).toBe('0:03')

    // Advance close to MAX_DURATION_S (600s) so remaining <= 30s triggers warn styling.
    act(() => {
      vi.advanceTimersByTime((600 - 30 - 3) * 1000)
    })
    const timer = screen.getByRole('timer')
    expect(timer.className).toContain('hud-timer--warn')
    expect(timer.textContent?.startsWith('-')).toBe(true)
  })

  it('renders the processing state with and without the discard hint', () => {
    const { rerender } = render(<Widget {...baseProps({ state: 'processing', showDiscardHint: false })} />)
    expect(screen.getByText('Thinking…')).toBeTruthy()
    expect(screen.queryByText('Esc to discard')).toBeNull()

    rerender(<Widget {...baseProps({ state: 'processing', showDiscardHint: true })} />)
    expect(screen.getByText('Esc to discard')).toBeTruthy()
  })

  it('renders the output state check icon', () => {
    render(<Widget {...baseProps({ state: 'output' })} />)
    expect(screen.getByLabelText('Pasted')).toBeTruthy()
  })

  it('renders the fallback state with a default message when none is given', () => {
    render(<Widget {...baseProps({ state: 'fallback' })} />)
    expect(screen.getByText('Pasted without formatting')).toBeTruthy()
    expect(screen.getByText('Retry from History')).toBeTruthy()
  })

  it('renders the fallback state with a custom message', () => {
    render(<Widget {...baseProps({ state: 'fallback', fallbackMessage: 'Custom fallback' })} />)
    expect(screen.getByText('Custom fallback')).toBeTruthy()
  })

  it('renders the error state with a default message when none is given', () => {
    render(<Widget {...baseProps({ state: 'error' })} />)
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })

  it('renders the error state with a custom message', () => {
    render(<Widget {...baseProps({ state: 'error', errorMessage: 'Mic denied' })} />)
    expect(screen.getByText('Mic denied')).toBeTruthy()
  })

  it('renders the too-short state', () => {
    render(<Widget {...baseProps({ state: 'too-short' })} />)
    expect(screen.getByText("Didn't catch that")).toBeTruthy()
  })

  it('renders the cancelled state and wires the Undo button', () => {
    const onUndo = vi.fn()
    render(<Widget {...baseProps({ state: 'cancelled', onUndo })} />)
    expect(screen.getByText('Cancelled')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Undo cancel'))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('exits after EXIT_MS when transitioning to hidden, then calls onExited', () => {
    const onExited = vi.fn()
    const { rerender, container } = render(<Widget {...baseProps({ state: 'recording', onExited })} />)
    expect(screen.getByText('Listening')).toBeTruthy()

    rerender(<Widget {...baseProps({ state: 'hidden', onExited })} />)
    // Still showing the last-shown content while exiting.
    expect(screen.getByText('Listening')).toBeTruthy()
    expect(container.querySelector('.hud-pill--exit')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    expect(onExited).toHaveBeenCalledTimes(1)
    expect(container.firstChild).toBeNull()
  })

  it('re-entry during an in-flight exit clears the exit timer and shows the new state immediately', () => {
    const onExited = vi.fn()
    const { rerender, container } = render(<Widget {...baseProps({ state: 'recording', onExited })} />)
    rerender(<Widget {...baseProps({ state: 'hidden', onExited })} />)
    expect(container.querySelector('.hud-pill--exit')).not.toBeNull()

    // Re-enter with a new state before EXIT_MS elapses.
    rerender(<Widget {...baseProps({ state: 'processing', onExited })} />)
    expect(screen.getByText('Thinking…')).toBeTruthy()
    expect(container.querySelector('.hud-pill--enter')).not.toBeNull()

    // Advancing timers now must NOT fire the stale exit timeout.
    act(() => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    expect(onExited).not.toHaveBeenCalled()
  })

  it('does nothing on the hidden effect branch when never shown (visible already false)', () => {
    const onExited = vi.fn()
    render(<Widget {...baseProps({ state: 'hidden', onExited })} />)
    act(() => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    expect(onExited).not.toHaveBeenCalled()
  })

  it('cleans up the exit timer on unmount', () => {
    const onExited = vi.fn()
    const { rerender, unmount } = render(<Widget {...baseProps({ state: 'recording', onExited })} />)
    rerender(<Widget {...baseProps({ state: 'hidden', onExited })} />)
    unmount()
    act(() => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    expect(onExited).not.toHaveBeenCalled()
  })
})
