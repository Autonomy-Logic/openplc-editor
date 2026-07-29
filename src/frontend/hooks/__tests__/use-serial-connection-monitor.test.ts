import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockSetSerialConnectionStatus = jest.fn()
const mockClearDeviceProbe = jest.fn()
const mockOpenModal = jest.fn()

const mockState: Record<string, unknown> = {
  modalActions: { openModal: mockOpenModal },
  deviceActions: {
    setSerialConnectionStatus: mockSetSerialConnectionStatus,
    clearDeviceProbe: mockClearDeviceProbe,
  },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

const mockOnConnectionStatus = jest.fn().mockReturnValue(() => undefined)

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('../../../middleware/shared/providers', () => ({
  useDevice: () => ({ onConnectionStatus: mockOnConnectionStatus }),
}))

import { useSerialConnectionMonitor } from '../use-serial-connection-monitor'

type Payload = { status: string; port: string | null; reason?: 'lost' }

/** Mount the hook and hand back the main-process push callback. */
function mountAndPush(): (payload: Payload) => void {
  renderHook(() => useSerialConnectionMonitor())
  return mockOnConnectionStatus.mock.calls[0][0] as (payload: Payload) => void
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOnConnectionStatus.mockReturnValue(() => undefined)
})

describe('useSerialConnectionMonitor', () => {
  it('subscribes once on mount and unsubscribes on unmount', () => {
    const unsubscribe = jest.fn()
    mockOnConnectionStatus.mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useSerialConnectionMonitor())
    expect(mockOnConnectionStatus).toHaveBeenCalledTimes(1)

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('mirrors every pushed status into the store', () => {
    const push = mountAndPush()

    for (const status of ['connecting', 'connected', 'disconnected', 'error'] as const) {
      push({ status, port: 'COM5' })
      expect(mockSetSerialConnectionStatus).toHaveBeenCalledWith(status, 'COM5')
    }
  })

  it('clears the device probe when the link is gone', () => {
    const push = mountAndPush()

    push({ status: 'disconnected', port: 'COM5' })
    expect(mockClearDeviceProbe).toHaveBeenCalledTimes(1)

    push({ status: 'error', port: 'COM5' })
    expect(mockClearDeviceProbe).toHaveBeenCalledTimes(2)
  })

  it('keeps the probe result while the link is being recovered', () => {
    // Recovery reports 'connecting'. The FULL/DEMO badge and device id still
    // describe this device, so clearing here would make the badge flicker every
    // time a cable is jostled.
    const push = mountAndPush()

    push({ status: 'connecting', port: 'COM5' })
    expect(mockClearDeviceProbe).not.toHaveBeenCalled()
    expect(mockSetSerialConnectionStatus).toHaveBeenCalledWith('connecting', 'COM5')
  })

  it('warns the user only when recovery gave up', () => {
    const push = mountAndPush()

    // An 'error' from something the user just clicked already has its own dialog.
    push({ status: 'error', port: 'COM5' })
    expect(mockOpenModal).not.toHaveBeenCalled()

    push({ status: 'error', port: 'COM5', reason: 'lost' })
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

    push({ status: 'connecting', port: 'COM5' })
    push({ status: 'connected', port: 'COM5' })

    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('still names the device when the port is unknown', () => {
    const push = mountAndPush()
    push({ status: 'error', port: null, reason: 'lost' })
    expect(mockOpenModal).toHaveBeenCalledWith('runtime-connection-lost', {
      label: 'the device',
      body: expect.stringContaining('the device'),
    })
  })
})
