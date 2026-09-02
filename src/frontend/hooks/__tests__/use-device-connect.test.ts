import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockOpenModal = jest.fn()
const mockAddLog = jest.fn()

/**
 * Writes through to `mockState`, like the real action does. The hook reads the
 * live status back to decide whether a settled state still needs publishing, so a
 * write-only spy would make that branch untestable.
 */
const mockSetDeviceConnectionStatus = jest.fn((status: string, port: string | null = null) => {
  mockState.deviceConnection = { status, port }
})

/** The status the store ended up in — what the Connect button actually reads. */
const currentStatus = (): string => (mockState.deviceConnection as { status: string }).status

const mockStartLicenseCheck = jest.fn()
const mockSetLicenseReport = jest.fn()
const mockClearDeviceLicense = jest.fn()
const mockSetAwaitingPurchase = jest.fn()

const mockState: Record<string, unknown> = {
  deviceDefinitions: { configuration: { deviceBoard: 'Test Board', communicationPort: 'COM5', vendorScreenData: {} } },
  deviceConnection: { status: 'disconnected', port: null },
  deviceLicense: { phase: 'idle', report: null, awaitingPurchaseUntil: null },
  runtimeConnection: { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' },
  modalActions: { openModal: mockOpenModal },
  consoleActions: { addLog: mockAddLog },
  deviceActions: {
    setDeviceConnectionStatus: mockSetDeviceConnectionStatus,
    startDeviceLicenseCheck: mockStartLicenseCheck,
    setDeviceLicenseReport: mockSetLicenseReport,
    clearDeviceLicense: mockClearDeviceLicense,
    setAwaitingPurchase: mockSetAwaitingPurchase,
  },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

const mockConnect = jest.fn()
const mockDisconnect = jest.fn().mockResolvedValue({ success: true })
const mockOnConnectionStatus = jest.fn().mockReturnValue(() => undefined)
const mockResolveDeviceLinkWithUx = jest.fn((..._args: unknown[]) => Promise.resolve(mockResolution))
const mockRequestDeviceFlash = jest.fn()

/** What the shared resolution returns: ordered ways to reach the device. */
const serialCandidate = {
  channelLabel: 'Modbus RTU',
  channelIndex: 0,
  config: { connectionType: 'rtu', connectionParams: { port: 'COM5', baudRate: 115200, slaveId: 1 } },
}
/** Shape the hook consumes: what can be tried now, and what needs input first. */
let mockResolution: unknown = { candidates: [serialCandidate], awaitingInput: [] }

const mockReadLicense = jest.fn()
const mockRefreshLicense = jest.fn()
const mockOpenExternalLink = jest.fn().mockResolvedValue({ success: true })

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('@root/middleware/shared/providers/platform-context', () => ({
  useDevice: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    onConnectionStatus: mockOnConnectionStatus,
    readLicense: mockReadLicense,
    refreshLicense: mockRefreshLicense,
  }),
  useSystem: () => ({
    getEdgeFrontendUrl: () => 'https://edge.example.com',
    openExternalLink: mockOpenExternalLink,
  }),
}))
jest.mock('../../services/device-link-resolution', () => ({
  resolveDeviceLinkWithUx: (...args: unknown[]) => mockResolveDeviceLinkWithUx(...args),
}))
jest.mock('../../utils/device-connect-events', () => ({ requestDeviceFlash: mockRequestDeviceFlash }))

import type { BoardInfo } from '@root/middleware/shared/ports/types'

import { useDeviceConnect } from '../use-device-connect'

const board = { debug: {} } as unknown as BoardInfo

function latestOnResponse(): (index: number) => void {
  const [, props] = mockOpenModal.mock.calls[mockOpenModal.mock.calls.length - 1]
  return (props as { onResponse: (i: number) => void }).onResponse
}

beforeEach(() => {
  jest.clearAllMocks()
  mockState.deviceConnection = { status: 'disconnected', port: null }
  mockState.runtimeConnection = { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' }
  mockResolution = { candidates: [serialCandidate], awaitingInput: [] }
  mockDisconnect.mockResolvedValue({ success: true })
  mockOnConnectionStatus.mockReturnValue(() => undefined)
})

describe('useDeviceConnect', () => {
  // Mirroring pushed link status is NOT this hook's job: the link outlives the
  // device screen, so that subscription lives in `useDeviceConnectionMonitor`
  // (mounted at workspace level) and is tested there.

  const tcpCandidate = {
    channelLabel: 'Modbus TCP',
    channelIndex: 0,
    config: { connectionType: 'tcp', connectionParams: { ipAddress: '192.168.0.50' } },
  }

  it('hands the connection EVERY resolved candidate, in order', async () => {
    // Connect does not choose a transport: the main process tries the list and
    // keeps the first that answers, which is what lets a stale Modbus TCP address
    // fall through to the cable. Choosing here is what previously stranded a
    // Modbus-TCP-only project on "select a communication port".
    mockResolution = { candidates: [serialCandidate, tcpCandidate], awaitingInput: [] }
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })

    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()

    expect(mockConnect).toHaveBeenCalledWith([serialCandidate.config, tcpCandidate.config])
  })

  it('does nothing when resolution was cancelled or impossible', async () => {
    // The shared resolution has already told the user why (a cancelled prompt is
    // the user's answer), so this must not stack a second dialog on top.
    mockResolution = null

    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()

    expect(mockConnect).not.toHaveBeenCalled()
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('never asks for a DHCP address when a silent candidate connects', async () => {
    // The user's report: with DHCP on, Connect asked for an address before trying
    // anything. With a cable attached that question is pure interruption, so the
    // deferred channel must stay unasked when the cable works.
    mockResolution = { candidates: [serialCandidate], awaitingInput: [1] }
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })

    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()

    expect(mockResolveDeviceLinkWithUx).toHaveBeenCalledTimes(1)
    expect(mockResolveDeviceLinkWithUx.mock.calls[0][2]).toMatchObject({ deferPrompts: true })
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('asks for the deferred address only after the silent candidates fail', async () => {
    mockResolveDeviceLinkWithUx
      .mockImplementationOnce(() => Promise.resolve({ candidates: [serialCandidate], awaitingInput: [1] }))
      .mockImplementationOnce(() => Promise.resolve({ candidates: [tcpCandidate], awaitingInput: [] }))
    mockConnect
      .mockResolvedValueOnce({ status: 'no-response' })
      .mockResolvedValueOnce({ status: 'connected-with-firmware' })

    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()

    // Second resolve targets ONLY the channel that needed input.
    expect(mockResolveDeviceLinkWithUx).toHaveBeenCalledTimes(2)
    expect(mockResolveDeviceLinkWithUx.mock.calls[1][2]).toMatchObject({ onlyChannels: [1] })
    expect(mockConnect).toHaveBeenNthCalledWith(2, [tcpCandidate.config])
    // It connected on the second pass, so no failure dialog.
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('names every endpoint it tried when nothing answers', async () => {
    mockResolution = { candidates: [serialCandidate, tcpCandidate], awaitingInput: [] }
    mockConnect.mockResolvedValue({ status: 'no-response' })

    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()

    const [, props] = mockOpenModal.mock.calls[0]
    expect((props as { message: string }).message).toContain('192.168.0.50')
    expect((props as { message: string }).message).toContain('COM5')
  })

  it('marks the link as connecting before handing the candidates over', async () => {
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockSetDeviceConnectionStatus).toHaveBeenCalledWith('connecting', null)
    expect(mockConnect).toHaveBeenCalledWith([serialCandidate.config])
  })

  it('opens no dialog when a firmware answered', async () => {
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('shows a no-response error dialog', async () => {
    mockConnect.mockResolvedValue({ status: 'no-response' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'No Response' })
  })

  it('surfaces a connection error', async () => {
    mockConnect.mockResolvedValue({ status: 'error', error: 'boom' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'Connection Error', message: 'boom' })
  })

  it('offers to flash on no-firmware and requests a build when accepted', async () => {
    mockConnect.mockResolvedValue({ status: 'no-firmware' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'No Firmware Detected' })
    latestOnResponse()(0)
    expect(mockRequestDeviceFlash).toHaveBeenCalledTimes(1)
    latestOnResponse()(1)
    expect(mockRequestDeviceFlash).toHaveBeenCalledTimes(1)
  })

  it('disconnect closes the held link', async () => {
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.disconnect()
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockSetDeviceConnectionStatus).toHaveBeenCalledWith('disconnected', null)
  })

  it('derives isConnecting / isConnected from the store status', () => {
    mockState.deviceConnection = { status: 'connected', port: 'COM5' }
    const { result } = renderHook(() => useDeviceConnect(board))
    expect(result.current.isConnected).toBe(true)
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.status).toBe('connected')
  })

  /**
   * The Connect button is disabled while the status reads 'connecting', and
   * Disconnect only fires when it reads 'connected'. So a status left at
   * 'connecting' is a dead button with no way back short of reopening the project.
   * Every path out of `connect()` must therefore leave a settled status — including
   * the ones that never reach the main process, which is where the wedge was.
   */
  describe('never leaves the button stuck on "connecting"', () => {
    it('settles when the user cancels the address prompt and nothing else was tried', async () => {
      // A DHCP-only target: no silent candidate at all, one channel awaiting input.
      // Cancelling the prompt used to leave 'connecting' set forever, because
      // device.connect() was never called and so nothing ever pushed a status.
      mockResolveDeviceLinkWithUx
        .mockImplementationOnce(() => Promise.resolve({ candidates: [], awaitingInput: [0] }))
        .mockImplementationOnce(() => Promise.resolve(null))

      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.connect()

      expect(mockConnect).not.toHaveBeenCalled()
      expect(currentStatus()).toBe('disconnected')
      // Nothing was attempted, so there is no failure to report either.
      expect(mockOpenModal).not.toHaveBeenCalled()
    })

    it('settles when the prompted pass resolves no usable candidate', async () => {
      mockResolveDeviceLinkWithUx
        .mockImplementationOnce(() => Promise.resolve({ candidates: [], awaitingInput: [0] }))
        .mockImplementationOnce(() => Promise.resolve({ candidates: [], awaitingInput: [] }))

      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.connect()

      expect(currentStatus()).toBe('disconnected')
    })

    it('settles after a failure dialog', async () => {
      mockConnect.mockResolvedValue({ status: 'no-response' })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.connect()
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'No Response' })
      expect(currentStatus()).toBe('disconnected')
    })

    it('settles when the connect IPC call rejects outright', async () => {
      mockConnect.mockRejectedValue(new Error('bridge is gone'))
      const { result } = renderHook(() => useDeviceConnect(board))
      await expect(result.current.connect()).rejects.toThrow('bridge is gone')
      expect(currentStatus()).toBe('disconnected')
    })

    it('leaves a successful connection alone for the main process to publish', async () => {
      // The status push and this reply travel separate IPC channels, so settling on
      // success too would risk overwriting 'connected' with a spurious flicker.
      mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.connect()
      expect(currentStatus()).toBe('connecting')
      expect(mockSetDeviceConnectionStatus).not.toHaveBeenCalledWith('disconnected', null)
    })
  })

  // -----------------------------------------------------------------------
  // VPP licensing
  // -----------------------------------------------------------------------
  describe('licensing', () => {
    /** A board whose VPP is sold licensed. `board` above deliberately is not. */
    const licensedBoard = {
      compiler: 'arduino-cli',
      core: 'esp32:esp32',
      preview: '',
      specs: {},
      debug: {},
      capabilities: { isLicensable: true },
      vpp: {
        packageId: 'com.openplc.espressif-licensed',
        vendor: 'Espressif',
        deviceId: 'esp32-generic',
        packagePath: '/pkg',
        screens: {},
        moduleSystem: { enabled: false, maxSlots: 0, modules: [] },
      },
    } as unknown as BoardInfo

    it('runs NO licensing traffic for a board whose VPP is not sold licensed', async () => {
      // The common case, and the reason licensability is the first gate: a free
      // board's connect must be exactly what it was before licensing existed.
      mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })

      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.connect()

      expect(mockRefreshLicense).not.toHaveBeenCalled()
      expect(mockReadLicense).not.toHaveBeenCalled()
      expect(mockOpenModal).not.toHaveBeenCalled()
    })

    it('settles the licence over the held link after a successful connect', async () => {
      mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
      mockRefreshLicense.mockResolvedValue({
        deviceId: '659a3520540f803625ddc34081e893d3',
        outcome: { state: 'licensed', how: 'already-stored' },
      })

      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.connect()

      expect(mockRefreshLicense).toHaveBeenCalledWith({ packageId: 'com.openplc.espressif-licensed' })
      expect(mockSetLicenseReport).toHaveBeenCalledWith({
        deviceId: '659a3520540f803625ddc34081e893d3',
        outcome: { state: 'licensed', how: 'already-stored' },
      })
      // A licensed device is a silent success — no dialog on every connect.
      expect(mockOpenModal).not.toHaveBeenCalled()
    })

    it('does not touch licensing when no firmware answered', async () => {
      // There is nothing to ask: the flash dialog is the whole message, and a
      // licence dialog stacked on top of it would bury it.
      mockConnect.mockResolvedValue({ status: 'no-firmware' })

      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.connect()

      expect(mockRefreshLicense).not.toHaveBeenCalled()
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'No Firmware Detected' })
    })

    it('does not touch licensing when the device never answered at all', async () => {
      mockConnect.mockResolvedValue({ status: 'no-response' })

      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.connect()

      expect(mockRefreshLicense).not.toHaveBeenCalled()
    })

    it('prompts about demo mode and offers a purchase when the backend reports no entitlement', async () => {
      mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
      mockRefreshLicense.mockResolvedValue({
        deviceId: '659a3520540f803625ddc34081e893d3',
        outcome: { state: 'unlicensed', entitlementChecked: true },
      })

      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.connect()

      const [, props] = mockOpenModal.mock.calls[0]
      expect(props).toMatchObject({ title: 'No Licence for This Device' })
      expect((props as { buttons: string[] }).buttons).toEqual(['Buy Licence', 'Continue in Demo Mode'])

      // Buying opens the device-BOUND purchase page: the id derived main-side is
      // what makes the purchase attach to this board rather than to nothing.
      latestOnResponse()(0)
      await Promise.resolve()
      expect(mockOpenExternalLink).toHaveBeenCalledWith(
        'https://edge.example.com/buy?vppId=com.openplc.espressif-licensed&deviceId=659a3520540f803625ddc34081e893d3',
      )
    })

    it('reports a failed check as a failure, never as "not licensed"', async () => {
      mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
      mockRefreshLicense.mockResolvedValue({
        outcome: { state: 'check-failed', error: 'Activation request failed: 429' },
      })

      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.connect()

      const [, props] = mockOpenModal.mock.calls[0]
      expect(props).toMatchObject({ title: 'Licence Check Failed' })
      expect((props as { buttons: string[] }).buttons).not.toContain('Buy Licence')
    })

    it('re-runs the flow when the user retries, and explains the NEW outcome', async () => {
      // What makes a purchase completed in the browser land without a reconnect.
      mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
      mockRefreshLicense
        .mockResolvedValueOnce({ outcome: { state: 'check-failed', error: 'Request timeout' } })
        .mockResolvedValueOnce({
          deviceId: '659a3520540f803625ddc34081e893d3',
          outcome: { state: 'licensed', how: 'activated' },
        })

      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.connect()
      expect(mockOpenModal).toHaveBeenCalledTimes(1)

      latestOnResponse()(0)
      await Promise.resolve()
      await Promise.resolve()

      expect(mockRefreshLicense).toHaveBeenCalledTimes(2)
      // The retry succeeded, and success is silent — no second dialog.
      expect(mockOpenModal).toHaveBeenCalledTimes(1)
    })

    it('turns a rejected licensing IPC call into check-failed rather than losing it', async () => {
      mockConnect.mockResolvedValue({ status: 'connected-with-firmware' })
      mockRefreshLicense.mockRejectedValue(new Error('bridge is gone'))

      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.connect()

      expect(mockSetLicenseReport).toHaveBeenCalledWith({
        outcome: { state: 'check-failed', error: 'bridge is gone' },
      })
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'Licence Check Failed' })
    })

    it('drops the licence on a DELIBERATE disconnect', async () => {
      // The user is done with this device; a badge left behind would assert
      // possession for hardware nothing is talking to. A link that merely DROPS
      // keeps it — that is the device slice's job, not this hook's.
      const { result } = renderHook(() => useDeviceConnect(licensedBoard))
      await result.current.disconnect()

      expect(mockClearDeviceLicense).toHaveBeenCalledTimes(1)
    })
  })
})
