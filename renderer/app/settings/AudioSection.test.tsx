// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RendererSettings } from '../../../shared/types'
import AudioSection from './AudioSection'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mockUseSettings = vi.fn()
vi.mock('../settingsContext', () => ({ useSettings: () => mockUseSettings() }))

function baseSettings(overrides: Partial<RendererSettings> = {}): RendererSettings {
  return {
    inputDeviceId: '',
    soundFeedback: false,
    chunkedTranscription: false,
    pauseMediaDuringDictation: false,
    ...overrides
  } as RendererSettings
}

function mockEnumerateDevices(devices: MediaDeviceInfo[]): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
    writable: true,
    configurable: true
  })
}

function device(deviceId: string, label: string, kind: MediaDeviceKind = 'audioinput'): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo
}

describe('AudioSection', () => {
  it('returns null while settings have not loaded', () => {
    mockUseSettings.mockReturnValue({ settings: null, update: vi.fn() })
    mockEnumerateDevices([])
    const { container } = render(<AudioSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists enumerated audio-input devices with labels and filters out non-input kinds', async () => {
    mockUseSettings.mockReturnValue({ settings: baseSettings(), update: vi.fn() })
    mockEnumerateDevices([
      device('mic-1', 'Built-in Mic'),
      device('mic-2', 'USB Mic'),
      device('cam-1', 'Webcam', 'videoinput')
    ])
    render(<AudioSection />)
    const select = await screen.findByLabelText('Microphone')
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3))
    expect(screen.getByText('Built-in Mic')).toBeInTheDocument()
    expect(screen.getByText('USB Mic')).toBeInTheDocument()
    expect(screen.queryByText('Webcam')).not.toBeInTheDocument()
  })

  it('falls back to "Microphone N" and shows the permission hint when labels are blank', async () => {
    mockUseSettings.mockReturnValue({ settings: baseSettings(), update: vi.fn() })
    mockEnumerateDevices([device('mic-1', ''), device('mic-2', '')])
    render(<AudioSection />)
    await waitFor(() => expect(screen.getByText('Microphone 1')).toBeInTheDocument())
    expect(screen.getByText('Microphone 2')).toBeInTheDocument()
    expect(
      screen.getByText('Grant microphone permission in Permissions above to see device names.')
    ).toBeInTheDocument()
  })

  it('does not show the permission hint when there are no devices at all', async () => {
    mockUseSettings.mockReturnValue({ settings: baseSettings(), update: vi.fn() })
    mockEnumerateDevices([])
    render(<AudioSection />)
    await waitFor(() => expect(screen.getByLabelText('Microphone')).toBeInTheDocument())
    expect(
      screen.queryByText('Grant microphone permission in Permissions above to see device names.')
    ).not.toBeInTheDocument()
  })

  it('falls back to the array index as the option key when deviceId is blank', async () => {
    // Covers the `d.deviceId || i` branch in the key expression.
    mockUseSettings.mockReturnValue({ settings: baseSettings(), update: vi.fn() })
    mockEnumerateDevices([device('', ''), device('mic-2', 'USB Mic')])
    render(<AudioSection />)
    await waitFor(() => expect(screen.getByText('Microphone 1')).toBeInTheDocument())
    expect(screen.getByText('USB Mic')).toBeInTheDocument()
  })

  it('logs and swallows enumerateDevices rejection', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUseSettings.mockReturnValue({ settings: baseSettings(), update: vi.fn() })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { enumerateDevices: vi.fn().mockRejectedValue(new Error('denied')) },
      writable: true,
      configurable: true
    })
    render(<AudioSection />)
    await waitFor(() => expect(errSpy).toHaveBeenCalledWith('[audio] failed to enumerate devices'))
  })

  it('dispatches update() for device selection and every toggle', async () => {
    const update = vi.fn()
    mockUseSettings.mockReturnValue({
      settings: baseSettings({ soundFeedback: false, chunkedTranscription: false, pauseMediaDuringDictation: false }),
      update
    })
    mockEnumerateDevices([device('mic-1', 'Built-in Mic')])
    const user = userEvent.setup()
    render(<AudioSection />)
    await waitFor(() => expect(screen.getByText('Built-in Mic')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Microphone'), 'mic-1')
    expect(update).toHaveBeenCalledWith({ inputDeviceId: 'mic-1' })

    await user.click(screen.getByLabelText('Sound feedback'))
    expect(update).toHaveBeenCalledWith({ soundFeedback: true })

    await user.click(screen.getByLabelText('Chunked transcription'))
    expect(update).toHaveBeenCalledWith({ chunkedTranscription: true })

    await user.click(screen.getByLabelText('Pause media while dictating'))
    expect(update).toHaveBeenCalledWith({ pauseMediaDuringDictation: true })
  })
})
