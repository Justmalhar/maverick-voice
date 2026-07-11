// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import type { ElectronAPI, PermissionsReport } from '../../../shared/types'

afterEach(() => cleanup())

// The accessibility/inputMonitoring/automation rows are gated on the
// module-scope IS_MAC constant from '../../ui' — force it per test via a
// fresh module registry (jsdom's default UA is not "Macintosh").
async function loadWithPlatform(isMac: boolean): Promise<ComponentType> {
  vi.resetModules()
  vi.doMock('../../ui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ui')>()
    return { ...actual, IS_MAC: isMac }
  })
  const mod = await import('./PermissionsSection')
  return mod.default
}

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('../../ui')
})

function mockApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  return {
    permissionsPreflight: vi.fn().mockResolvedValue(baseReport()),
    openPermissionPane: vi.fn(),
    requestMicPermission: vi.fn().mockResolvedValue(true),
    ...overrides
  } as unknown as ElectronAPI
}

function baseReport(overrides: Partial<PermissionsReport> = {}): PermissionsReport {
  return {
    mic: 'not-determined',
    accessibility: false,
    inputMonitoring: false,
    automation: 'unknown',
    listenerAlive: true,
    ...overrides
  }
}

describe('PermissionsSection', () => {
  it('shows a loading state before the preflight resolves', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn(() => new Promise<never>(() => {}))
    })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    expect(screen.getByLabelText('Checking permissions')).toBeInTheDocument()
  })

  it('shows granted mic status with no action buttons when granted', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ mic: 'granted' }))
    })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Microphone')).toBeInTheDocument())
    expect(screen.getAllByText('Granted')[0]).toBeInTheDocument()
    expect(screen.queryByText('Grant')).not.toBeInTheDocument()
    expect(screen.queryByText('Open Settings')).not.toBeInTheDocument()
  })

  it('shows "Denied" mic status with Grant + Open Settings actions', async () => {
    const openPermissionPane = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ mic: 'denied' })),
      openPermissionPane
    })
    const PermissionsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Denied')).toBeInTheDocument())
    expect(screen.getByText('Grant')).toBeInTheDocument()
    await user.click(screen.getByText('Open Settings'))
    expect(openPermissionPane).toHaveBeenCalledWith('mic')
  })

  it('shows "Not granted" for mic when not-determined, with only a Grant action', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ mic: 'not-determined' }))
    })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Not granted')).toBeInTheDocument())
    expect(screen.getByText('Grant')).toBeInTheDocument()
    expect(screen.queryByText('Open Settings')).not.toBeInTheDocument()
  })

  it('grants mic permission successfully, showing "Requesting…" meanwhile and refreshing after', async () => {
    let resolveRequest: (v: boolean) => void = () => {}
    const requestMicPermission = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRequest = resolve
        })
    )
    const permissionsPreflight = vi
      .fn()
      .mockResolvedValueOnce(baseReport({ mic: 'not-determined' }))
      .mockResolvedValueOnce(baseReport({ mic: 'granted' }))
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      requestMicPermission,
      permissionsPreflight
    })
    const PermissionsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Grant')).toBeInTheDocument())

    await user.click(screen.getByText('Grant'))
    expect(screen.getByText('Requesting…')).toBeInTheDocument()
    resolveRequest(true)
    await waitFor(() => expect(screen.getAllByText('Granted')[0]).toBeInTheDocument())
    expect(permissionsPreflight).toHaveBeenCalledTimes(2)
  })

  it('opens the mic permission pane when requestMicPermission resolves false', async () => {
    const openPermissionPane = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      requestMicPermission: vi.fn().mockResolvedValue(false),
      openPermissionPane,
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ mic: 'denied' }))
    })
    const PermissionsSection = await loadWithPlatform(false)
    const user = userEvent.setup()
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Grant')).toBeInTheDocument())
    await user.click(screen.getByText('Grant'))
    await waitFor(() => expect(openPermissionPane).toHaveBeenCalledWith('mic'))
  })

  it('refreshes the report on window focus', async () => {
    const permissionsPreflight = vi.fn().mockResolvedValue(baseReport())
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ permissionsPreflight })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(permissionsPreflight).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(permissionsPreflight).toHaveBeenCalledTimes(2))
  })

  it('swallows a permissionsPreflight rejection (stays in loading state)', async () => {
    const permissionsPreflight = vi.fn().mockRejectedValue(new Error('ipc down'))
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({ permissionsPreflight })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(permissionsPreflight).toHaveBeenCalled())
    expect(screen.getByLabelText('Checking permissions')).toBeInTheDocument()
  })

  it('hides accessibility/inputMonitoring/automation rows off-mac', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi()
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Microphone')).toBeInTheDocument())
    expect(screen.queryByText('Accessibility')).not.toBeInTheDocument()
    expect(screen.queryByText('Input Monitoring')).not.toBeInTheDocument()
    expect(screen.queryByText('Automation')).not.toBeInTheDocument()
  })

  it('shows accessibility/inputMonitoring/automation rows on mac with granted/not-granted states', async () => {
    const openPermissionPane = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      openPermissionPane,
      permissionsPreflight: vi.fn().mockResolvedValue(
        baseReport({ mic: 'granted', accessibility: true, inputMonitoring: false, automation: 'denied' })
      )
    })
    const PermissionsSection = await loadWithPlatform(true)
    const user = userEvent.setup()
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Accessibility')).toBeInTheDocument())
    expect(screen.getByText('Input Monitoring')).toBeInTheDocument()
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('Denied')).toBeInTheDocument()

    await user.click(screen.getAllByText('Open Settings')[0])
    expect(openPermissionPane).toHaveBeenCalledWith('input-monitoring')
    await user.click(screen.getAllByText('Open Settings')[1])
    expect(openPermissionPane).toHaveBeenCalledWith('automation')
  })

  it('shows the automation "unknown" status text and grants automation as granted (no action)', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ automation: 'granted', accessibility: true, inputMonitoring: true }))
    })
    const PermissionsSection = await loadWithPlatform(true)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Automation')).toBeInTheDocument())
    expect(screen.getAllByText('Granted').length).toBeGreaterThan(0)
  })

  it('shows the automation "unknown" hint text', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ automation: 'unknown' }))
    })
    const PermissionsSection = await loadWithPlatform(true)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Unknown — macOS prompts on first paste')).toBeInTheDocument())
  })

  it('opens the accessibility permission pane', async () => {
    const openPermissionPane = vi.fn()
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      openPermissionPane,
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ accessibility: false }))
    })
    const PermissionsSection = await loadWithPlatform(true)
    const user = userEvent.setup()
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Accessibility')).toBeInTheDocument())
    await user.click(screen.getAllByText('Open Settings')[0])
    expect(openPermissionPane).toHaveBeenCalledWith('accessibility')
  })

  it('renders the Linux session card with xdotool/secretService warnings', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(
        baseReport({
          linux: { sessionType: 'wayland', xdotool: false, secretService: false }
        })
      )
    })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Linux session')).toBeInTheDocument())
    expect(screen.getByText('wayland')).toBeInTheDocument()
    expect(screen.getAllByText(/xdotool/).length).toBeGreaterThan(0)
    expect(screen.getByText(/No secret-service keyring detected/)).toBeInTheDocument()
  })

  it('omits xdotool/secretService warnings when both are present', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(
        baseReport({
          linux: { sessionType: 'x11', xdotool: true, secretService: true }
        })
      )
    })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Linux session')).toBeInTheDocument())
    expect(screen.queryByText(/xdotool/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No secret-service keyring detected/)).not.toBeInTheDocument()
  })

  it('shows the listener-not-responding banner when listenerAlive is false', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ listenerAlive: false }))
    })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() =>
      expect(screen.getByText(/dictation key listener isn.t responding/)).toBeInTheDocument()
    )
  })

  it('omits the listener banner when listenerAlive is true', async () => {
    ;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = mockApi({
      permissionsPreflight: vi.fn().mockResolvedValue(baseReport({ listenerAlive: true }))
    })
    const PermissionsSection = await loadWithPlatform(false)
    render(<PermissionsSection />)
    await waitFor(() => expect(screen.getByText('Microphone')).toBeInTheDocument())
    expect(screen.queryByText(/dictation key listener isn.t responding/)).not.toBeInTheDocument()
  })
})
