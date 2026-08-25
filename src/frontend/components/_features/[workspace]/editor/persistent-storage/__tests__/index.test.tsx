import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockToast = vi.fn()
vi.mock('@root/frontend/components/_features/[app]/toast/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

const runtime = {
  getRetainConfig: vi.fn(),
  updateRetainConfig: vi.fn(),
}
vi.mock('@root/middleware/shared/providers', () => ({
  useRuntime: () => runtime,
}))

import { useOpenPLCStore } from '@root/frontend/store'
import type { RetainConfig } from '@root/middleware/shared/ports/runtime-port'

import { PersistentStorageEditor } from '../index'

const CONFIG: RetainConfig = {
  enabled: false,
  path: '/var/lib/openplc-runtime/retain.bin',
  flushSeconds: 5,
  defaultPath: '/var/lib/openplc-runtime/retain.bin',
  defaultFlushSeconds: 5,
  minFlushSeconds: 1,
  maxFlushSeconds: 3600,
  backend: 'none',
  backendDetail: '',
  active: false,
}

function connect(status: 'connected' | 'disconnected') {
  useOpenPLCStore.setState((s) => ({
    ...s,
    runtimeConnection: { ...s.runtimeConnection, connectionStatus: status },
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  runtime.getRetainConfig.mockResolvedValue({ success: true, config: CONFIG })
  runtime.updateRetainConfig.mockResolvedValue({ success: true, config: { ...CONFIG, enabled: true } })
  connect('connected')
})

describe('PersistentStorageEditor', () => {
  it('tells the user to connect rather than showing settings it cannot read', () => {
    connect('disconnected')
    render(<PersistentStorageEditor />)
    expect(screen.getByText(/not connected to a runtime/i)).toBeTruthy()
    expect(runtime.getRetainConfig).not.toHaveBeenCalled()
  })

  it('loads the settings on mount', async () => {
    render(<PersistentStorageEditor />)
    await waitFor(() => expect(runtime.getRetainConfig).toHaveBeenCalled())
    expect((await screen.findByLabelText(/file location/i)) as HTMLInputElement).toHaveProperty(
      'value',
      CONFIG.path,
    )
  })

  it('surfaces a read failure instead of rendering empty fields', async () => {
    runtime.getRetainConfig.mockResolvedValue({ success: false, error: 'device unreachable' })
    render(<PersistentStorageEditor />)
    expect((await screen.findByRole('alert')).textContent).toContain('device unreachable')
  })

  it('keeps Save disabled until something actually changes', async () => {
    render(<PersistentStorageEditor />)
    const save = await screen.findByRole('button', { name: /^save$/i })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends the edited settings', async () => {
    render(<PersistentStorageEditor />)
    await screen.findByLabelText(/file location/i)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText(/save every/i), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(runtime.updateRetainConfig).toHaveBeenCalledWith({
        enabled: true,
        path: CONFIG.path,
        flushSeconds: 30,
      }),
    )
  })

  it('refuses an out-of-range interval before troubling the runtime', async () => {
    render(<PersistentStorageEditor />)
    await screen.findByLabelText(/file location/i)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText(/save every/i), { target: { value: '99999' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(mockToast).toHaveBeenCalled())
    expect(runtime.updateRetainConfig).not.toHaveBeenCalled()
  })

  it("shows the runtime's own words when it refuses the settings", async () => {
    runtime.updateRetainConfig.mockResolvedValue({
      success: false,
      error: 'The directory /nope does not exist, so nothing could be written there.',
    })
    render(<PersistentStorageEditor />)
    await screen.findByLabelText(/file location/i)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringContaining('/nope does not exist') }),
      ),
    )
  })

  it('says so when a VPP driver has taken over from the file store', async () => {
    // The one thing that makes every setting on the screen inert. Left unsaid,
    // the operator sees "enabled" and goes looking for a file that never grows.
    runtime.getRetainConfig.mockResolvedValue({
      success: true,
      config: { ...CONFIG, enabled: true, backend: 'plugin', backendDetail: 'synergy', active: true },
    })
    render(<PersistentStorageEditor />)
    expect((await screen.findByRole('status')).textContent).toMatch(/hardware driver \(synergy\)/i)
  })

  it('does not claim a driver override when the file store is the one in use', async () => {
    runtime.getRetainConfig.mockResolvedValue({
      success: true,
      config: { ...CONFIG, enabled: true, backend: 'file', active: true },
    })
    render(<PersistentStorageEditor />)
    await screen.findByLabelText(/file location/i)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('Cancel puts the loaded settings back', async () => {
    render(<PersistentStorageEditor />)
    const pathField = await screen.findByLabelText(/file location/i)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(pathField, { target: { value: '/tmp/elsewhere.bin' } })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect((pathField as HTMLInputElement).value).toBe(CONFIG.path)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })
})
