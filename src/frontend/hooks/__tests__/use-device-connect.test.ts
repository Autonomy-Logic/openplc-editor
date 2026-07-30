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
const mockSetSerialConnectionStatus = jest.fn()
const mockAddLog = jest.fn()

/** A real derived device id (32 hex) — the `/buy` page rejects anything else. */
const DEVICE_ID = '7146518f9842adacfadc731ee7f546e5'

const mockState: Record<string, unknown> = {
  deviceDefinitions: { configuration: { deviceBoard: 'Test Board', communicationPort: 'COM5', vendorScreenData: {} } },
  serialConnection: { status: 'disconnected', port: null },
  runtimeConnection: { ipAddress: '192.168.0.128', jwtToken: 'jwt-tok' },
  deviceProbeInfo: { phase: 'idle', result: null },
  modalActions: { openModal: mockOpenModal },
  consoleActions: { addLog: mockAddLog },
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
  useSystem: () => ({ openExternalLink: mockOpenExternalLink, getEdgeFrontendUrl: () => 'https://edge.test' }),
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
  mockState.deviceProbeInfo = { phase: 'idle', result: null }
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

  // A17/D19. `no-firmware` is also what a board with CORRECT, responding firmware
  // reports when its core has no factory unique id (0x48 succeeds with
  // `id_len = 0`), and the two are indistinguishable at this layer. Saying only
  // "flash the firmware" sent those users into an endless reflash loop and never
  // mentioned the thing that decides their outcome: no factory id means the board
  // cannot be licensed at all (ADR-0001), for a paying customer included.
  it('names the no-unique-id cause in the no-firmware prompt, not just reflashing', async () => {
    mockConnect.mockResolvedValue({ status: 'no-firmware' })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    const message = (mockOpenModal.mock.calls[0][1] as { message: string }).message
    expect(message).toContain('no factory-programmed unique id')
    expect(message).toContain('reflashing will not change that')
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

  // D6. The backend cannot say WHICH of the two it is (distinguishing them would
  // tell an attacker which device ids have purchases -- ADR-0002), so the editor
  // has to say both, and name the Device ID support needs to fix the second case.
  it('says a purchase under another key is possible, and names the Device ID', async () => {
    mockConnect.mockResolvedValue({
      status: 'connected-with-firmware',
      licenseStatus: 'unlicensed',
      activation: 'demo',
      proofOfPossession: 'proved',
      deviceId: DEVICE_ID,
    })
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    const message = (mockOpenModal.mock.calls[0][1] as { message: string }).message
    expect(message).toContain('registered under a different device key')
    expect(message).toContain(`Device ID: ${DEVICE_ID}`)
  })

  // A19/D6. This is the double-purchase bug: an unproven request is refused with
  // the byte-identical answer "no purchase on record" gets, so the paying customer
  // was shown "Buy a license". Buy must be DEMOTED and the console must carry a
  // trace -- the only one before this was a `console.warn` in the main process.
  describe('an activation that carried NO proof of possession is not sold as "no license"', () => {
    beforeEach(() => {
      mockConnect.mockResolvedValue({
        status: 'connected-with-firmware',
        licenseStatus: 'unlicensed',
        activation: 'demo',
        proofOfPossession: 'unproven',
        deviceId: DEVICE_ID,
      })
    })

    it('titles the prompt as an incomplete check and does not push a purchase', async () => {
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.connect()
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({
        title: 'License Check Incomplete',
        buttons: ['Run in Demo', 'Buy License'],
      })
      const message = (mockOpenModal.mock.calls[0][1] as { message: string }).message
      expect(message).toContain('NOT a missing purchase')
      // Buy stays reachable, just second.
      latestOnResponse()(0)
      expect(mockOpenExternalLink).not.toHaveBeenCalled()
      latestOnResponse()(1)
      expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
    })

    it('logs the unproven activation where the user can see it', async () => {
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.connect()
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: expect.stringContaining('WITHOUT proof of possession'),
        }),
      )
    })
  })

  // S1. `DeviceConnectResult` IS `DeviceProbeResult`, so the result is landed
  // WHOLE. Copying named fields here is what silently dropped `devicePublicKey`
  // when ADR-0002 added it; this asserts the pass-through so the next field added
  // cannot go missing without a red test.
  it('lands the connect result whole, including fields it does not itself read', async () => {
    const landed = {
      status: 'connected-with-firmware',
      anchorHex: '01020304',
      deviceId: DEVICE_ID,
      devicePublicKey: 'ab'.repeat(32),
      licenseStatus: 'unlicensed',
      activation: 'demo',
      proofOfPossession: 'proved',
      error: undefined,
    }
    mockConnect.mockResolvedValue(landed)
    const { result } = renderHook(() => useDeviceConnect(board))
    await result.current.connect()
    expect(mockSetDeviceProbeResult).toHaveBeenCalledWith(landed)
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

    // The checkout is the only moment that binds a proof-of-possession key to a
    // device (ADR-0002). A link built without it sells a license that no later
    // activation can be asked to prove it owns.
    it('carries the device public key so the purchase can bind it', () => {
      const devicePublicKey = 'd'.repeat(64)
      mockState.deviceProbeInfo = {
        phase: 'done',
        result: { status: 'connected-with-firmware', deviceId: DEVICE_ID, devicePublicKey },
      }
      const { result } = renderHook(() => useDeviceConnect(board))
      result.current.buyLicense()
      expect(mockOpenExternalLink).toHaveBeenCalledWith(
        `https://edge.test/buy?vppId=com.vendor.board&deviceId=${DEVICE_ID}&devicePublicKey=${devicePublicKey}`,
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

    // The two paths share one prompt helper precisely so this cannot drift: a
    // runtime-v4 customer who paid must not be told to buy again either (A19).
    it('lands the unproven flag and shows the same demoted prompt the serial path does', async () => {
      mockActivateLicense.mockResolvedValue({
        success: true,
        probedAt: 't',
        outcome: 'demo',
        licenseStatus: 'unlicensed',
        activation: 'demo',
        proofOfPossession: 'unproven',
        deviceId: DEVICE_ID,
      })
      const { result } = renderHook(() => useDeviceConnect(board))
      await result.current.checkRuntimeLicense()
      expect(mockSetDeviceProbeResult).toHaveBeenCalledWith(expect.objectContaining({ proofOfPossession: 'unproven' }))
      expect(mockOpenModal.mock.calls[0][1]).toMatchObject({
        title: 'License Check Incomplete',
        buttons: ['Run in Demo', 'Buy License'],
      })
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
