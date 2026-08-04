import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockOpenModal = jest.fn()
const mockSetDeviceConnectionStatus = jest.fn()
const mockAddLog = jest.fn()

const mockState: Record<string, unknown> = {
  deviceDefinitions: { configuration: { deviceBoard: 'Test Board', communicationPort: 'COM5', vendorScreenData: {} } },
  deviceConnection: { status: 'disconnected', port: null },
  runtimeConnection: { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' },
  modalActions: { openModal: mockOpenModal },
  consoleActions: { addLog: mockAddLog },
  deviceActions: {
    setDeviceConnectionStatus: mockSetDeviceConnectionStatus,
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

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('@root/middleware/shared/providers/platform-context', () => ({
  useDevice: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    onConnectionStatus: mockOnConnectionStatus,
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
})
