import { renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.
const mockOpenModal = jest.fn()
const mockStartDeviceProbe = jest.fn()
// Lands the result in `mockState` the way the real slice action does. The buy
// deep link reads the device id back out of the store, so a stub that swallowed
// the write would make the whole connect -> prompt -> buy chain untestable.
const mockSetDeviceProbeResult = jest.fn((result: unknown) => {
  mockState.deviceProbeInfo = { phase: 'done', result }
})
const mockClearDeviceProbe = jest.fn()
const mockSetDeviceConnectionStatus = jest.fn()
const mockAddLog = jest.fn()

/** A real derived device id (32 hex) — the `/buy` page rejects anything else. */
const DEVICE_ID = '7146518f9842adacfadc731ee7f546e5'

const mockState: Record<string, unknown> = {
  deviceDefinitions: { configuration: { deviceBoard: 'Test Board', communicationPort: 'COM5', vendorScreenData: {} } },
  deviceConnection: { status: 'disconnected', port: null },
  runtimeConnection: { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' },
  deviceProbeInfo: { phase: 'idle', result: null },
  modalActions: { openModal: mockOpenModal },
  consoleActions: { addLog: mockAddLog },
  deviceActions: {
    startDeviceProbe: mockStartDeviceProbe,
    setDeviceProbeResult: mockSetDeviceProbeResult,
    clearDeviceProbe: mockClearDeviceProbe,
    setDeviceConnectionStatus: mockSetDeviceConnectionStatus,
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
const mockResolveDeviceLinkWithUx = jest.fn((..._args: unknown[]) => Promise.resolve(mockResolution))
const mockOpenExternalLink = jest.fn().mockResolvedValue({ success: true })
const mockRequestDeviceFlash = jest.fn()

let mockCaps = { isLicensable: true }
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
    activateLicense: mockActivateLicense,
    onConnectionStatus: mockOnConnectionStatus,
  }),
  useSystem: () => ({ openExternalLink: mockOpenExternalLink, getEdgeFrontendUrl: () => 'https://edge.test' }),
}))
jest.mock('@root/middleware/shared/utils/target-capabilities', () => ({
  resolveTargetCapabilities: () => mockCaps,
}))
jest.mock('../../services/device-link-resolution', () => ({
  resolveDeviceLinkWithUx: (...args: unknown[]) => mockResolveDeviceLinkWithUx(...args),
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
  mockState.deviceConnection = { status: 'disconnected', port: null }
  mockState.runtimeConnection = { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' }
  mockState.deviceProbeInfo = { phase: 'idle', result: null }
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
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware', activation: 'full' })

    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()

    expect(mockConnect).toHaveBeenCalledWith(
      [serialCandidate.config, tcpCandidate.config],
      expect.objectContaining({ packageId: 'com.vendor.board' }),
    )
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
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware', activation: 'full' })

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
      .mockResolvedValueOnce({ status: 'connected-with-firmware', activation: 'full' })

    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()

    // Second resolve targets ONLY the channel that needed input.
    expect(mockResolveDeviceLinkWithUx).toHaveBeenCalledTimes(2)
    expect(mockResolveDeviceLinkWithUx.mock.calls[1][2]).toMatchObject({ onlyChannels: [1] })
    expect(mockConnect).toHaveBeenNthCalledWith(2, [tcpCandidate.config], expect.anything())
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

  it('holds the link with resolved params + opts and lands the probe result', async () => {
    mockConnect.mockResolvedValue({ status: 'connected-with-firmware', anchorHex: 'aa', licenseStatus: 'licensed' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockStartDeviceProbe).toHaveBeenCalledTimes(1)
    expect(mockConnect).toHaveBeenCalledWith(
      [serialCandidate.config],
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

  it('prompts Buy/Demo on a demo recover and buys FOR THIS DEVICE when Buy is chosen', async () => {
    mockConnect.mockResolvedValue({
      status: 'connected-with-firmware',
      licenseStatus: 'unlicensed',
      activation: 'demo',
      deviceId: DEVICE_ID,
    })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'License Required' })
    latestOnResponse()(0)
    // The id landed by the connect probe must reach the purchase link — this is
    // the whole chain the flow was missing.
    expect(mockOpenExternalLink).toHaveBeenCalledWith(
      `https://edge.test/buy?vppId=com.vendor.board&deviceId=${DEVICE_ID}`,
    )
    latestOnResponse()(1)
    expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
  })

  // The main process distinguishes a transport/backend failure from a confirmed
  // "no license". If the renderer drops `activation`/`error` on the way to the
  // store, the badge cannot tell them apart and that work is wasted.
  it('carries the failed-check verdict into the store instead of dropping it', async () => {
    mockConnect.mockResolvedValue({
      status: 'connected-with-firmware',
      licenseStatus: 'unlicensed',
      activation: 'error',
      deviceId: DEVICE_ID,
      error: 'Activation request failed: 503 Service Unavailable',
    })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockSetDeviceProbeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        activation: 'error',
        error: 'Activation request failed: 503 Service Unavailable',
      }),
    )
    // And no buy prompt: we never learned whether this device is entitled.
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('disconnect closes the held link and clears the probe', async () => {
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.disconnect()
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockSetDeviceConnectionStatus).toHaveBeenCalledWith('disconnected', null)
    expect(mockClearDeviceProbe).toHaveBeenCalled()
  })

  it('derives isConnecting / isConnected from the store status', () => {
    mockState.deviceConnection = { status: 'connected', port: 'COM5' }
    const { result } = renderHook(() => useDeviceConnect(board))
    expect(result.current.isConnected).toBe(true)
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.status).toBe('connected')
  })

  describe('buyLicense (D68a deep link)', () => {
    // The whole point of the link: a purchase can only be bound to a device the
    // page was told about. Opening a bare store page sold nothing.
    it('opens /buy carrying this VPP and this device', () => {
      mockState.deviceProbeInfo = { phase: 'done', result: { status: 'connected-with-firmware', deviceId: DEVICE_ID } }
      const { result } = renderHook(() => useDeviceConnect(board))
      result.current.buyLicense()
      expect(mockOpenExternalLink).toHaveBeenCalledWith(
        `https://edge.test/buy?vppId=com.vendor.board&deviceId=${DEVICE_ID}`,
      )
    })

    it('reads the device id at call time, not from a stale closure', () => {
      mockState.deviceProbeInfo = { phase: 'idle', result: null }
      const { result } = renderHook(() => useDeviceConnect(board))
      mockState.deviceProbeInfo = { phase: 'done', result: { status: 'connected-with-firmware', deviceId: DEVICE_ID } }
      result.current.buyLicense()
      expect(mockOpenExternalLink).toHaveBeenCalledWith(
        `https://edge.test/buy?vppId=com.vendor.board&deviceId=${DEVICE_ID}`,
      )
    })

    it('explains itself instead of opening a link the page would reject', () => {
      mockState.deviceProbeInfo = { phase: 'idle', result: null }
      const { result } = renderHook(() => useDeviceConnect(board))
      result.current.buyLicense()
      expect(mockOpenExternalLink).not.toHaveBeenCalled()
      expect(mockOpenModal).toHaveBeenCalledTimes(1)
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'Cannot Open Purchase Page' })
    })
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
      mockActivateLicense.mockResolvedValue({
        success: true,
        probedAt: 't',
        outcome: 'already-licensed',
        licenseStatus: 'licensed',
        activation: 'already-licensed',
        anchorHex: 'aa',
      })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockActivateLicense).toHaveBeenCalledWith(
        { connectionType: 'websocket', host: '192.168.0.128', token: 'jwt-tok' },
        { packageId: 'com.vendor.board', keyId: 'k1' },
      )
      expect(mockSetDeviceProbeResult).toHaveBeenCalledWith({
        status: 'connected-with-firmware',
        anchorHex: 'aa',
        deviceId: undefined,
        licenseStatus: 'licensed',
        activation: 'already-licensed',
        error: undefined,
      })
      expect(mockOpenModal).not.toHaveBeenCalled()
    })

    it('lands DEMO and prompts Buy on a demo outcome', async () => {
      mockActivateLicense.mockResolvedValue({
        success: true,
        probedAt: 't',
        outcome: 'demo',
        licenseStatus: 'unlicensed',
        activation: 'demo',
        deviceId: DEVICE_ID,
      })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockSetDeviceProbeResult).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected-with-firmware', licenseStatus: 'unlicensed', deviceId: DEVICE_ID }),
      )
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({ title: 'License Required' })
      latestOnResponse()(0)
      // Network targets get the same device-bound link the serial path does.
      expect(mockOpenExternalLink).toHaveBeenCalledWith(
        `https://edge.test/buy?vppId=com.vendor.board&deviceId=${DEVICE_ID}`,
      )
    })

    it('clears the badge when the runtime does not answer the license FCs', async () => {
      mockActivateLicense.mockResolvedValue({ success: true, probedAt: 't', outcome: 'no-id' })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockClearDeviceProbe).toHaveBeenCalled()
      expect(mockSetDeviceProbeResult).not.toHaveBeenCalled()
    })

    // The regression this pass fixes: the device DID answer, the licensing
    // service did not. Clearing the badge here turned a wrong prompt into
    // silence — the user saw nothing at all and had no way to retry.
    it('lands a failed check instead of clearing the badge', async () => {
      mockActivateLicense.mockResolvedValue({
        success: true,
        probedAt: 't',
        outcome: 'error',
        licenseStatus: 'unlicensed',
        activation: 'error',
        deviceId: DEVICE_ID,
        error: 'Activation request failed: 429 Too Many Requests',
      })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockClearDeviceProbe).not.toHaveBeenCalled()
      expect(mockSetDeviceProbeResult).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseStatus: 'unlicensed',
          activation: 'error',
          error: 'Activation request failed: 429 Too Many Requests',
        }),
      )
      // A failed check is not a missing purchase: do NOT prompt to buy.
      expect(mockOpenModal).not.toHaveBeenCalled()
    })

    // Same physical device, same conclusion, same badge — this used to show
    // "License unknown" on serial and nothing at all over the network.
    it('lands unsupported storage the same way the serial path does', async () => {
      mockActivateLicense.mockResolvedValue({
        success: true,
        probedAt: 't',
        outcome: 'error',
        licenseStatus: 'unsupported',
        activation: 'unsupported',
        error: 'no on-device storage backend',
      })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockClearDeviceProbe).not.toHaveBeenCalled()
      expect(mockSetDeviceProbeResult).toHaveBeenCalledWith(
        expect.objectContaining({ licenseStatus: 'unsupported', activation: 'unsupported' }),
      )
    })

    // A transport that died before reaching the device carries no `activation`.
    // That is connectivity, not a license state, so the badge still clears.
    it('still clears when the transport failed before any device answer', async () => {
      mockActivateLicense.mockResolvedValue({ success: false, probedAt: 't', outcome: 'error', error: 'socket closed' })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockClearDeviceProbe).toHaveBeenCalled()
      expect(mockSetDeviceProbeResult).not.toHaveBeenCalled()
    })

    // Used to return with no probe, no log, no badge — indistinguishable from
    // "everything is fine" while a packaging defect went unreported.
    it('logs instead of vanishing when a licensable board declares no package id', async () => {
      const noPackage = { debug: {}, vpp: {} } as unknown as BoardInfo
      const { result } = renderHook(() => useDeviceConnect(noPackage))
      await result.current.checkRuntimeLicense()
      expect(mockActivateLicense).not.toHaveBeenCalled()
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error', message: expect.stringContaining('no package id') }),
      )
    })
  })
})
