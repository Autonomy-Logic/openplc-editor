import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockSetDeviceConnectionStatus = jest.fn()
const mockClearDeviceProbe = jest.fn()
const mockOpenModal = jest.fn()
const mockAddLog = jest.fn()

const mockState: Record<string, unknown> = {
  modalActions: { openModal: mockOpenModal },
  consoleActions: { addLog: mockAddLog },
  deviceActions: {
    setDeviceConnectionStatus: mockSetDeviceConnectionStatus,
    clearDeviceProbe: mockClearDeviceProbe,
  },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

const mockOnConnectionStatus = jest.fn().mockReturnValue(() => undefined)
const mockOnLinkLog = jest.fn().mockReturnValue(() => undefined)

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('../../../middleware/shared/providers', () => ({
  useDevice: () => ({ onConnectionStatus: mockOnConnectionStatus, onLinkLog: mockOnLinkLog }),
}))

import { useDeviceConnectionMonitor } from '../use-device-connection-monitor'

type Payload = { status: string; descriptor?: string; transport?: 'rtu' | 'tcp'; reason?: 'lost' }

/** Mount the hook and hand back the main-process push callback. */
function mountAndPush(): (payload: Payload) => void {
  renderHook(() => useDeviceConnectionMonitor())
  return mockOnConnectionStatus.mock.calls[0][0] as (payload: Payload) => void
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOnConnectionStatus.mockReturnValue(() => undefined)
  mockOnLinkLog.mockReturnValue(() => undefined)
})

describe('useDeviceConnectionMonitor', () => {
  it('mirrors the main-process connection trace into the console', () => {
    // The decisions worth reading happen in the main process; the console is where
    // a user can actually see and copy them while reproducing a problem.
    renderHook(() => useDeviceConnectionMonitor())
    const emit = mockOnLinkLog.mock.calls[0][0] as (message: string) => void

    emit('open: 2 candidate(s) in order: tcp 192.168.2.20, rtu /dev/ttyACM0')

    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', message: expect.stringContaining('tcp 192.168.2.20') }),
    )
  })

  it('subscribes once on mount and unsubscribes on unmount', () => {
    const unsubscribe = jest.fn()
    mockOnConnectionStatus.mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useDeviceConnectionMonitor())
    expect(mockOnConnectionStatus).toHaveBeenCalledTimes(1)

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('mirrors every pushed status into the store', () => {
    const push = mountAndPush()

    for (const status of ['connecting', 'connected', 'disconnected', 'error'] as const) {
      push({ status, descriptor: 'COM5', transport: 'rtu' })
      expect(mockSetDeviceConnectionStatus).toHaveBeenCalledWith(status, 'COM5')
    }
  })

  it('clears the device probe when the link is gone', () => {
    const push = mountAndPush()

    push({ status: 'disconnected', descriptor: 'COM5' })
    expect(mockClearDeviceProbe).toHaveBeenCalledTimes(1)

    push({ status: 'error', descriptor: 'COM5' })
    expect(mockClearDeviceProbe).toHaveBeenCalledTimes(2)
  })

  it('keeps the probe result while the link is being recovered', () => {
    // Recovery reports 'connecting'. The FULL/DEMO badge and device id still
    // describe this device, so clearing here would make the badge flicker every
    // time a cable is jostled.
    const push = mountAndPush()

    push({ status: 'connecting', descriptor: 'COM5' })
    expect(mockClearDeviceProbe).not.toHaveBeenCalled()
    expect(mockSetDeviceConnectionStatus).toHaveBeenCalledWith('connecting', 'COM5')
  })

  it('warns the user only when recovery gave up', () => {
    const push = mountAndPush()

    // An 'error' from something the user just clicked already has its own dialog.
    push({ status: 'error', descriptor: 'COM5' })
    expect(mockOpenModal).not.toHaveBeenCalled()

    push({ status: 'error', descriptor: 'COM5', reason: 'lost' })
    expect(mockOpenModal).toHaveBeenCalledTimes(1)
    const [modalId, data] = mockOpenModal.mock.calls[0]
    expect(modalId).toBe('runtime-connection-lost')
    expect(data).toMatchObject({ label: 'COM5' })
    expect(String((data as { body: string }).body)).toContain('COM5')
  })

  it('does not warn while the link is merely reconnecting', () => {
    // The whole point of recovery: a cable pulled and plugged back in must not
    // interrupt the user with a dialog.
    const push = mountAndPush()

    push({ status: 'connecting', descriptor: 'COM5' })
    push({ status: 'connected', descriptor: 'COM5' })

    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('still names the device when the endpoint is unknown', () => {
    const push = mountAndPush()
    push({ status: 'error', reason: 'lost' })
    expect(mockOpenModal).toHaveBeenCalledWith('runtime-connection-lost', {
      label: 'the device',
      body: expect.stringContaining('the device'),
    })
  })

  it('advises the right thing to check for the transport that dropped', () => {
    // "Check the cable" is useless advice for a link that ran over ethernet.
    const push = mountAndPush()
    push({ status: 'error', descriptor: '192.168.0.50', transport: 'tcp', reason: 'lost' })

    const [, data] = mockOpenModal.mock.calls[0]
    expect((data as { body: string }).body).toContain('192.168.0.50')
    expect((data as { body: string }).body).toContain('network')
    expect((data as { body: string }).body).not.toContain('cable')
  })
})
