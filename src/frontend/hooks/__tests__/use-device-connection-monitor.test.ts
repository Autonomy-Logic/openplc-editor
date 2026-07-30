import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockSetDeviceConnectionStatus = jest.fn()
const mockClearDeviceProbe = jest.fn()
const mockOpenModal = jest.fn()
const mockAddLog = jest.fn()

const mockOpenRuntimeSession = jest.fn().mockResolvedValue({ success: true })
const mockCloseRuntimeSession = jest.fn().mockResolvedValue({ success: true })
const mockResolveRuntimeDebugChannel = jest.fn(() => null as unknown)

const mockState: Record<string, unknown> = {
  modalActions: { openModal: mockOpenModal },
  consoleActions: { addLog: mockAddLog },
  runtimeConnection: { connectionStatus: 'disconnected', jwtToken: null, ipAddress: null },
  deviceDefinitions: { configuration: { deviceBoard: 'OpenPLC Runtime v4' } },
  deviceAvailableOptions: { availableBoards: new Map() },
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
  useDevice: () => ({
    onConnectionStatus: mockOnConnectionStatus,
    onLinkLog: mockOnLinkLog,
    openRuntimeSession: mockOpenRuntimeSession,
    closeRuntimeSession: mockCloseRuntimeSession,
  }),
}))
jest.mock('../../services/device-link-resolution', () => ({
  resolveRuntimeDebugChannel: (...args: unknown[]) => mockResolveRuntimeDebugChannel(...(args as [])),
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
  mockResolveRuntimeDebugChannel.mockReturnValue(null)
  mockState.runtimeConnection = { connectionStatus: 'disconnected', jwtToken: null, ipAddress: null }
})

describe('useDeviceConnectionMonitor', () => {
  describe('runtime sessions', () => {
    it('opens a session when a runtime login comes up', () => {
      // A runtime is controlled over REST, which is connectionless — logging in IS
      // what establishes its session.
      mockState.runtimeConnection = { connectionStatus: 'connected', jwtToken: 'jwt', ipAddress: '10.0.0.5' }
      mockState.deviceAvailableOptions = {
        availableBoards: new Map([['OpenPLC Runtime v4', { debug: { channels: [] } }]]),
      }
      const debugChannel = { connectionType: 'websocket', connectionParams: { ipAddress: '10.0.0.5' } }
      mockResolveRuntimeDebugChannel.mockReturnValue(debugChannel)

      renderHook(() => useDeviceConnectionMonitor())

      expect(mockOpenRuntimeSession).toHaveBeenCalledWith({ address: '10.0.0.5', debug: debugChannel })
    })

    it('closes the session when the runtime connection goes down', () => {
      renderHook(() => useDeviceConnectionMonitor())
      expect(mockCloseRuntimeSession).toHaveBeenCalledTimes(1)
      expect(mockOpenRuntimeSession).not.toHaveBeenCalled()
    })
  })

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
      expect(mockSetDeviceConnectionStatus).toHaveBeenCalledWith(status, 'COM5', 'rtu')
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
    expect(mockSetDeviceConnectionStatus).toHaveBeenCalledWith('connecting', 'COM5', null)
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
