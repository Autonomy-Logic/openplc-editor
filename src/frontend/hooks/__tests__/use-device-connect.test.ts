import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockOpenModal = jest.fn()
const mockStartDeviceProbe = jest.fn()
const mockSetDeviceProbeResult = jest.fn()
const mockClearDeviceProbe = jest.fn()
const mockSetSerialConnectionStatus = jest.fn()

const mockState: Record<string, unknown> = {
  deviceDefinitions: { configuration: { deviceBoard: 'Test Board', communicationPort: 'COM5', vendorScreenData: {} } },
  serialConnection: { status: 'disconnected', port: null },
  runtimeConnection: { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' },
  modalActions: { openModal: mockOpenModal },
  deviceActions: {
    startDeviceProbe: mockStartDeviceProbe,
    setDeviceProbeResult: mockSetDeviceProbeResult,
    clearDeviceProbe: mockClearDeviceProbe,
    setSerialConnectionStatus: mockSetSerialConnectionStatus,
  },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

const mockConnect = jest.fn()
const mockDisconnect = jest.fn().mockResolvedValue({ success: true })
const mockActivateLicense = jest.fn()
const mockOnConnectionStatus = jest.fn().mockReturnValue(() => undefined)
const mockOpenExternalLink = jest.fn().mockResolvedValue({ success: true })
const mockRequestDeviceFlash = jest.fn()

let mockCaps = { isLicensable: true }
let mockResolveOutcome: unknown = {
  kind: 'config',
  channelLabel: 'RTU',
  config: { connectionType: 'rtu', connectionParams: { port: 'COM5', baudRate: '115200', slaveId: 1 } },
}

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('@root/middleware/shared/providers/platform-context', () => ({
  useDevice: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    activateLicense: mockActivateLicense,
    onConnectionStatus: mockOnConnectionStatus,
  }),
  useSystem: () => ({ openExternalLink: mockOpenExternalLink }),
}))
jest.mock('@root/middleware/shared/utils/target-capabilities', () => ({
  resolveTargetCapabilities: () => mockCaps,
}))
jest.mock('../../../backend/shared/hardware/debug-spec', () => ({
  resolveDebugConnection: () => mockResolveOutcome,
}))
jest.mock('../../utils/device-connect-events', () => ({ requestDeviceFlash: mockRequestDeviceFlash }))

import type { BoardInfo } from '@root/middleware/shared/ports/types'

import { useDeviceConnect } from '../use-device-connect'

const board = { debug: {}, vpp: { packageId: 'com.vendor.board', licenseKeyId: 'k1' } } as unknown as BoardInfo

function latestOnResponse(): (index: number) => void {
  const [, props] = mockOpenModal.mock.calls[mockOpenModal.mock.calls.length - 1]
  return (props as { onResponse: (i: number) => void }).onResponse
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCaps = { isLicensable: true }
  mockState.serialConnection = { status: 'disconnected', port: null }
  mockState.runtimeConnection = { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' }
  mockResolveOutcome = {
    kind: 'config',
    channelLabel: 'RTU',
    config: { connectionType: 'rtu', connectionParams: { port: 'COM5', baudRate: '115200', slaveId: 1 } },
  }
  mockDisconnect.mockResolvedValue({ success: true })
  mockOnConnectionStatus.mockReturnValue(() => undefined)
})

describe('useDeviceConnect', () => {
  it('subscribes to main-process connection status on mount', () => {
    renderHook(() => useDeviceConnect(board))
    expect(mockOnConnectionStatus).toHaveBeenCalledTimes(1)
  })

  it('mirrors pushed status into the store and clears the probe on a dropped link', () => {
    renderHook(() => useDeviceConnect(board))
    const pushed = mockOnConnectionStatus.mock.calls[0][0] as (p: { status: string; port: string | null }) => void
    pushed({ status: 'connected', port: 'COM5' })
    expect(mockSetSerialConnectionStatus).toHaveBeenCalledWith('connected', 'COM5')
    expect(mockClearDeviceProbe).not.toHaveBeenCalled()
    pushed({ status: 'error', port: 'COM5' })
    expect(mockSetSerialConnectionStatus).toHaveBeenCalledWith('error', 'COM5')
    expect(mockClearDeviceProbe).toHaveBeenCalledTimes(1)
  })

  it('opens a "Cannot Connect" dialog and skips connect when no RTU config resolves', async () => {
    mockResolveOutcome = { kind: 'unsupported' }
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockConnect).not.toHaveBeenCalled()
    expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'Cannot Connect' })
  })

  it('holds the link with resolved params + opts and lands the probe result', async () => {
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware', anchorHex: 'aa', licenseStatus: 'licensed' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockStartDeviceProbe).toHaveBeenCalledTimes(1)
    expect(mockSetSerialConnectionStatus).toHaveBeenCalledWith('connecting', 'COM5')
    expect(mockConnect).toHaveBeenCalledWith(
      { connectionType: 'rtu', port: 'COM5', baudRate: 115200, slaveId: 1 },
      { isLicensable: true, packageId: 'com.vendor.board', keyId: 'k1' },
    )
    expect(mockSetDeviceProbeResult).toHaveBeenCalledWith({
      status: 'connected-with-firmware',
      anchorHex: 'aa',
      licenseStatus: 'licensed',
    })
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

  it('does not prompt when the recover already licensed the device', async () => {
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware', licenseStatus: 'licensed', activation: 'activated' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('prompts Buy/Demo on a demo recover and opens the store when Buy is chosen', async () => {
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware', licenseStatus: 'unlicensed', activation: 'demo' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'License Required' })
    latestOnResponse()(0)
    expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
    latestOnResponse()(1)
    expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
  })

  it('disconnect closes the held link and clears the probe', async () => {
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.disconnect()
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockSetSerialConnectionStatus).toHaveBeenCalledWith('disconnected', null)
    expect(mockClearDeviceProbe).toHaveBeenCalled()
  })

  it('derives isConnecting / isConnected from the store status', () => {
    mockState.serialConnection = { status: 'connected', port: 'COM5' }
    const { result } = renderHook(() => useDeviceConnect(board))
    expect(result.current.isConnected).toBe(true)
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.status).toBe('connected')
  })

  it('exposes buyLicense, which opens the store', () => {
    const { result } = renderHook(() => useDeviceConnect(board))
    result.current.buyLicense()
    expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
  })

  describe('checkRuntimeLicense (F7)', () => {
    it('skips a non-licensable target', async () => {
      mockCaps = { isLicensable: false }
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockActivateLicense).not.toHaveBeenCalled()
    })

    it('skips when the runtime has no host/token', async () => {
      mockState.runtimeConnection = { ipAddress: null, jwtToken: null }
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockActivateLicense).not.toHaveBeenCalled()
    })

    it('activates over the WebSocket and lands FULL when already licensed', async () => {
      mockActivateLicense.mockResolvedValue({ success: true, probedAt: 't', outcome: 'already-licensed', anchorHex: 'aa' })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockActivateLicense).toHaveBeenCalledWith(
        { connectionType: 'websocket', host: '192.168.0.128', token: 'jwt-tok' },
        { packageId: 'com.vendor.board', keyId: 'k1' },
      )
      expect(mockSetDeviceProbeResult).toHaveBeenCalledWith({
        status: 'connected-with-firmware',
        anchorHex: 'aa',
        licenseStatus: 'licensed',
      })
      expect(mockOpenModal).not.toHaveBeenCalled()
    })

    it('lands DEMO and prompts Buy on a demo outcome', async () => {
      mockActivateLicense.mockResolvedValue({ success: true, probedAt: 't', outcome: 'demo' })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockSetDeviceProbeResult).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected-with-firmware', licenseStatus: 'unlicensed' }),
      )
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'License Required' })
      latestOnResponse()(0)
      expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
    })

    it('clears the badge when the runtime does not answer the license FCs', async () => {
      mockActivateLicense.mockResolvedValue({ success: true, probedAt: 't', outcome: 'no-id' })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockClearDeviceProbe).toHaveBeenCalled()
      expect(mockSetDeviceProbeResult).not.toHaveBeenCalled()
    })
  })
})
